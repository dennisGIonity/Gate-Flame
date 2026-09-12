**Purpose & context**

Dennis (Johan Wilhelm van Antwerp) is the founder of Ionity (Pty) Ltd / AEDI, based in South Africa, and is the project lead on **Gate^Flame** — a network security appliance product built on Pi-class hardware. The goal is a consumer-friendly, kiosk-driven DNS filtering and threat visibility device that handles network protection without requiring users to understand networking. Dennis's working style is direct and decisive, preferring momentum over planning paralysis; he pushes back when Claude overreaches into decisions that belong to him (product scoping, content filtering choices, user autonomy).

Key infrastructure and stakeholders:
- **Live test Pi**: hostname `raspberrypi`, user `wabapi`, static IP `192.168.0.10`, node ID `GF-72TYTITQ`, Raspberry Pi 5 16GB running Raspberry Pi OS 13 (Trixie/Debian)
- **Dennis's workstation**: `Wabakipi`, Windows, `192.168.0.5`; `NODE_ENV=production` set machine-wide and `npm config omit=dev` persisted in npmrc — this causes every `npm install` to silently strip devDependencies, root cause of recurring "green yesterday" failures
- **GitHub repo**: `dennisGIonity/Gate-Flame`, branch `feat/kiosk-and-icons`
- **Canonical working copy**: `E:\Gateflame`; prior copies archived to `E:\_ARCHIVE-2026-08-16`
- **Product documents**: `E:\.PServer\Google_Drive\...\Ionity_Project_Gate^Flame\`
- **Premium-tier SIEM prior art** (Node.js/Express/Suricata/Prometheus stack): preserved at `E:\_ARCHIVE-2026-08-16\App-antigravity-workspace` — must not be deleted

---

**Current state**

The Gate^Flame stack comprises:
1. **Python/FastAPI node-agent** (agent v0.1.0, ~25 routes) running on the Pi
2. **React/TypeScript kiosk console** (6-file rebuild, bundle ~372 KB, no vendor motion/Recharts) — deployed and confirmed live at `192.168.0.10`; uses hand-rolled SVG charts and a `NotTheConsole` screen for LAN browsers that lack kiosk scope (HTTP 401 on scoped routes)
3. **Capacitor Android companion app**
4. **DNS filtering stack**: Pi-hole v6 + Unbound in Docker at `/home/wabapi/node-agent/dns-stack`

Recent commit `06699c6`: `tsc --noEmit` clean, 109/109 vitest passing with `NODE_ENV=test`, bundle built with correct title, all assets 200 on Pi.

**Active defects / outstanding work:**
- `threats.py` is still written against the Pi-hole v5 API (`/api.php?getAllQueries=`) — returns 400 on the v6 instance; this is the root cause of the empty threat log and needs updating to the v6 API
- The Pi-hole drop-in `40-pihole.conf` was never written by the installer, so `GATEFLAME_PIHOLE_URL` is unset in the agent; fix is re-running `install-dns-stack.sh` from `/home/wabapi/node-agent/`
- Network-wide DNS cutover (router set to `192.168.0.10` as sole DNS) was in progress but unconfirmed at end of last session — verification is whether Pi-hole's client count climbed past 3 as other household devices renewed DHCP leases

**SSH/Git auth state**: SSH private key is passphrase-protected (`SHA256:8AQd4NPdbhkzEXYT4Em4Xy9Lj2wlmMZg6dYDX2lrpEI`); must be loaded into Windows SSH agent for non-interactive use. Git remote auth uses Git's bundled SSH at `C:/PROGRA~1/Git/usr/bin/ssh.exe` with `core.sshCommand` set globally; `commit.gpgsign false` set globally.

---

**On the horizon**

- Verify network-wide DNS cutover (Pi-hole client count)
- Fix `threats.py` for Pi-hole v6 API compatibility
- Run `install-dns-stack.sh` to write `40-pihole.conf` and populate `GATEFLAME_PIHOLE_URL`
- Address two deprecation warnings: `@app.on_event` in `main.py:44,49` and `datetime.utcfromtimestamp()` in `wan.py:409,415`
- Router credential flow (one-time, held in memory, discarded after use) and per-vendor web UI adapters for DNS delivery guidance
- Watchdog/bypass mode implementation: after Pi-hole failure, enter bypass (plain Unbound, Quad9 + 1.1.1.1), restore unfiltered internet, retry filtering every 10 minutes; bypass flag at `/var/lib/gateflame/`

---

**Key learnings & principles**

- **No secondary DNS**: Secondary DNS is explicitly rejected — clients query both in arbitrary order, making filtering intermittent and inexplicable. Bypass mode replaces secondary DNS as the fallback strategy.
- **Kiosk authority must come from the socket, not the URL**: Inferring kiosk scope from URL path (`isKioskContext()`) caused LAN browsers to believe they had kiosk scope and then 401 on every action — fixed and pinned by tests.
- **`NODE_ENV=production` + `omit=dev` on Dennis's machine** will silently drop all devDependencies on every `npm install`; always verify devDependencies are present before blaming other causes for tooling failures.
- **`@types/react` / `@types/react-dom` must be explicit** in `package.json` — their absence causes silent `any` typing of all JSX, masking real type errors.
- **Rebuilding entirely beats patching** when corruption is pervasive in structured documents (nested fences, tables).
- **The product IS the kiosk**: the device experience is the product; avoid framing the kiosk as a secondary surface.
- **No enforcement without consent**: filtering cannot be enforced on users without their awareness; guided, transparent flows are the model.
- **Momentum over planning paralysis**: Dennis prefers iterative fixes and forward motion over exhaustive pre-planning.

---

**Approach & patterns**

- Dennis corrects Claude directly and specifically when Claude oversteps — respect corrections immediately and don't re-litigate
- Decisions on product scoping, content filtering policy, and user experience belong to Dennis; Claude's role is technical execution and honest evaluation
- Tests are a pinning mechanism: behavioral fixes get covered by tests so regressions are caught (e.g., kiosk authority scope)
- Deployment verification is done end-to-end against the live Pi, not just locally
- Desktop Commander MCP is used for unrestricted filesystem access across the Windows machine; Filesystem connector is scoped to `E:\.PServer`

---

**Tools & resources**

- **Languages/frameworks**: Python/FastAPI (agent), React/TypeScript/Vite (kiosk), Capacitor (Android app)
- **DNS stack**: Pi-hole v6 + Unbound in Docker
- **Build tooling**: Vite, vitest, tsc, `vite-plugin-singlefile`
- **MCP tools**: Desktop Commander (unrestricted filesystem), Filesystem connector (scoped to `E:\.PServer`)
- **Version control**: Git with bundled SSH, GitHub (`dennisGIonity/Gate-Flame`)
- **Hardware**: Raspberry Pi 5 16GB