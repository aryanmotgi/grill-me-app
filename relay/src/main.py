"""Grill Me team relay (Wasmer Edge).

A small versioned document store, one document per team room. The room
logic itself (join, sync, chat, tombstones) stays in the desktop app's Rust
`room_handle`: each app reads the latest document, applies the change
locally, and writes it back with the version it read (compare-and-swap).
If someone else wrote first, the write is refused with the newer document
and the app retries. So the relay never needs to understand rooms, there is
one implementation of the rules, and no laptop has to stay online as host.

Presence (who's online, what they're doing) changes every few seconds, so
it lives in its own small table and never rewrites the document.

Auth: creating a room returns a random 256-bit secret, which is the invite.
Only its SHA-256 is stored. Every room call sends it as a Bearer token.

Edge instances are stateless and get recycled; Postgres is the only truth.
"""
import hashlib
import hmac
import json
import os
import secrets
import ssl
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse

MAX_DOC_BYTES = 2_000_000
ROOM_ID_LEN = 12
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class Store:
    """Postgres when Wasmer provides one (DB_HOST), else in-memory for local tests."""

    def __init__(self):
        self.lock = threading.Lock()
        self.conn = None
        self.mem_rooms = {}  # room -> [secret_hash, version, doc_json]
        self.mem_presence = {}  # (room, member) -> (ts_ms, presence_json)
        if os.environ.get("DB_HOST"):
            self._connect()

    @property
    def kind(self):
        return "postgres" if self.conn else "memory"

    def _connect(self):
        import pg8000.native

        ctx = ssl.create_default_context()
        # Wasmer's managed Postgres presents a certificate from a private CA
        # that isn't shipped to the app; the link is still encrypted.
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.conn = pg8000.native.Connection(
            user=os.environ["DB_USERNAME"], password=os.environ["DB_PASSWORD"],
            host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]),
            database=os.environ["DB_NAME"], ssl_context=ctx, timeout=10)
        self.conn.run("""CREATE TABLE IF NOT EXISTS rooms(
            id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL,
            version BIGINT NOT NULL, doc TEXT NOT NULL,
            created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL)""")
        self.conn.run("""CREATE TABLE IF NOT EXISTS presence(
            room TEXT NOT NULL, member TEXT NOT NULL,
            ts_ms BIGINT NOT NULL, presence TEXT,
            PRIMARY KEY(room, member))""")

    def _pg(self, sql, **kw):
        try:
            return self.conn.run(sql, **kw)
        except Exception:
            self._connect()  # recycled connection: reconnect once and retry
            return self.conn.run(sql, **kw)

    def create(self, room, secret_hash, doc):
        now = now_ms()
        with self.lock:
            if self.conn:
                self._pg("INSERT INTO rooms VALUES(:i,:h,1,:d,:t,:t)", i=room, h=secret_hash, d=doc, t=now)
            else:
                self.mem_rooms[room] = [secret_hash, 1, doc]

    def secret_hash(self, room):
        with self.lock:
            if self.conn:
                r = self._pg("SELECT secret_hash FROM rooms WHERE id=:i", i=room)
                return r[0][0] if r else None
            row = self.mem_rooms.get(room)
            return row[0] if row else None

    def read(self, room):
        """(version, doc_json) or None."""
        with self.lock:
            if self.conn:
                r = self._pg("SELECT version, doc FROM rooms WHERE id=:i", i=room)
                return (r[0][0], r[0][1]) if r else None
            row = self.mem_rooms.get(room)
            return (row[1], row[2]) if row else None

    def version(self, room):
        with self.lock:
            if self.conn:
                r = self._pg("SELECT version FROM rooms WHERE id=:i", i=room)
                return r[0][0] if r else None
            row = self.mem_rooms.get(room)
            return row[1] if row else None

    def cas(self, room, expected, doc):
        """Write if the stored version is still `expected`. Returns the new version or None."""
        with self.lock:
            if self.conn:
                r = self._pg("""UPDATE rooms SET doc=:d, version=version+1, updated_ms=:t
                    WHERE id=:i AND version=:v RETURNING version""",
                    d=doc, t=now_ms(), i=room, v=expected)
                return r[0][0] if r else None
            row = self.mem_rooms.get(room)
            if not row or row[1] != expected:
                return None
            row[1] += 1
            row[2] = doc
            return row[1]

    def touch(self, room, member, presence_json):
        now = now_ms()
        with self.lock:
            if self.conn:
                self._pg("""INSERT INTO presence VALUES(:r,:m,:t,:p)
                    ON CONFLICT(room, member) DO UPDATE SET ts_ms=EXCLUDED.ts_ms, presence=EXCLUDED.presence""",
                    r=room, m=member, t=now, p=presence_json)
            else:
                self.mem_presence[(room, member)] = (now, presence_json)

    def presence(self, room):
        with self.lock:
            if self.conn:
                rows = self._pg("SELECT member, ts_ms, presence FROM presence WHERE room=:r", r=room)
            else:
                rows = [(m, t, p) for (r, m), (t, p) in self.mem_presence.items() if r == room]
        out = {}
        for member, ts, p in rows:
            out[member] = {"lastSeen": ts, "presence": json.loads(p) if p else None}
        return out


def now_ms():
    return int(time.time() * 1000)


