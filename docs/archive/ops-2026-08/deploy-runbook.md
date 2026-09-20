```
========================================================================================
GATE^FLAME — FIRST DEPLOYMENT RUNBOOK (PHONE + PI)
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-DEP | Version: 1.0 | Updated: 2026-08-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Deploying to your phone and your Pi

Built and verified this session from `chore/repo-hygiene` tip **`cfccc48`**.

---

## Before anything: four defects were blocking you, and are now fixed

These were found by actually building and running, not by reading. Each one
alone would have stopped first deployment cold.

| # | Defect | Why it blocked you |
|---|---|---|
| 1 | **Six of eight node-discovery addresses had no port.** `http://gateflame.local`, `http://192.168.1.105` and four more resolved to port **80**. The agent binds **8080**. | The phone could only ever find a node over its own loopback — i.e. never. On a real LAN it always showed *"No Gate^Flame node found on this network"*, and there was no manual-address path to recover with. **The app was undeployable to a handset.** |
| 2 | **`AppPairingScreen` never started discovery.** It rendered "Looking for a Gate^Flame node…" and then did nothing; only pressing "Search again" ever probed. | The first screen a customer sees lied about what it was doing. |
| 3 | **`android/gradle/wrapper/gradle-wrapper.jar` was corrupt** — 15,436 U+FFFD sequences, decodes cleanly as UTF-8. Same text-mode corruption that destroyed the release tarball. Broken since the initial public commit `67fefd8`. | `./gradlew` died with *"Invalid or corrupt jarfile"* on any fresh clone. **No APK could be built by you, by CI, or by anyone cloning the repo.** |
| 4 | **The Android cleartext policy could not match a node's IP.** `network_security_config.xml` listed `192.168.1.0`, `10.0.0.0` etc. with `includeSubdomains="true"`, believing that covered each range. Android's `<domain>` rule is a hostname match — no CIDR. `192.168.1.0` does not match `192.168.1.105`; `105` is a sibling label, not a subdomain. | Every request to a node **by IP** was killed on the handset before a socket opened: *"CLEARTEXT communication to 192.168.1.105 not permitted by network security policy"*. Only `gateflame.local` ever worked, and only while mDNS resolved. This was the other half of "the app cannot reach a node". Confirmed by `aapt2 dump xmltree` on the previous build. |

Fixed in commits `8c26a46` and `cfccc48`, plus a manual address-entry fallback
and `node-agent/deploy-on-pi.sh`.

Defect 4's fix is worth a sentence, because "permit cleartext" reads like a
loosening. No hostname list can express RFC1918 in that file — so the manifest
now permits cleartext and the restriction moves to `assertPrivateHost()` in
`src/services/apiClient.ts`, which every request passes through before a socket
opens. It admits RFC1918, link-local, loopback, `.local` and any https URL, and
refuses everything else, so a bearer token cannot leave the phone towards a
public host in the clear. That is a **stronger** guarantee than the old file
claimed, and unlike the old file it is tested — 17 cases across the edges most
easily got wrong (172.15.255.255 refused, 172.16.0.5 admitted, 172.32.0.1
refused). The node enforces the same boundary independently in `security.py`.

Re-verified from a **clean clone of the bundle**: 310 node-agent tests,
**90** frontend tests, `tsc` clean, both HTML builds, `gradlew` runs, and
`assembleDebug` produces an installable APK whose compiled policy was read back
out of the APK to confirm it.

---

## What you have

| File | SHA-256 (first 16) | What it is |
|---|---|---|
| `GateFlame-Mobile-1.0.1-debug.apk` | `2a89b18d86e76627` | 4.6 MB, `today.ionity.gateflame.debug`, versionCode 3, minSdk 24, targetSdk 36. Debug-signed. |
| `gateflame-pi-2026-08-15.tar.gz` | `884b6e32ffb65f70` | 564 KB. Agent + one-shot installer + validator + built kiosk HTML. |
| `gateflame-2026-08-15-DEPLOY.bundle` | `aac631720088964d` | 1.9 MB, tip `cfccc48` — the 5 old commits **plus** both fixes. Supersedes `gateflame-2026-08-15-FINAL.bundle`. |
| `SHA256SUMS.txt` | — | Full digests. |

