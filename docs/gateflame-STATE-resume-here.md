```
========================================================================================
GATE^FLAME — 📌 PINNED STATE / RESUME HERE
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-STATE | Version: 11.0 | Updated: 2026-08-31 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

> Pinned at end of day, 2026-08-31. Everything below is accurate as of the
> moment it was written — read this first, it is the actual state, not a plan.

---

## 📌 END OF 2026-08-31 — START HERE TOMORROW

**Everything is pushed.** Branch `fix/mobile-dns-drops`, head `683d4d8`, one
git identity throughout. `main` is behind and that is deliberate — merging is
Dennis's call, and on this machine use `git branch -f` + push, never a
checkout of main (it has half-completed before).

### The one thing that should worry us

`~/.gateflame-signing/cert-info.txt` contains a **keytool failure**, not a
certificate:

    Keystore was tampered with, or password was incorrect

The release signing key's usability has never been demonstrated. It is the
only asset with no recovery path. Dennis has the 5-minute check as item 01 of
`docs/reports/manual-tasks-2026-08-31.html`. **Do not build a release APK
until that check passes**, and if it fails again, stop and say so — a key that
cannot be opened is the same as no key.

### Fixed today, all with non-vacuity-checked tests

| What was wrong | Root cause |
|---|---|
| Shield showed "Not set up on this box yet" | Copy collapsed *unreachable*, *unconfigured* and *empty* into one sentence, on a feature that was installed and running |
| Shield had no regions | `/vpn/regions` blocked 24.1 s on a live VPN Gate fetch against a 4 s client timeout — and warmed the cache on its way out, so the next caller got 2 ms. That intermittency is why it "worked yesterday" |
| Regions still empty after the fix | 1.3 MB at ~41 KB/s against a flat 12 s timeout — the download could never finish. Split into connect 10 s / read 120 s |
| Ring read "1%" beside a card reading "0.5%" | One number rendered two ways |
| `load-key.cmd` printed KEY LOADED OK, pushes still failed | Dead agent's socket file blocked `ssh-agent -a`; the fallback bound a random temp path. Now probes, clears only a dead socket, and verifies against GitHub |
| Installer printed ALL CHECKS PASSED | Its kiosk check had no `-L` on a redirect and never asserted — it only ever echoed |
| Fleet showed the node offline | The dashboard was not running. Windows *drops* to a closed port, so "nothing listening" and "firewalled" look identical from the far end |

### Added today

- **Ionibot on the wall console** (was mobile-only). Loopback probes keep
  answering when the household Wi-Fi is the broken thing. Lazily loaded.
- **Per-device Shield state now leaves the box** — Dennis's explicit decision.
  MAC + owner's name + region. `health_feed.py`'s docstring promised the
  opposite and was rewritten rather than left lying.
- **Fleet: Shield panel + support view** that turns reported module gaps into
  what to tell the customer, naming the field each finding came from.
- **PoC v0.5** — §9.2 corrected (v0.1–v0.4 told clients only hardware health
  leaves the LAN; that is no longer true), plus §4.3 Shield, §4.4 assistance,
  §4.5 operator console, §8.1.1 measured figures, §12.4 blocking items.

### Live numbers, read off the box at 15:48

41 274 lookups today · 5 164 blocked (12.5%) · 425 410 domains on gravity ·
9 household devices · 8 VPN countries / 99 servers · node online, feed fresh.

### Blocking, and it is commercial not technical

Per-device Shield state means **device identifiers now leave the household**.
POPIA s18 needs the privacy notice updated and Google Play's data-safety form
must declare them. **This blocks the first Play upload.** Claude offered to
draft the notice from `POPIA-REVIEW.md` + the corrected §9.2 — Dennis has not
said yes yet.

### Two documents that are the current truth

- `docs/reports/capability-ledger-2026-08-31.html` — every function, active or
  not, with real volumes. **Carries one stale claim**: it says the version
  numbers disagree. They do not any more (1.0.2 / code 12). Fix on next touch.
- `docs/reports/manual-tasks-2026-08-31.html` — the 10 things only Dennis can
  do, in dependency order, each with a proof step.

`docs/DENNIS-OUTSTANDING-ACTIONS.md` is superseded and banner-marked.

---


# ⭐ READ `CLAUDE.md` FIRST. RULE ZERO IS NOT OPTIONAL.

Then run `tools\doctor.cmd` before touching anything.

---

# 0 — ONE THING IS WAITING FOR DENNIS

| # | Action | Why |
|---|---|---|
| 1 | On the phone: **Settings → Developer options → Wireless debugging → ON**, then read out the IP:port | The rebuilt APK (device names + Shield rename) is built and verified at `release\GateFlame-Mobile-debug.apk`. The phone answers ping on 192.168.0.8 but advertises no debug service, so wireless debugging is off. Android picks a NEW port every time it is toggled — the old 33441 is dead. |

Everything else is deployed and verified. Live right now, all measured not
assumed:

| Thing | Where | State |
|---|---|---|
| **Fleet dashboard** | `http://192.168.0.6:8091/` (login `admin`, password in `fleet/fleet.env.ps1`, **not** in git) | v2 running: history, graphs, tags/billing/notes, per-node tokens. Pi reports every 5 min. |
| **Shield / VPN** | phone app + kiosk console | `/vpn/regions` returns **HTTP 200** with real VPN Gate countries. Was 404 until 2026-08-30 23:22. |
| **Device names** | phone Shield + kiosk Shield | Live on the box. `/clients` now returns 4 real household devices (was 17 raw rows), each with a label; `PUT /clients/{mac}/name` verified against the live agent — persists, rejects a bad MAC with 400, and clearing reverts to the MAC. |
| **Kiosk console** | Pi wall panel, `/opt/gateflame/kiosk` | Rebuilt and reinstalled 2026-08-31 01:12, read-back confirmed. |
| **Phone app** | Dennis's S10e | Still on the 23:05 build. The newer one is built but **not installed** — see the action above. |
| **DNS filtering** | Pi-hole on the box | 359,667 gravity domains, 3 lists, `protectionStatus: active`. Asked directly it blocks correctly (`doubleclick.net → 0.0.0.0`, `ionity.today` resolves fine). |

