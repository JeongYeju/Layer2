#!/usr/bin/env bash
# Layer 2 — local dev server (macOS)
# Double-click this file in Finder to start a local server and open the prototype.
#
#   What it does:
#     1. Picks a free port (8000 → 8010 search range).
#     2. Starts `python3 -m http.server` in this folder.
#     3. Opens http://localhost:<port> in the default browser.
#
#   To stop: close the Terminal window, or press Ctrl+C in it.

set -e
cd "$(dirname "$0")"

# Find a free port starting at 8000
PORT=""
for p in 8000 8001 8002 8003 8004 8005 8010; do
  if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$p"
    break
  fi
done

if [ -z "$PORT" ]; then
  echo "❌ Couldn't find a free port between 8000 and 8010."
  echo "   Close whatever's using them and try again."
  echo
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

URL="http://localhost:${PORT}"

cat <<EOF

  🟢  Layer 2 dev server
      ${URL}
      (folder: $(pwd))

  Browser will open in a moment. Ctrl+C to stop.

EOF

# Open browser shortly after the server is up
( sleep 0.6 && open "${URL}" ) &

# Run the server in the foreground so Ctrl+C stops it cleanly
exec python3 -m http.server "${PORT}"
