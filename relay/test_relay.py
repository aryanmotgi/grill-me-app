"""Relay contract tests. Run locally (in-memory store):
    python -m pytest test_relay.py      (needs fastapi, httpx, pytest)
or against a deployed relay:
    RELAY_URL=https://grillme-relay.wasmer.app python test_relay.py
"""
import os

if os.environ.get("RELAY_URL"):
    import httpx
    client = httpx.Client(base_url=os.environ["RELAY_URL"], timeout=20)
else:
    from fastapi.testclient import TestClient
    from src.main import app
    client = TestClient(app)


def make_room(doc=None):
    r = client.post("/v1/rooms", json={"doc": doc or {"code": "ABCDE", "members": []}})
    assert r.status_code == 200, r.text
    j = r.json()
    return j["room"], {"Authorization": f"Bearer {j['secret']}"}


def test_create_and_read():
    room, auth = make_room({"code": "ABCDE"})
    r = client.post(f"/v1/rooms/{room}/tick", json={}, headers=auth).json()
    assert r["version"] == 1 and r["doc"] == {"code": "ABCDE"}


def test_wrong_secret_looks_like_no_room():
    room, _ = make_room()
    r = client.post(f"/v1/rooms/{room}/tick", json={}, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 404
    r = client.post(f"/v1/rooms/{room}/tick", json={})
    assert r.status_code == 404


def test_compare_and_swap():
    room, auth = make_room({"n": 0})
    ok = client.put(f"/v1/rooms/{room}", json={"expected": 1, "doc": {"n": 1}}, headers=auth)
    assert ok.json() == {"version": 2}
    # a second writer that read version 1 loses and gets the newer doc back
    lost = client.put(f"/v1/rooms/{room}", json={"expected": 1, "doc": {"n": 99}}, headers=auth)
    assert lost.status_code == 409
    assert lost.json()["version"] == 2 and lost.json()["doc"] == {"n": 1}


def test_unchanged_tick_skips_the_doc_and_carries_presence():
    room, auth = make_room()
    r = client.post(f"/v1/rooms/{room}/tick", json={"since": 1, "member": "m1", "presence": {"file": "a.ts"}}, headers=auth).json()
    assert r.get("unchanged") is True and "doc" not in r
    assert r["presence"]["m1"]["presence"] == {"file": "a.ts"}
    assert r["now"] >= r["presence"]["m1"]["lastSeen"]


def test_rejects_garbage():
    assert client.post("/v1/rooms", json={"doc": "nope"}).status_code == 400
    room, auth = make_room()
    assert client.put(f"/v1/rooms/{room}", json={"doc": {}}, headers=auth).status_code == 400
    assert client.post("/v1/rooms/../x/tick", json={}, headers=auth).status_code == 404


def test_join_page_never_needs_the_secret():
    r = client.get("/join/abcdef123456")
    assert r.status_code == 200 and "joining a team" in r.text


def test_catalog_is_served():
    r = client.get("/v1/catalog")
    assert r.status_code == 200
    doc = r.json()
    assert isinstance(doc["version"], str) and doc["version"]
    assert isinstance(doc["entries"], list) and len(doc["entries"]) > 0
    ids = [e["id"] for e in doc["entries"]]
    assert len(ids) == len(set(ids))
    assert all(e["source"].startswith("https://") for e in doc["entries"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