---

## Step 1 — Push the code (5 min)

Use the **DEPLOY** bundle, not FINAL. It contains everything FINAL had plus
`8c26a46` and `cfccc48`, and `919856a → cfccc48` is a clean fast-forward
(verified against the live remote this session).

```powershell
cd $env:USERPROFILE\GateFlame-Repo
git fetch origin

# fast-forward the local branch from the bundle
git fetch "$env:USERPROFILE\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-2026-08-15-DEPLOY.bundle" chore/repo-hygiene
git checkout chore/repo-hygiene
git merge --ff-only FETCH_HEAD

# verify before pushing
git log --oneline -3        # tip must be cfccc48
git push origin chore/repo-hygiene
```

The remote is **SSH** (`git@github.com:dennisGIonity/Gate-Flame.git`), so load
your key first. If `git push` asks for a username, the remote got switched to
HTTPS — put it back with
`git remote set-url origin git@github.com:dennisGIonity/Gate-Flame.git`.

Then open **PR #2** (`chore/repo-hygiene` → `main`) and merge it. `main` cannot
be fast-forwarded directly: `a0a2da3` is a merge commit that is not in the
branch's history, so it has to go through a PR merge.

> **Do not skip this.** `main` is still serving the old tree to the public.

After the merge:

```powershell
git checkout main && git pull
git tag v1.0.1 && git push origin v1.0.1
```

---

## Step 2 — The Pi (15 min)

```powershell
scp "$env:USERPROFILE\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-pi-2026-08-15.tar.gz" pi@<PI-IP>:~/
```

Then on the Pi:

```bash
ssh pi@<PI-IP>
tar -xzf gateflame-pi-2026-08-15.tar.gz
cd gateflame-pi
sudo bash deploy-on-pi.sh
```

It runs four stages and stops at the first real failure:

1. **prereqs** — `python3-venv`, `iproute2`, `nftables`, `avahi-daemon`, and
   `raspi-utils`/`libraspberrypi-bin` for `vcgencmd`
2. **install** — `node-agent/install.sh`: service user, venv, hardened systemd
   unit, enabled and started on port 8080
3. **capabilities + mDNS** — a systemd drop-in granting `CAP_NET_ADMIN` and
   `CAP_NET_RAW` (kept as a separate, visible decision — it is real privilege,
   but far narrower than running as root), and an avahi alias publishing
   `gateflame.local` so the app's first discovery candidate resolves
4. **validate** — `validate-on-pi.sh`, 19 read-only checks, PASS/FAIL/N-A with
   the observed value each time

**The stage-4 table is the important output.** It is the first honest answer
this project has ever had to "are these real hardware readings?" Every
telemetry number so far came from a container with no thermal zone, no
`vcgencmd` and no real ARP table — proving only that the *fallback* paths work.
Exit code 0 means every required check passed. Send me the table if anything
fails; each line names the observed value, so a failure is diagnosable.

Everything the script does is reversible — the uninstall sequence prints at
the end.

---

## Step 3 — The phone (5 min)

```powershell
# if adb is on PATH from Android Studio
adb install -r "$env:USERPROFILE\GateFlame-Backup-2026-08-13\_fix-2026-08-13\GateFlame-Mobile-1.0.1-debug.apk"
```

Or copy the APK to the phone and tap it (allow "install unknown apps" for your
file manager once).

Open the app. It discovers the node by itself now. If it doesn't find it,
tap **Try again**, then use the address box that appears and type the Pi's IP —
port 8080 is assumed.

### Pair it

