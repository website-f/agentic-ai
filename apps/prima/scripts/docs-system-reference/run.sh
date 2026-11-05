#!/usr/bin/env bash
# Rebuild docs/system/reference/*.md from the code. Run from the repository root after `npm ci`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
npx esbuild "$here/extract.ts" --bundle --platform=node --outfile="$out/extract.js" --log-level=error
node "$out/extract.js" | python3 -I "$here/generate.py"
