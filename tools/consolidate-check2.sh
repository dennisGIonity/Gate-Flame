#!/usr/bin/env bash
C=/e/Gateflame; cd $C
out=$C/tools/consolidate-check2.last.txt
{
echo "--- git cherry (patch-equivalent already applied = '-') ---"
git cherry -v fix/mobile-dns-drops origin/fix/mobile-hookup
for c in 73e3056 c0c7563; do
  echo "== $c files:"; git show --stat --format='%s' $c | tail -15
done
echo "--- do the key hunks exist today? ---"
git show c0c7563 -- src | grep '^+' | grep -v '^+++' | head -40
echo "--- fleet app.py: lines in Downloads copy not in canonical ---"
diff <(tr -d '\r' < "/c/Users/DGMic/Downloads/GF Files/gateflame-fleet/app.py") <(tr -d '\r' < fleet/app.py) | grep '^<' | head -60
echo "--- static/index.html: Downloads-only lines ---"
diff <(tr -d '\r' < "/c/Users/DGMic/Downloads/GF Files/gateflame-fleet/static/index.html") <(tr -d '\r' < fleet/static/index.html) | grep '^<' | head -30
git log -3 --format='%h %ad %s' --date=short -- fleet/app.py
} > "$out" 2>&1
cat "$out"
