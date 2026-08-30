```
========================================================================================
GATE^FLAME — 📌 PINNED STATE / RESUME HERE
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-STATE | Version: 8.0 | Updated: 2026-08-25 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ⭐ READ `CLAUDE.md` FIRST. RULE ZERO IS NOT OPTIONAL.

Then run `tools\doctor.cmd` before touching anything.

---

# 0 — THE THREE ACTIONS WAITING FOR DENNIS

In this order. Each is a double-click in `E:\Gateflame\tools\`.

| # | Command | Why |
|---|---|---|
| 1 | **`load-key.cmd`** | SSH agent is empty after every Windows restart. Nothing reaches GitHub or the Pi without it. Passphrase typed blind. |
| 2 | **`SAVE-EVERYTHING.cmd`** | **2 commits exist in only one place** (`b7f4417`, `2dc2f69` — this session's). Pushes every branch from every clone. Deletes nothing, never forces. |
| 3 | **`apply-pi-fixes.cmd`** | Installs the fixed DNS watchdog on the Pi. **This is what stops the phones dropping.** Asks for the *Pi's* password. ~10 s DNS pause. |

**Nothing may be deleted, archived or retired until (2) reports clean.**

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

---

# 2 — REPO HYGIENE: FIXED TODAY, AND WHY IT MATTERED

Work had been going missing repeatedly. Measured cause:

```
  19 checkouts of this repo on one machine
   8 author identities in the history
   3 branches with no upstream at all
   1 local main, 28 commits ahead of the remote
  98 loose scratch files dumped in C:\Users\DGMic
```

**An earlier session (me) caused the identity split** by reading *"Author: Johan
Wilhelm van Antwerp"* out of a document header template and passing it to git as
`-c user.name`. 14 commits landed under the company founder, who was not at the
keyboard. That is what made one person's history look like two people racing on
a branch — and it is why a session wrongly told Dennis there was "another
session" working. **There is only Dennis, on this machine.**

Fixed: identity pinned to `DennisIonity <dennis@ionitynetwork.onmicrosoft.com>`
globally *and* `--local` in every live clone. `CLAUDE.md` RULE ZERO forbids
per-commit overrides. `scripts/gateflame-doctor.sh` reports drift. Operational
scripts moved from `C:\Users\DGMic` into `E:\Gateflame\tools\` and committed.

**Not done, deliberately:** the 8 historic identities stay. Rewriting shared
history is itself a way to lose work.

---

# 3 — THE FAULT THAT STARTED ALL THIS

Reported: mobile devices keep losing connection. Measured from a desktop on the
same Wi-Fi: **240 consecutive queries, 0 fail, 0 slow, avg 51 ms.** The box was
healthy the whole time. Four faults, all *outside* its own view:

| # | Fault | State |
|---|---|---|
| 1 | Router advertises IPv6 (`fd00::/64`) naming **itself** as DNS, on a LAN with **no IPv6 default route**. Phones prefer IPv6 → ask the router (unfiltered), stall on every AAAA, fail the OS connectivity check, drop Wi-Fi. Windows is immune (RFC 6724 ranks ULA below IPv4) — which is why every PC test looked perfect. | 🟡 self-heal written + tested, **not yet live on the Pi** — action 3 |
| 2 | **Router is not forwarding to the box at all.** `doubleclick.net` → real IP via `192.168.0.1`, `0.0.0.0` via the box. | 🔴 needs the router's upstream DNS set — see §4 |
| 3 | Pi dual-homed on one /24: eth0 `.10`, wlan0 `.13`; port 53 on `.10` only. ARP flux; avahi hands out `.13`. | 🔴 detected, **deliberately never auto-fixed** (dropping an interface could cut the box's own path) |
| 4 | Pi-hole rate limit at default 1000/60 **per source address** — once the router forwards, the whole house is one address. | 🟢 **FIXED LIVE**, read back as `0` |

---

# 4 — THE ROUTER

**TP-Link EX511 v2.0**, AX3000 Wi-Fi 6, Linux 4.4.60. Identified from its own
unauthenticated UPnP description at `http://192.168.0.1:1900/jubzkc/gatedesc.xml`.
That real document is the test fixture in `test_router_adapters.py`.
Identification **works and passes**.

**Credentialed login deliberately NOT built.** The EX511 returns `406` to every
path unless the `Accept` header matches its own JavaScript, and the scripts its
login page references are not served where it names them. Building it means
reverse-engineering TP-Link's private RSA/AES handshake on a live gateway —
which `perform_handshake` refuses to do to strangers — and it would break
silently on an overnight firmware update, in a customer's house, while the box
still reported itself healthy. `LOGIN_SUPPORTED_MODELS` is empty and a test
asserts that is correct.

**🟡 OPEN DECISION FOR DENNIS** — how the standard box gets router authority:

| Option | Trade |
|---|---|
| Guided one-screen flow *(recommended)* | Works on every router day one, no credentials ever touch our hardware, ~30 s once. The box already detects the model **and** verifies by re-read, which is what makes it feel like a wizard step rather than homework. |
| Per-model adapter | Works on his unit now; a treadmill across models × firmware, failing silently |
| Premium in-path only | No router interaction, but the standard box then cannot filter phones |

