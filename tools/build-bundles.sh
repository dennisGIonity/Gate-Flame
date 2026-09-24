#!/usr/bin/env bash
# build-bundles.sh - fresh kiosk + mobile standalone bundles, verified. Output -> build-bundles.last.txt
unset NODE_ENV
cd /e/Gateflame
{
echo "=== build-bundles $(date -Is) @ $(git rev-parse --short HEAD) ==="
npm run -s build:html-kiosk 2>&1 | tail -8; echo "kiosk rc=${PIPESTATUS[0]}"
npm run -s build:html-mobile 2>&1 | tail -8; echo "mobile rc=${PIPESTATUS[0]}"
ls -la dist-kiosk dist-kiosk/assets dist-mobile 2>&1 | head -40
grep -c "Guard" dist-kiosk/assets/*.js | head -3
} > tools/build-bundles.last.txt 2>&1
cat tools/build-bundles.last.txt
