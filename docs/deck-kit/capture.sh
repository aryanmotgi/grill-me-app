#!/bin/bash
# capture.sh — the one visual the kit cannot generate: a real screenshot of
# the running project. Everything else is inlined into the slide file; this
# produces a PNG you upload to the deck as an asset.
#
#   ./capture.sh http://localhost:5173 shots/app.png [1600 1000]
set -euo pipefail
URL="${1:?usage: capture.sh <url> <out.png> [width height]}"
OUT="${2:?usage: capture.sh <url> <out.png> [width height]}"
W="${3:-1600}"; H="${4:-1000}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot="$OUT" --window-size="${W},${H}" --virtual-time-budget=4000 "$URL" >/dev/null 2>&1
echo "$OUT"