def hash_secret(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


store = Store()


def load_catalog():
    """The tool catalog the apps refresh from (relay/catalog.json, a copy of
    src/data/catalog.json made by scripts/sync-catalog.sh). Loaded once."""
    try:
        doc = json.loads((Path(__file__).resolve().parent.parent / "catalog.json").read_text())
        return doc if isinstance(doc, dict) and isinstance(doc.get("entries"), list) else None
    except (OSError, ValueError):
        return None


CATALOG = load_catalog()


def err(status, msg):
    return JSONResponse({"error": msg}, status_code=status)


def authorized(room, authorization):
    """True when the Bearer secret matches this room's stored hash."""
    if not authorization or not authorization.startswith("Bearer "):
        return False
    stored = store.secret_hash(room)
    return stored is not None and hmac.compare_digest(stored, hash_secret(authorization[7:].strip()))


def valid_room_id(room):
    return len(room) == ROOM_ID_LEN and room.isalnum()


async def json_body(request, limit=MAX_DOC_BYTES):
    raw = await request.body()
    if len(raw) > limit:
        return None, err(413, "too large")
    try:
        return json.loads(raw or b"{}"), None
    except ValueError:
        return None, err(400, "invalid json")


@app.get("/v1/health")
def health():
    return {"ok": True, "store": store.kind}


@app.get("/v1/catalog")
def catalog():
    if CATALOG is None:
        return err(503, "catalog unavailable")
    return JSONResponse(CATALOG, headers={"Cache-Control": "public, max-age=3600"})


@app.post("/v1/rooms")
async def create_room(request: Request):
    body, bad = await json_body(request)
    if bad:
        return bad
    doc = body.get("doc")
    if not isinstance(doc, dict):
        return err(400, "doc required")
    room = secrets.token_hex(ROOM_ID_LEN // 2)
    secret = secrets.token_urlsafe(32)
    store.create(room, hash_secret(secret), json.dumps(doc))
    return {"room": room, "secret": secret, "version": 1}


@app.post("/v1/rooms/{room}/tick")
async def tick(room: str, request: Request, authorization: str = Header(default="")):
    """Poll + heartbeat in one call: record my presence (optional), and return
    the document only if it changed since `since`. Presence always comes back."""
    if not valid_room_id(room) or not authorized(room, authorization):
        return err(404, "no such room")
    body, bad = await json_body(request, limit=64_000)
    if bad:
        return bad
    member = body.get("member")
    if isinstance(member, str) and 0 < len(member) <= 64:
        presence = body.get("presence")
        store.touch(room, member, json.dumps(presence) if presence is not None else None)
    since = body.get("since")
    out = {"now": now_ms(), "presence": store.presence(room)}
    if isinstance(since, int) and store.version(room) == since:
        out["version"] = since
        out["unchanged"] = True
        return out
    row = store.read(room)
    if row is None:
        return err(404, "no such room")
    out["version"], out["doc"] = row[0], json.loads(row[1])
    return out


@app.put("/v1/rooms/{room}")
async def write_room(room: str, request: Request, authorization: str = Header(default="")):
    """Compare-and-swap. 409 carries the newer document so the app can retry."""
    if not valid_room_id(room) or not authorized(room, authorization):
        return err(404, "no such room")
    body, bad = await json_body(request)
    if bad:
        return bad
    expected, doc = body.get("expected"), body.get("doc")
    if not isinstance(expected, int) or not isinstance(doc, dict):
        return err(400, "expected and doc required")
    version = store.cas(room, expected, json.dumps(doc))
    if version is not None:
        return {"version": version}
    row = store.read(room)
    return JSONResponse({"error": "conflict", "version": row[0], "doc": json.loads(row[1])}, status_code=409)


JOIN_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join a Grill Me team</title>
<style>
:root{color-scheme:light dark;--bg:#16181c;--ink:#e8e9ec;--dim:#a2a7b0;--line:#2c3038;--accent:#5f7aa0}
@media (prefers-color-scheme:light){:root{--bg:#f7f7f8;--ink:#17191d;--dim:#555b66;--line:#dcdfe4}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:48px 16px}
h1{font-size:24px;margin:0 0 8px}p{color:var(--dim)}
ol{padding-left:20px}li{margin:10px 0}
code{display:block;word-break:break-all;background:rgba(127,127,127,.12);border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:6px;font-size:13px}
button{margin-top:8px;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer}
</style></head><body><main>
<h1>You're invited to a Grill Me team</h1>
<p>Grill Me keeps everyone's AI coding agents on the same plan.</p>
<ol>
<li><b>Get the app.</b> Download Grill Me for Mac. The first time you open it, right-click the app and choose <b>Open</b>, then <b>Open</b> again (it isn't signed yet).</li>
<li><b>Copy this invite</b><code id="link"></code><button onclick="navigator.clipboard.writeText(document.getElementById('link').textContent);this.textContent='Copied'">Copy invite</button></li>
<li><b>In Grill Me</b>, choose <b>I'm joining a team</b> (or Settings → Team → Team), and paste it.</li>
</ol>
</main><script>document.getElementById('link').textContent=location.href</script></body></html>"""


@app.get("/join/{room}", response_class=HTMLResponse)
def join_page(room: str):
    # the secret rides in the #fragment, which browsers never send to us
    return JOIN_PAGE
