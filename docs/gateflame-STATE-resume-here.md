```
========================================================================================
GATE^FLAME — 📌 PINNED STATE / RESUME HERE
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-STATE | Version: 9.0 | Updated: 2026-08-30 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

> Dennis asked to pin this and carry the conversation over to a different
> model (Opus). Everything below is accurate as of the moment this was
> written — read this first, it is the actual state, not a plan.

# ⭐ READ `CLAUDE.md` FIRST. RULE ZERO IS NOT OPTIONAL.

Then run `tools\doctor.cmd` before touching anything.

---

# 0 — THE ONE ACTION WAITING FOR DENNIS

Everything else from the last handoff is now done. Only this is open:

| # | Action | Why |
|---|---|---|
| 1 | On the phone: **Settings → Developer options → Wireless debugging → turn it on**, then read out the IP:port it shows | The rebuilt APK (with the new Shield tab) is sitting on this machine at `release\GateFlame-Mobile-debug.apk`, verified on disk. Nothing plugged in over USB, and the phone isn't advertising a wireless-debug session yet (`adb mdns services` finds nothing), so it cannot be installed until one of those exists. |

Already done this session, do not repeat: `tools\load-key.cmd` was run and the
key is loaded (`SHA256:8AQd...rEpI dennis@wabakipi`); `fix/mobile-dns-drops`
is pushed to `origin` (see §5).

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

**Still open from this session:** the *rebuilt* APK (with the Shield tab) has
not reached Dennis's phone yet — see §0. The dev-shell "repo" preview
(`App.tsx`'s mobile-preview tab) renders the real `<MobileApp/>` directly, so
it already inherits the Shield fix with no separate change needed.

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
- 🟡 Rebuilt debug APK (with Shield tab) not yet installed on Dennis's phone — §0

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
