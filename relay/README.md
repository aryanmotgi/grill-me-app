# Grill Me team relay

Lets teammates on different networks share one team room, with nothing to install and no laptop acting as host. Runs on Wasmer Edge at **https://grillme-relay.wasmer.app** (account `carecompanioninc`), backed by Wasmer's managed Postgres.

## How it works

- Each team room is **one versioned JSON document** (the same `RoomState` the desktop app already uses).
- The room rules stay in the app (`src-tauri/src/room.rs` → `room_handle`). To change the room, an app reads the latest document, applies the change locally, and writes it back with the version it read. If someone else wrote first, the relay answers `409` with the newer document and the app retries. See `src-tauri/src/relay.rs`.
- Heartbeats and presence go to a small separate table through `tick`, which also polls. The every-1.5-second traffic never rewrites the document.
- **Invite** = `https://grillme-relay.wasmer.app/join/<room>#<secret>`. The secret is in the `#` part, which browsers never send to the server. The relay stores only its SHA-256.

## API

| Call | What it does |
|---|---|
| `GET /v1/health` | `{ok, store}` |
| `POST /v1/rooms {doc}` | New room → `{room, secret, version: 1}` |
| `POST /v1/rooms/{room}/tick {since?, member?, presence?}` | Record presence; return `{now, presence, version, doc?}` (no `doc` when unchanged) |
| `PUT /v1/rooms/{room} {expected, doc}` | Compare-and-swap → `{version}` or `409 {version, doc}` |
| `GET /v1/catalog` | The tool catalog (`relay/catalog.json`), loaded at startup |
| `GET /join/{room}` | The page an invite link opens |

Room calls need `Authorization: Bearer <secret>`. A wrong secret looks the same as a missing room (`404`).

## Tool catalog

`GET /v1/catalog` serves `relay/catalog.json`, a copy of the app's built-in `src/data/catalog.json`. The app (`catalog_fetch_remote` in `src-tauri/src/catalog.rs`) caches it at `~/.grillme/catalog.json` and uses it in place of the built-in one when its `version` is newer. To publish catalog changes without an app release: edit `src/data/catalog.json`, bump `version`, run `scripts/sync-catalog.sh`, then deploy the relay.

## What it stores

The room document (members, team chat, goal, tasks, decisions, session summaries: the files in `room.rs` `SYNC_FILES`) and each member's last-seen time and presence. **No code and no agent transcripts.**

## Develop and deploy

```sh
# tests against an in-memory store
pip install fastapi httpx pytest && python -m pytest test_relay.py
# same tests against the live relay
RELAY_URL=https://grillme-relay.wasmer.app python test_relay.py
# deploy (needs `wasmer login` as carecompanioninc)
wasmer deploy --build-remote --non-interactive
```

The app's end-to-end check: `cargo test --lib relay::tests::live -- --ignored` (in `src-tauri`). Point the app at another relay with `GRILLME_RELAY_URL`.

## Known limits

- The Postgres TLS link is encrypted but not verified, because Wasmer's database uses a private CA. Revisit if Wasmer publishes it.
- Anyone with the invite can read and write the room. Per-device keys and revocation come later.
- Rooms aren't cleaned up yet.
