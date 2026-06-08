#!/usr/bin/env bash
# Generate extension/viewer/ from the root viewer, rewriting CDN ESM imports to
# local CSP-safe stubs so the bundled viewer loads as an MV3 extension page
# (remote module imports are forbidden by the extension CSP).
#
# Root *.js / index.html / styles.css stay the single source of truth — re-run
# this after changing any of them. Hand-written extension sources live in
# extension/src/ and are copied in here; this script owns extension/viewer/
# entirely (it is wiped and regenerated each run).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/extension/viewer"
SRC="$ROOT/extension/src"

CORE_FILES=(
  index.html styles.css viewer-layout.css content.js reader.js signals.js
  portal.js highlight.js dashboard.js toolbar.js sidebar.js pretext_helpers.js
  cursor-hud.js attention.js viewer-shell.js icons.js interpret.js candle.js
  chat.js demo.js sessions.js recall.js app.js
)

rm -rf "$OUT"
mkdir -p "$OUT/sources" "$OUT/vendor"

for f in "${CORE_FILES[@]}"; do
  cp "$ROOT/$f" "$OUT/$f"
done
cp "$ROOT"/sources/*.js "$OUT/sources/"

# Hand-written CSP-safe pieces: boot shim, the loader stubs, and the real
# pretext (vendored from npm — MIT, no runtime deps) so word-based cursor
# logging keeps working in the extension.
cp "$SRC/boot-ext.js" "$OUT/boot-ext.js"
cp "$SRC"/vendor/*.js "$OUT/vendor/"
cp -R "$SRC/vendor/pretext" "$OUT/vendor/pretext"

# Rewrite CDN imports. pretext -> the real vendored module; the loaders that
# can't run under CSP -> stubs (unused by the extension's injected-source flow).
# perl -i (not sed -i) so the same in-place edit works on both GNU/Linux and
# BSD/macOS — BSD sed's -i requires a backup-suffix arg and breaks otherwise.
perl -i -pe 's|https://esm.sh/\@chenglou/pretext|./vendor/pretext/layout.js|' "$OUT/pretext_helpers.js"
perl -i -pe 's|https://esm.sh/\@mozilla/readability\@0.5|../vendor/readability-stub.js|' "$OUT/sources/web.js"
perl -i -pe 's|https://esm.sh/pdfjs-dist\@4/build/pdf.worker.mjs|../vendor/pdf-stub.js|' "$OUT/sources/pdf.js"
perl -i -pe 's|https://esm.sh/pdfjs-dist\@4/build/pdf.mjs|../vendor/pdf-stub.js|' "$OUT/sources/pdf.js"
perl -i -pe 's|https://esm.sh/markdown-it\@14|../vendor/markdown-stub.js|' "$OUT/sources/markdown.js"

# The bundled viewer boots through boot-ext.js (reads the captured source from
# chrome.storage) instead of app.js directly.
perl -i -pe 's|src="./app.js"|src="./boot-ext.js"|' "$OUT/index.html"

echo "Built extension/viewer/ ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
if grep -rn "esm.sh" "$OUT" >/dev/null 2>&1; then
  echo "WARNING: a CDN (esm.sh) reference remains in the bundle:" >&2
  grep -rn "esm.sh" "$OUT" >&2
  exit 1
fi
echo "OK — no remote esm.sh imports remain."
