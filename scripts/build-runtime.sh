#!/usr/bin/env bash
# Rebuilds runtime/architecture.html from template/ (only needed after changing the page itself).
# Needs Node and network access for the first npm install; builds in a temporary folder so the
# skill folder stays free of node_modules.
#   build-runtime.sh [work dir]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill="$(cd "$here/.." && pwd)"
work="${1:-${TMPDIR:-/tmp}/repo-architecture-build}"
mkdir -p "$work"
cp -R "$skill/template/." "$work/"
want="$(shasum "$work/package.json" | cut -d' ' -f1)"
if [ ! -d "$work/node_modules" ] || [ "$(cat "$work/.installed" 2>/dev/null)" != "$want" ]; then
  (cd "$work" && npm install --no-audit --no-fund --loglevel=error)
  echo "$want" > "$work/.installed"
fi
(cd "$work" && npx tsc --noEmit && npx vite build --logLevel error)
grep -q 'id="architecture-model"' "$work/dist/index.html" || { echo "built page lost its model slot" >&2; exit 1; }
mkdir -p "$skill/runtime"
cp "$work/dist/index.html" "$skill/runtime/architecture.html"
echo "runtime=$skill/runtime/architecture.html ($(wc -c < "$skill/runtime/architecture.html" | tr -d ' ') bytes)"
