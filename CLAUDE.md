# Gate^Flame — read this first

Working notes for Claude. Not documentation — this is the set of things that have
already cost time at least once. `docs/gateflame-STATE-resume-here.md` is the
"what's next"; this file is "how this project works and what will bite you".

**Owner:** Dennis / Johan Wilhelm van Antwerp — Ionity (Pty) Ltd / AEDI, Centurion, SA.
Direct and decisive, prefers momentum over planning paralysis, and corrects
overreach immediately. Product scoping, filtering policy and UX are **his** calls;
mine is technical execution and honest evaluation. Multiple chats run against this
repo in parallel — an unfamiliar commit is probably also mine, from another session.

---

## The product, in one line each

**STANDARD — civilian households.** A side-car. Household traffic never passes
through it, so nothing it does can make the connection slower. It wins by being
*faster* than not having it: warm cache <1 ms vs 20–40 ms to the ISP, and every
blocked tracker is a request never made. Enforced in code, not in a slide:
`netclaim.Capabilities.max_tier` stops a standard box at `OFFER` **even on hardware
that could forward at line rate**. Capability is not permission.

**PREMIUM — "anything a Bond villain would want".** In-path. Gateway claim, deep
inspection. Gated on three conditions, all required: premium tier, ≥500 Mbit wired
headroom, and a withdrawal path **proven on that unit**.

**The boundary that drives everything:** a side-car cannot *compel* a phone to use
it. RDNSS has no preference field, so clients keep every resolver they are told
about. Advertising ourselves narrows the gap; it never closes it.

---

## Principles that are already load-bearing in code

- **No secondary DNS. Ever.** Clients query primary and secondary in arbitrary
  order, so protection becomes intermittent and inexplicable. Bypass mode is the
  fallback instead. `install-dns-stack.sh` used to advise a secondary; that was a
  bug and is fixed.
- **The product IS the kiosk.** Don't frame the device UI as secondary.
- **No enforcement without consent**, and no honest-looking screen showing invented
  data. `DataSourceBanner` exists for this.
- **Loopback is not the product.** Anything that proves health must prove it on the
  address the household actually uses.
- **Never claim success without a read-back.** A router that says "saved" and did
  not save cost this household days.
- **Tests are the pinning mechanism.** Behavioural fixes get a test, and the test
  gets checked for non-vacuity by reintroducing the bug.

---

## Machine and environment traps

| Trap | Reality |
|---|---|
| **Windows OpenSSH is broken** on wabakipi | Every binary in `C:\Windows\System32\OpenSSH\` exits 255 with no output, despite correct file sizes and a running agent service. **Only Git's copy works**: `C:\Program Files\Git\bin\bash.exe`, `C:\Program Files\Git\usr\bin\ssh.exe`. |
| **Never set `GIT_SSH_COMMAND`** | Global `core.sshCommand = C:/PROGRA~1/Git/usr/bin/ssh.exe` uses the 8.3 short path *deliberately*. Any override containing a space fails with `C:/Program: No such file or directory`. Unset it and let the global config work. |
| `~/.ssh/agent.sock` | May be a **regular file containing the socket path**, *or* **the socket itself**. `cat` on the second fails with `Operation not supported`, which looks exactly like a missing agent. Source `/c/Users/DGMic/gf-env.sh` and call `gf_agent`. |
| SSH key is passphrase-encrypted | Dennis loads it once per boot via `C:\Users\DGMic\GATEFLAME-load-ssh-key.cmd`. Without it, no Pi and no GitHub. |
| **cmd.exe `\"` breaks pipes** | Inside `cmd`, `\"` *toggles* quoting rather than escaping. Any `|` after an odd number of `\"` becomes a real pipe → `The system cannot find the path specified.` **Write a `.sh`, `scp` it, run it.** Don't build long remote commands inline. |
| `NODE_ENV` is wrong on both machines | wabakipi: `production` + npm `omit=dev` → `npm ci` silently strips devDependencies. raspberrypi: `development` → ~2× React **dev** bundles. Always `set NODE_ENV=` / `unset NODE_ENV` before building. |
| `sudo` on the Pi needs a password | `wabapi` **is** in the `docker` group, so `docker`/`docker exec` work unprivileged. `/usr/local/bin/` and `dns-stack/.env` (root, 0600) do not. Stage a script and have Dennis run one `sudo` command. |
| Pi paths | `/home/wabapi/node-agent/` is **not a git repo** — deploy with `scp`, not `git pull`. The watchdog runs from `/usr/local/bin/gateflame-dns-watchdog`, *not* the repo copy. |
| `pathlib.Path` on appliance paths | Appliance paths are always POSIX. `Path` is platform-dependent and mangles them on Windows. Use `PurePosixPath`. |
| Don't test in BlueStacks | `emulator-5554` is BlueStacks: NATs, no LAN, no mDNS, Android 9 x86_64. |