⚠️ **The Pi's own `/etc/resolv.conf` still points at the router (192.168.0.1),
not at itself.** That is known fault #2 in §3 — the router is not forwarding to
the box — and it is why a lookup run *on the Pi* still resolves trackers
normally even though Pi-hole blocks them when asked directly. Not a regression,
not caused by any of this work: it is the open router decision in §4.

---

# 1 — WHAT WAS DECIDED (do not re-open)

**`docs/ADR-001-DNS-AUTHORITY-MODEL.md` — ACCEPTED 2026-08-24.**

The **router forwards to us as its upstream DNS. Devices are never pointed at
this box directly.** We change the router's *upstream/WAN* DNS field; the
DHCP-handed DNS is deliberately left alone.

**Why:** load shedding is weekly. Point devices at the box and a power cut
becomes a whole-house outage with no automatic recovery. As an upstream, the
router falls back on its own instantly — nothing was taken away from it.

**Accepted costs:** filtering is **not 100%**, and **per-client attribution is
lost** (Pi-hole sees the router, not each phone). Do not design per-device
history features for the standard box. Do not let kiosk copy imply total
coverage. *"14 devices protected"* is honest; *"Kyle's tablet blocked 12
trackers"* is not.

**Product line:** STANDARD = side-car, never in the traffic path, capped at
`OFFER` in code. PREMIUM = in-path, gateway claim, DPI, firewall bounce.