There is **no kiosk display on the node yet**, and pairing codes are issued
only to loopback callers — that is the design: physical presence at the
appliance is what authorises pairing. So issue the code over SSH:

```bash
ssh pi@<PI-IP>
curl -s -X POST http://127.0.0.1:8080/api/v1/pair/request
# {"code":"951970","expiresAt":"...","attemptsRemaining":5}
```

Type it into the app within 5 minutes. Five wrong guesses destroys that code —
request another; it is not a lockout of the node.

Verified end-to-end this session against a live agent: status → request →
claim → real telemetry, with a real token issued.

---

## What will work, and what will honestly say it doesn't

The product is built to report gaps rather than fake green lights, so expect
`degraded` on first boot. That is correct behaviour, not breakage.

| Module | On a bare Pi | To make it real |
|---|---|---|
| System Telemetry | ✅ real CPU/mem/disk/uptime, real temp once on a Pi | nothing |
| Passive Client Discovery | ✅ once `iproute2` is installed (stage 1 does it) | nothing |
| DNS Filtering | ⚠️ `degraded` — "Pi-hole not configured" | install Pi-hole, set `GATEFLAME_PIHOLE_URL=http://127.0.0.1` |
| Firewall Bounce | ⚠️ needs `CAP_NET_ADMIN` (stage 3 grants it) | nothing |
| Deep Packet Inspection | ⚠️ needs `CAP_NET_RAW` (stage 3 grants it) | nothing |
| WAN Quality & Budget | ⚠️ `degraded` — no WAN interface named | set `GATEFLAME_WAN_INTERFACES=eth0`. **It is deliberately never guessed** — guessing wrong bills LAN traffic against a customer's data cap |
| Zero-Trust Posture | stopped until started | start it from the app |

Query counts, block %, saved-MB and the threat log return **`null` with a named
gap** until Pi-hole is wired up. They are not zeros and not invented numbers.

---

## Known gaps this deployment does not close

Honest list. None of these stops you today.

1. **The kiosk screen is not served by the node.** `node-agent` has only
   `/api/v1/*` — there is no static route and no `/device-kiosk`. The built
   kiosk HTML is in the package under `kiosk/`, but nothing serves it. Serve it
   by hand with `python3 -m http.server 8081` to look at it. A kiosk reached
   that way is not on loopback from the agent's view, so it cannot display
   pairing codes — SSH is the route for now.
2. **No release keystore, so no signable APK.** This debug build installs and
   runs, but it is signed with Android's throwaway debug key and cannot ship.
   When you switch to a release key, every device with the debug build must
   uninstall first. Run `android\generate-keystore.ps1` on Windows — not in any
   container, not in this session. It is the one artifact in the project with
   no recovery path.
3. **Two GitHub PATs and the `GEMINI_API_KEY` are still unrevoked.** Pasted
   into chat on 2026-08-14. Treat as disclosed regardless of whether anyone
   used them. Then delete `ROTATE-ME.txt`.
4. **POPIA review not done.** `docs/POPIA-REVIEW.md` §5. The question that
   matters most before you sell anything: where will `feeds.ionity.today` be
   hosted? Outside South Africa engages s72 cross-border transfer. Hosting it
   in ZA removes a whole condition, and latency is irrelevant to a 15-minute
   batched POST.
5. **`feed-receiver/` is written and tested but deployed nowhere.** Nothing is
   listening at `feeds.ionity.today`. The health feed is off by default, so
   this costs you nothing until you turn it on.
6. **`build-standalone.js` is still orphaned** — no npm script calls it.

---

## Order of work

```
1. push + merge PR #2 + tag v1.0.1          ← 5 min, unblocks everything public
2. deploy-on-pi.sh, read the PASS/FAIL table ← the real unknown
3. install the debug APK, pair over SSH      ← proves the whole path
4. revoke the PATs and the Gemini key        ← 4 min, overdue
5. generate the release keystore             ← before any unit ships
6. POPIA review                              ← before you sell
```

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