## The live estate

- **Pi**: `raspberrypi`, user `wabapi`, Pi 5 16GB, Trixie, node `GF-72TYTITQ`, agent 0.1.0,
  **`provisioned: false` — never paired**. Dual-homed on one /24: eth0 `192.168.0.10`,
  wlan0 `192.168.0.13`. Port 53 is on `.10` only, so `.13` serves the API and no DNS.
- **Router**: **TP-Link EX511 v2.0**, AX3000 Wi-Fi 6, Linux 4.4.60. Identified from
  its real UPnP description (`:1900/…/gatedesc.xml`), which is now a test fixture.
  Returns **406 to every path** unless `Accept` matches its own JS. Telnet open on 23.
- **Workstation**: `Wabakipi`, `192.168.0.7`, DNS manually set to `192.168.0.10`.
- Canonical repo `E:\Gateflame`; mobile work in `C:\Users\DGMic\GateFlame-Repo`.

## Where things live

```
node-agent/gateflame/netclaim.py          decides how far to go (pure, no I/O)
node-agent/gateflame/netapply.py          executes plans (dry-run by default)
node-agent/gateflame/router_handshake.py  credential lifecycle, read-back, rollback
node-agent/gateflame/router_adapters.py   UPnP identification; login NOT built
node-agent/dns-watchdog.sh                probes BOTH listeners; autoheal_ipv6()
node-agent/gateflame-netcheck.sh          outward-looking check (router, IPv6, ARP)
node-agent/gateflame-ra-advertiser.sh     RDNSS announce, AdvDefaultLifetime 0
```

`dns-watchdog.sh` is sourceable with `GATEFLAME_WATCHDOG_LIB=1` for testing.
Shell tests find bash via a probe, never `shutil.which("bash")` — on Windows that
returns the WSL stub, which prints a banner and exits 0.

## DECIDED — do not re-litigate

**`docs/ADR-001-DNS-AUTHORITY-MODEL.md` — accepted 2026-08-24.**

The **router forwards to us as its upstream DNS. Devices are never pointed at
this box directly.** The field we change is the router's *upstream/WAN* DNS; the
DHCP-handed DNS is deliberately left alone.

Reason, in one line: **load shedding is weekly**, so any design that points
devices at the box turns a power cut into a whole-house outage with no automatic
recovery. As an upstream, the router falls back on its own instantly because
nothing was taken away from it.

Accepted costs, knowingly: **filtering is not 100%** (the router will sometimes
use its own upstream) and **per-client attribution is lost** (Pi-hole sees the
router, not each device). Do not design features that need per-device history on
the standard box, and do not let kiosk copy imply total coverage.

Consequences already true in code: CLAIM is dropped from the standard box,
`claim_gateway` staying unsupported in `netapply` is the correct end state,
firewall bounce and DPI are premium-only (code removal is a scheduled step, not
done), and AAAA masking is a **fallback** — fix the router's IPv6 at install.

**Who changes the setting:** the customer, once, guided by one screen, with the
box verifying by re-read. Not credentials — the credentialed login is
deliberately unbuilt, see `router_adapters.py`.

## Never do

- Ask for, or accept in chat, a router password or any credential. It runs on his
  hardware and prompts locally. This project has already leaked one API key into
  fourteen files and two zip archives.
- Auto-fix dual-homing by downing an interface — it could cut the only path the
  box is reachable on.
- Act on `gateway_forwards_to_us is None`. Undetermined is not False.
- Deploy anything that changes what *other* devices on the LAN see (RAs, gateway
  claim) unattended on his live household.