**Distribution: Google Play. Decided 2026-08-24.** Sideloading, a hosted APK,
a QR sticker — all off the table. Debug builds (like this session's) are for
Dennis's own test phone only, not the distribution path.

---

# 2 — REPO HYGIENE: FIXED, AND WHY IT MATTERED

Work had been going missing repeatedly. Measured cause, several sessions ago:

```
  19 checkouts of this repo on one machine
   8 author identities in the history
   3 branches with no upstream at all
   1 local main, 28 commits ahead of the remote
  98 loose scratch files dumped in C:\Users\DGMic
```

**An earlier session (me) caused the identity split** by reading *"Author: Johan
Wilhelm van Antwerp"* out of a document header template and passing it to git as
`-c user.name`. That is what made one person's history look like two people
racing on a branch. **There is only Dennis, on this machine.** Fixed: identity
pinned to `DennisIonity <dennis@ionitynetwork.onmicrosoft.com>` globally *and*
`--local` in every live clone. `CLAUDE.md` RULE ZERO forbids per-commit
overrides. `tools\doctor.cmd` reports drift on every run.

**`tools\doctor.cmd`, run this session, still reports 2 things** (pre-existing,
not caused by this session's work — tracked, not urgent):
- One commit (`73e3056`, 2026-08-18, "fix(app): break the import cycle that
  killed the mobile app on a real handset") exists in only one clone.
  `SAVE-EVERYTHING.cmd` will surface it if run.
- Three branches with no upstream: `GateFlame-Repo/chore/repo-hygiene`,
  `GateFlame-Repo/fix/mobile-hookup`, `gf-scratch/deploybundle`.

**Not done, deliberately:** the historic identities stay. Rewriting shared
history is itself a way to lose work.

---

# 3 — THE FAULT THAT STARTED ALL THIS (mobile devices dropping Wi-Fi)

Four faults, all outside the box's own view:

| # | Fault | State |
|---|---|---|
| 1 | Router advertises IPv6 naming itself as DNS on a LAN with no IPv6 route → phones stall on AAAA, drop Wi-Fi. Windows is immune, which is why PC-side testing looked fine. | 🟡 self-heal written + tested, **not yet live on the Pi** |
| 2 | Router not forwarding to the box at all. | 🔴 needs the router's upstream DNS set — see §4 |
| 3 | Pi dual-homed on one /24 (eth0 `.10`, wlan0 `.13`); port 53 on `.10` only. | 🔴 detected, deliberately never auto-fixed |
| 4 | Pi-hole rate limit at default 1000/60 per source address. | 🟢 FIXED LIVE, read back as `0` |

---

# 4 — THE ROUTER

**TP-Link EX511 v2.0**, AX3000 Wi-Fi 6. Identified from its own unauthenticated
UPnP description. **Credentialed login deliberately NOT built** — the EX511's
login flow would need reverse-engineering a private RSA/AES handshake, and
would break silently on a firmware update in a customer's house.

**🟡 STILL OPEN DECISION FOR DENNIS** — how the standard box gets router
authority: a guided one-screen flow (recommended — works on every router,
no credentials ever touch our hardware), a per-model adapter (works now,
treadmill across firmware), or premium-in-path-only (no router interaction,
but standard box then can't filter phones).

---

# 5 — WHAT LANDED THIS SESSION (2026-08-30)

Dennis reported the dashboard he'd been shown was fake, then gave a full spec:
reinstall the phone app, rebuild the localhost:3000 console for real (login,
see all clients, support access, working build/deploy tab), and — mid-session
— that none of repo/app/kiosk had VPN visible.

| Area | What happened |
|---|---|
| Root cause of "fake data" | `App.tsx` (plain `npm run dev`, localhost:3000) was still lazy-loading `DeviceOnboardingSimulator.tsx` and `ExportPackagingCenter.tsx` — two pre-2026-08-16 demo panels with hardcoded device/app data and a "build" that only ever generated an HTML string. The real kiosk console (`KioskApp.tsx`) and the real mobile app were already clean the whole time. |
| Mobile app | Reinstalled fresh on Dennis's phone (clean uninstall + install, both confirmed). |
| Console login | `ConsoleLock.tsx`'s `verifyPin` seam was wired to nothing (`null`). Added a real node route `POST /api/v1/console/unlock` (5-strikes/60s lockout, `secrets.compare_digest`), a `console_pin` config value (env-set by the owner, never over the network), and wired the frontend through. Verified in a real built bundle, not just source. |
| Fake-data shell removed | Deleted `DeviceOnboardingSimulator.tsx` and `ExportPackagingCenter.tsx` outright. `App.tsx`'s nav now links straight to the real console (`/kiosk.html`, new tab) instead of a demo. |
| Real Builds panel | New `BuildsPanel.tsx` + a loopback-gated, dev-only Vite middleware (`scripts/vite-dev-builds-plugin.ts`) that runs the actual `npm run build:*` subprocesses and reports success only once the expected output file is confirmed on disk — never from exit code alone. |
| Gate^Flame Shield (VPN) — kiosk | Was **genuinely absent** from `KioskApp.tsx` (confirmed by reading `panels.tsx`/`panelsSystem.tsx` in full — no Shield tab existed). Added `panelsShield.tsx`, ported from the mobile `ShieldCard`, using the kiosk's own `PanelContext`/`authority`/`ViewerNotice` conventions. New "Shield" tab. |
| Gate^Flame Shield — mobile | Was **real and fully working**, but buried as the last card at the bottom of the Settings screen with nothing in the tab bar pointing at it — indistinguishable from missing. Extracted into its own `ShieldScreen.tsx`, given a top-level "Shield" tab between Blocked and Network. Tab bar widened 7→8 columns. |
| Verification | `tsc --noEmit` clean across the whole project after every change. `npm run build:html-kiosk` and `npm run build:apk-debug` both run for real on this machine (not just source review) — kiosk bundle checked for the new strings, APK re-confirmed on disk (4,571,765 bytes) after the build, not trusted from exit code alone. |
| Git | Committed as `b3e3f24` on `fix/mobile-dns-drops`, correct identity. **Pushed to origin this session** (`3f08d33..b3e3f24`) after loading the SSH key via `tools\load-key.cmd`. |

The dev-shell "repo" preview (`App.tsx`'s mobile-preview tab) renders the real
`<MobileApp/>` directly, so it already inherits the Shield fix with no separate
change needed.

## 5b — THE SHIELD BUG BEHIND "I don't see the vpn anywhere" (same night)

After the two front-ends shipped, Dennis still saw no VPN on either surface. He
was right, and **the UI was never the missing part**:

> `/opt/gateflame/node-agent/gateflame/` on the live Pi was the 24 August build
> and contained **no `vpn.py` and no `vpngate.py`**. `/api/v1/vpn/regions`,
> `/vpn/continents` and `/vpn/devices` every one returned **HTTP 404**.

So both Shield screens were calling routes that did not exist, and both
correctly rendered *"Not set up on this box yet"* — which from the outside is
indistinguishable from "there is no VPN". The front-ends were shipped without
checking the backend they depend on was deployed. **Lesson, worth keeping: a UI
that talks to a route is not done until that route is confirmed answering on
the box the customer actually has.**

Proved the phone was *not* at fault by pulling the installed APK back off the
handset and grepping its bundle — Shield, `/vpn/regions`, `/vpn/continents` and
the continent picker were all present the whole time.

Fixed by `tools/gateflame-deploy-vpn.sh` (committed), run once with sudo:
full agent package incl. vpn.py + vpngate.py, the rebuilt kiosk bundle, and the
fleet-feed drop-in. Backs up both, verifies staged copies before overwriting,
re-reads after installing, auto-rolls-back the agent on failure, and restarts
only the agent and the Chromium panel — the resolver is never touched.

## 5c — THE FLEET DASHBOARD, finished the same night

`fleet.db` was **0 bytes** — nothing had ever reported. Two real reasons:
`GATEFLAME_FEED_ENABLED` defaults to false, and the default feed URL points at
`feeds.ionity.today`, which does not resolve.

- `fleet/` is now **in the repo**. It had been loose in `Downloads\GF Files`
  with no version control at all — the exact failure Rule Zero exists to stop.
- `fleet/start-fleet.ps1` binds `0.0.0.0:8091`. **Not 8090** — a local dev
  node-agent already holds that port on the workstation, and taking a free port
  beats killing something already running.
- Chain proved end to end with genuine telemetry off the live Pi before
  declaring it working: POST accepted `204`, node renders `online`,
  unauthenticated `GET /` correctly refused `401`.
- The feed token lives only in `~/gateflame-feed.conf` on the Pi (mode 600,
  root) and `fleet/fleet.env.ps1` on the workstation. **Neither is committed**;
  `.gitignore` covers `fleet.db` and `fleet.env.ps1`. The deploy script reads
  the drop-in rather than carrying the secret, so the script itself is safe to
  commit.
- Consent caveat carried over from `PAIRING-AND-TELEMETRY.md` §4.3: this is
  Dennis's own test box. A **customer** unit needs a consent screen and a kill
  toggle before the feed is switched on for them. Neither is built. Do not ship
  the feed drop-in to a customer box.

---

# 6 — TRAPS THAT COST REAL TIME (full list in `CLAUDE.md`)

- **Windows OpenSSH is broken** — every binary exits 255 silently. Only Git's copy works.
- **Never set `GIT_SSH_COMMAND`** — global `core.sshCommand` uses an 8.3 short path on purpose.
- **`~/.ssh/agent.sock` may be a file *or* the socket**, and even when it IS the
  live socket, a fresh shell (a new PowerShell process, a new Desktop Commander
  call) has no `SSH_AUTH_SOCK` set at all — `ssh-add -l` will say "could not
  open a connection" even when the agent is genuinely running with the key
  loaded. Fix: `export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock` explicitly
  in that shell before checking. Caught this session — nearly reported the key
  as not loaded when it actually was.
- `C:\Users\DGMic\gf-env.sh` and its `gf_agent` helper, referenced in older
  notes, **do not exist on this machine**. Don't assume it's there.
- **cmd's `\"` toggles quoting** — a `|` after one becomes a real pipe. Write a `.sh`, `scp` it, run it.
- **PowerShell's `-Command` also mangles inline strings** with embedded quotes/paths — write a `.ps1` file and run it with `-File` instead of building one long inline `-Command` string.
- `chmod` is not a Windows command — `npm run build:apk-debug` chains `chmod +x gradlew && ./gradlew ...`, which fails on Windows at the `chmod` step. Run `gradlew.bat` directly for the actual assemble step instead.
- `NODE_ENV` wrong on both machines. Pi is **not** a git repo — deploy by `scp`.
- Watchdog runs from `/usr/local/bin/`, not the repo copy.
- `pathlib.Path` mangles POSIX appliance paths on Windows — use `PurePosixPath`.
- The sandboxed Linux mount used by Claude's own shell tool cannot clear
  `dist-kiosk/`/`dist-mobile/` (EACCES on the directory itself, distinct from
  the usual EPERM-on-individual-files quirk that a Python rename works around).
  Real builds of those two targets need to run on the actual Windows machine.

---

# 7 — STILL OPEN (carried forward, none of these are new)

- 🟡 Doctor still flags one commit in one clone only (`73e3056`) and 3
  branches with no upstream (§2) — run `SAVE-EVERYTHING.cmd` to clear.
- 🔴 Uncommitted in the tree, **not mine, do not clobber**: `android/version.properties`, `vite.standalone.config.ts`, untracked `debug.cjs`
- 🔴 Release keystore `~/.gateflame-signing` — **irreplaceable, still no verified backup.** SHA-256 recorded in `android/KEYSTORE.md` (`AB:F9:...:E2:7D`).
- 🔴 Revoke the two GitHub PATs and the `GEMINI_API_KEY` (live plaintext copy in `TempGateFlameBuild\.env.local`)
- 🟡 Router decision (§4) · RA advertiser not deployed · memcheck not yet run on hardware
- 🟡 Two agent routes missing: `GET /api/v1/posture/netcheck`, `POST /api/v1/pair/router/revert`
- 🔴 No history database — a reboot is still amnesia
- 🔴 `feed-receiver` tests not in CI; ruff non-blocking
- 🟡 Retire the 14 Antigravity snapshots + dormant C: clones — only after `SAVE-EVERYTHING.cmd` reports clean
- 🟡 **Workstation is on DHCP and has moved to `192.168.0.6`** (older notes and
  `CLAUDE.md` still say `.7`). The Pi's feed drop-in hardcodes that address —
  if it moves again, edit
  `/etc/systemd/system/gateflame-node-agent.service.d/50-feed.conf`.
- 🟡 The fleet dashboard is started by hand (`fleet/start-fleet.ps1`). It is not
  a Windows service, so it dies with the terminal and does not survive a
  reboot. Fine for now; make it a scheduled task or move it to always-on
  hardware before it matters.
- 🟡 Shield's `controlPlaneReachable` is **false** — Ionity's own exit servers
  (headscale) do not exist yet, so every region currently offered is VPN Gate
  (community, best-effort, never to be labelled "audited" or "no-logs").
- 🔴 **THE NEXT REAL DECISION: the Headscale control plane.** Dennis chose a
  persistent per-box tunnel for remote support (2026-08-31). That is the SAME
  missing piece Shield needs — standing it up once serves both. It needs three
  answers before any code: where it is hosted (the fleet box is hand-started
  and dies with its terminal, so not there), what the customer consent notice
  says, and whether a live inbound path into a household is premium-only.
  Until it exists the fleet dashboard states plainly that remote actions are
  unavailable rather than offering a dead button.
- 🟡 Android rotates the wireless-debugging port on every toggle, so a stored
  IP:port is single-use. Expect to ask for a fresh one each session, or use USB.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
