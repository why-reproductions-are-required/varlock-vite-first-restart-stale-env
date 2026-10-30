#!/usr/bin/env bash
# Runs `npm run repro` with @varlock/vite-integration 1.4.0 (before #985) and
# 1.5.0 (the first release with #985). Both use varlock 1.17.1 and vite 8.3.5.
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
for version in 1.4.0 1.5.0; do
  dir=$(mktemp -d)
  cp -R "$root/app" "$root/repro.mjs" "$root/package.json" "$dir/"
  (
    cd "$dir"
    npm install --no-audit --no-fund --save-exact \
      "@varlock/vite-integration@$version" varlock@1.17.1 vite@8.3.5 > /dev/null 2>&1
    echo "=== @varlock/vite-integration@$version"
    npm run --silent repro 2>&1 | grep -E "restart 1|PASS|FAIL" || true
  )
  rm -rf "$dir"
done
