#!/bin/sh
# Copy the app's built-in tool catalog to the relay, which serves it at
# GET /v1/catalog. Run after editing src/data/catalog.json (and bump its
# "version" so apps pick the new one up), then deploy the relay.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d.get("entries"), list)' "$root/src/data/catalog.json"
cp "$root/src/data/catalog.json" "$root/relay/catalog.json"
echo "synced $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["version"], len(d["entries"]), "entries")' "$root/relay/catalog.json")"
