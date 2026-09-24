#!/usr/bin/env bash
# package-release.sh - assemble the tester/approver handover for the ORIGINAL Gate^Flame (standard box).
#   release/GateFlame-<ver>/
#     node/GateFlame-Node-<ver>.tar.gz   install-all.sh (fresh device) + upgrade.sh (installed device) + agent + DNS stack + kiosk
#     mobile/GateFlame-Mobile-<ver>-debug.apk
#     fleet-console/                     operator console source + start script (no secrets, no db)
#     docs/                              handover, test report, known gaps
#     SHA256SUMS.txt
#   release/GateFlame-<ver>.zip
# Secrets are excluded by construction: no .env, no fleet.env.ps1, no *.db, no keystore.
set -eu
unset NODE_ENV
C=/e/Gateflame; cd $C
NAME="$(grep VERSION_NAME android/version.properties | cut -d= -f2)"
VER="$NAME+$(git rev-parse --short HEAD)"
OUT=release/GateFlame-$NAME
rm -rf "$OUT" "release/GateFlame-$NAME.zip"; mkdir -p "$OUT"/{node,mobile,fleet-console,docs}
[ -f dist-kiosk/index.html ] || { echo "run tools/build-bundles.sh first"; exit 1; }

# --- node tarball: node-agent tree (no venv/tests/caches) + kiosk + installers
STG=$(mktemp -d)/GateFlame-Node-$NAME
mkdir -p "$STG"
tar -C node-agent --exclude='.venv' --exclude='tests' --exclude='__pycache__' --exclude='.pytest_cache' --exclude='.ruff_cache' \
    --exclude='.env' --exclude='*.db' --exclude='requirements-dev.txt' -cf - . | tar -C "$STG" -xf -
mkdir -p "$STG/kiosk"; cp -r dist-kiosk/. "$STG/kiosk/"
cp tools/install-pi-release.sh "$STG/upgrade.sh"
echo "$VER" > "$STG/VERSION"
chmod +x "$STG"/*.sh
find "$STG" -name '.env*' -o -name '*.db' | grep . && { echo "REFUSING: secret-looking file in node tarball"; exit 1; } || true
tar -C "$(dirname "$STG")" -czf "$OUT/node/GateFlame-Node-$NAME.tar.gz" "GateFlame-Node-$NAME"

# --- mobile
cp release/GateFlame-Mobile-debug.apk "$OUT/mobile/GateFlame-Mobile-$NAME-debug.apk"

# --- fleet console (source only)
cp fleet/app.py fleet/requirements.txt fleet/start-fleet.ps1 fleet/fleet.env.ps1.example fleet/README.md "$OUT/fleet-console/"
cp -r fleet/static fleet/deploy "$OUT/fleet-console/"

# --- docs
for d in docs/HANDOVER-$NAME.md docs/TEST-REPORT-$NAME.md; do [ -f "$d" ] && cp "$d" "$OUT/docs/"; done
[ -d docs/proof-$NAME ] && cp -r docs/proof-$NAME "$OUT/docs/"

(cd "$OUT" && find . -type f ! -name SHA256SUMS.txt -exec sha256sum {} + | sort -k2 > SHA256SUMS.txt)
(cd release && powershell.exe -NoProfile -Command "Compress-Archive -Path 'GateFlame-$NAME\\*' -DestinationPath 'GateFlame-$NAME.zip' -Force")
echo "=== $VER ==="; cat "$OUT/SHA256SUMS.txt"; ls -la release/GateFlame-$NAME.zip
tar -tzf "$OUT/node/GateFlame-Node-$NAME.tar.gz" | head -40