---

# 5 — WHAT LANDED THIS SESSION

| Area | Detail |
|---|---|
| `dns-watchdog.sh` | Probes **both** listeners, not just loopback. `autoheal_ipv6()` fixes the phone fault itself and **reverts** when real IPv6 appears. Sourceable with `GATEFLAME_WATCHDOG_LIB=1` for tests. |
| `netclaim.py` | Decides how far to go. HEAL / OFFER / CLAIM. Standard box capped at OFFER **even on capable hardware** — capability is not permission. |
| `netapply.py` | Executes plans. Blocked remedies never become actions; unknown remedies are reported not dropped; weakest tier first; a failure stops the sequence. **Dry run is the default.** |
| `router_handshake.py` | Credential lifecycle — `Secret` burns on every path, cannot be logged, exception *types* only. Never reports success without a re-read. Records rollback. `SETTING_UPSTREAM_DNS` (renamed from `lan_dns`, which described the wrong field). |
| `gateflame-netcheck.sh` | Outward-looking check: router forwarding, IPv6, dual-homing, LAN listener, rate limit. |
| `gateflame-ra-advertiser.sh` | RDNSS announce with `AdvDefaultLifetime 0` — "I am not a router". ⚠️ **written, syntax-checked, deliberately NOT deployed.** |
| Kiosk perf | Chromium had **no memory flags at all**; now low-end mode, 1 renderer, 96 MB heap, 8 MB cache. `MemoryHigh=420M/MemoryMax=560M` so **the resolver outlives the wall panel**. Lock-screen clock re-arms per minute instead of waking a core 86,400×/day. |
| `gateflame-memcheck.sh` | Turns "runs on 2 GB" into a measurement. PSS not RSS. Grades against the base model even on the 16 GB Pi 5. |
| `tools/` | `doctor` · `SAVE-EVERYTHING` · `load-key` · `apply-pi-fixes` — all committed, all on E:. |

**Tests: 552 backend · 187 frontend · `tsc` clean.** All shell scripts syntax-clean.

> ⚠️ Two tests of mine were **vacuous** and the non-vacuity check caught it.
> Always revert the fix and confirm the tests fail. One compared rendered text
> that was identical either way.

---

# 6 — TRAPS THAT COST REAL TIME (full list in `CLAUDE.md`)

- **Windows OpenSSH is broken** — every binary exits 255 silently. Only Git's copy works.
- **Never set `GIT_SSH_COMMAND`** — global `core.sshCommand` uses an 8.3 short path on purpose.
- **`~/.ssh/agent.sock` may be a file *or* the socket.** `cat` on the socket fails and looks like a missing agent.
- **cmd's `\"` toggles quoting** — a `|` after one becomes a real pipe. Write a `.sh`, `scp` it, run it.
- `NODE_ENV` wrong on both machines. Pi is **not** a git repo — deploy by `scp`.
- Watchdog runs from `/usr/local/bin/`, not the repo copy.
- `pathlib.Path` mangles POSIX appliance paths on Windows — use `PurePosixPath`.

---

# 7 — STILL OPEN

- 🟡 **2 commits in one place only** (`b7f4417`, `2dc2f69`) — action 2 above

> ⚠️ **`git log --branches --not --remotes` lies against stale remote-tracking
> refs.** It twice reported alarming counts here that a `git fetch` dissolved:
> "3 commits at risk in `gf-scratch` since 15 Aug" — they were already on
> `origin/main`; and `main [ahead 28]` — those 28 are on the remote via
> `origin/fix/mobile-dns-drops`, so `main` being ahead is **bookkeeping, not
> risk**. `GateFlame-Repo`'s 2 are probably the same artifact (they were pushed
> on the 18th; that clone has not fetched since). **Always fetch before believing
> the number** — `SAVE-EVERYTHING.cmd` does, which is why it is the tool to trust.
- 🔴 Uncommitted in the tree, **not mine, do not clobber**: `android/version.properties`, `vite.standalone.config.ts`, untracked `debug.cjs`
- 🔴 Release keystore `~/.gateflame-signing` — **irreplaceable, still no verified backup.** SHA-256 recorded 2026-08-29 in `android/KEYSTORE.md` (`AB:F9:...:E2:7D`) — that part is done.
- 🔴 Revoke the two GitHub PATs and the `GEMINI_API_KEY` (live plaintext copy in `TempGateFlameBuild\.env.local`)
- 🟡 Router decision (§4) · 🟡 RA advertiser not deployed · 🟡 memcheck not yet run on hardware
- 🟡 Two agent routes missing: `GET /api/v1/posture/netcheck`, `POST /api/v1/pair/router/revert` — Ionibot IB-605 needs the second
- 🔴 No history database — a reboot is still amnesia
- 🔴 `feed-receiver` tests not in CI; ruff non-blocking
- 🟡 Retire the 14 Antigravity snapshots + 3 dormant C: clones — **only after action 2**

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
