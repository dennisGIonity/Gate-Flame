```
========================================================================================
GATE^FLAME — 📌 PINNED STATE / RESUME HERE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-STATE | Version: 7.0 | Updated: 2026-08-19 00:45 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ⭐ START HERE TOMORROW — one double-click

Everything else is done and pushed. **One action is outstanding, and it is the one
that stops the phones dropping.**

Open `C:\Users\DGMic` and double-click:

```
GATEFLAME-apply-fixes.cmd
```

It asks for the **Pi's** password (user `wabapi`), typed blind. It installs the
fixed watchdog to `/usr/local/bin/gateflame-dns-watchdog`, records the LAN
address in `dns-stack/.env`, recreates the stack, then runs the watchdog once —
which triggers the IPv6 self-heal. **DNS pauses ~10 s** while containers restart.
It prints the network check and the undo commands at the end.

Why it needs you: the watchdog runs from `/usr/local/bin/`, which is root-owned,
and `sudo` on the Pi wants a password. Everything not needing root is already live.

---

# 1 — THE FAULT, SETTLED

Reported: mobile devices keep losing connection. Measured from a desktop on the
same Wi-Fi: **240 consecutive queries through the box, 0 fail, 0 slow, avg 51 ms.**
The box was healthy the whole time. Four faults, all outside its own view:

| # | Fault | State |
|---|---|---|
| 1 | Router advertises IPv6 (`fd00::/64`) naming **itself** as DNS, on a LAN with **no IPv6 default route**. Phones prefer IPv6 → they ask the router (unfiltered), stall on every AAAA, fail the OS connectivity check, drop the Wi-Fi. Windows is immune (RFC 6724 ranks ULA below IPv4) which is why every PC test looked perfect. | 🟡 self-heal written, **not yet live** — needs the double-click above |
| 2 | **Router is not forwarding to the box at all.** `doubleclick.net` → real IP via `192.168.0.1`, `0.0.0.0` via the box. The cutover never took. | 🔴 needs the TP-Link adapter (see §4) |
| 3 | Pi dual-homed on one /24 — eth0 `.10`, wlan0 `.13`; port 53 on `.10` only. ARP flux + avahi hands out `.13`. | 🔴 detected, deliberately **not** auto-fixed (dropping an interface could cut the box's own path) |
| 4 | Pi-hole rate limit at default 1000/60 **per source address** — once the router forwards, the whole house is one address and trips it, losing DNS in one-minute blocks. | 🟢 **FIXED LIVE** — read back as `0` on the running box |

---

# 2 — WHAT IS LIVE ON THE PI RIGHT NOW

- ✅ Rate limit **1000 → 0**, verified by read-back
- ✅ `dns-watchdog.sh`, `install-dns-stack.sh`, `gateflame-netcheck.sh`, both compose
  files, `netclaim.py`, `router_handshake.py`, `posture.py` staged in
  `/home/wabapi/node-agent/`, syntax-checked **on the Pi**
- ✅ `gateflame-netcheck.sh` runs on the box and reports all four faults
- ✅ Backups of everything touched: `~/gateflame-backup-2026-08-19`
- ⏳ Fixed watchdog **not yet** at `/usr/local/bin/` — the double-click does it

---

# 3 — WHAT IS PUSHED (both branches, finally)

| Repo | Branch | Commits |
|---|---|---|
| `E:\Gateflame` | **`fix/mobile-dns-drops`** | `65dce06` watchdog blind to the LAN listener · `fa1dcd3` RCA + feature inventory · `c37561e` netclaim tiers + IPv6 self-heal · `fbaf16c` router handshake |
| `C:\Users\DGMic\GateFlame-Repo` | **`fix/mobile-hookup`** | `73e3056`, `c0c7563` — was blocked since 18 Aug, now up |

Both need PRs opening. **SSH to GitHub works** — the key is registered and
authenticates as `dennisGIonity`.

> ⚠️ **Never set `GIT_SSH_COMMAND`** on this machine. The global
> `core.sshCommand = C:/PROGRA~1/Git/usr/bin/ssh.exe` uses the 8.3 short path
> deliberately; any override with a space in it fails with
> `C:/Program: No such file or directory`.

**Tests: 494/494 pass** — 446 node-agent + 21 netclaim + 6 autoheal + 21 handshake,
plus 83 feed-receiver and 109 frontend, `tsc` clean.

---

# 4 — WHAT I NEED FROM YOU

**Your router's exact model and firmware version.** One glance at its status page
or the sticker underneath.

Fingerprinted so far, unauthenticated: **TP-Link Aginet CPE** — `tpEncrypt.js`,
`cryptoJS.min.js`, `oid_str.js`, `JSESSIONID`, `com.tplink.aginet` app links.
Encrypted JSON API, not HTML scraping, so a real adapter is very buildable. But
Archer/EX/HX generations use different API dialects and I will not guess on your
gateway.

**Do not paste the router password into chat.** The adapter runs on your hardware
and prompts locally.

---

# 5 — THE PRODUCT LINE, AS DECIDED

**STANDARD — civilian households.** A side-car. Household traffic never passes
through it, so nothing it does can slow the connection down. It wins by being
faster than not having it: a warm cache answers in under a millisecond against
20–40 ms to the ISP, and every blocked tracker is a request never made. Enforced
in code — `netclaim.Capabilities.max_tier` stops a standard box at `OFFER` even on
a Pi 5 that could forward at line rate. Capability is not permission.

**PREMIUM — anything worth a Bond villain's attention.** In the path. Gateway
claim, deep inspection, the full cybertown build. Gated on three conditions, all
required: premium tier, ≥500 Mbit wired headroom, and a withdrawal path **proven
on that unit**.

One boundary, stated plainly because it drives everything: **a side-car cannot
compel a phone to use it.** RDNSS has no preference field; clients keep every
resolver they are told about. Hence §4 — the box configures the router once,
during pairing, and forgets the password.

---

# 6 — STILL OPEN

- 🟡 `serve_dns_on_ipv6` and `advertise_self_as_dns` — the plan emits both remedies,
  nothing applies them yet
- 🟡 TP-Link adapter — blocked on §4
- 🔴 Wabakipi `NODE_ENV=production` + npm `omit=dev`; raspberrypi `NODE_ENV=development`
- 🔴 **Windows OpenSSH is broken** — every binary exits 255 with no output despite
  being present and correctly sized. Only Git's copy works. Repair via
  Settings → Apps → Optional features → OpenSSH Client → remove and re-add
- 🔴 Router has **telnet open on port 23** — worth closing regardless of Gate^Flame
- 🔴 Revoke the two GitHub PATs and the `GEMINI_API_KEY` (live plaintext copy still in
  `TempGateFlameBuild\.env.local`)
- 🔴 Back up the release keystore twice + record its SHA-256
- 🔴 No history database — a reboot is still amnesia
- 🔴 `feed-receiver`'s 83 tests still not in CI; ruff still non-blocking
- 🔴 Version disagreement: tag `v1.0.2` vs `android/version.properties` `1.0.1`

---

# 7 — HOW TO GET BACK IN

The SSH agent holds your key until Windows restarts. After a reboot:

```
C:\Users\DGMic\GATEFLAME-load-ssh-key.cmd     (double-click, type passphrase blind)
```

Then Claude can reach both the Pi (`wabapi@192.168.0.10`) and GitHub.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
