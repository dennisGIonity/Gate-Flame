```
========================================================================================
GATE^FLAME — 📌 PINNED STATE / RESUME HERE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-STATE | Version: 8.0 | Updated: 2026-08-24 22:30 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ⭐ THE ONE THING OUTSTANDING

```bash
sudo bash /home/wabapi/node-agent/deploy-agent.sh
```

Two agent modules are staged on the Pi and not yet live: `blocklists.py` and
`main.py`, carrying the stale-error fix. Until it runs, the app correctly
reports `Not protecting you — Pi-hole unreachable` over a box that **is**
filtering, because the node's `last_error` is stale and nothing clears it.

Everything else is aligned. Repo, workstation and box were diffed module by
module on 2026-08-24; only those two differ.

---

# 1 — WHAT HAPPENED TODAY, IN ONE PARAGRAPH

The box had **never filtered anything since it was built**. Pi-hole was up,
gravity rebuilt cleanly, the agent said `active`, the installer printed "THE BOX
IS NOW FILTERING", and 131,068 queries went through unfiltered. The cause was one
word in the wrong place — `type` sent in the JSON body instead of the query
string, so every `POST /api/lists` returned **HTTP 400** — made invisible by a
discarded return value, and then papered over by four separate layers all
reporting green on top of it. Found by running the app on a real handset, which
also exposed that the mobile app had been dead-on-arrival for six days and that
its two crash fixes had never left a local-only branch on the C: drive.

---

# 2 — THE ESTATE

| | |
|---|---|
| **Node** | `GF-72TYTITQ`, agent 0.1.0, **provisioned: true**, filtering **verified live** |
| **Pi** | `raspberrypi`, user `wabapi`, Pi 5 16GB, Trixie. eth0 `192.168.0.10`, wlan0 `192.168.0.13` — still dual-homed on one /24, port 53 on `.10` only |
| **Router** | TP-Link EX511 v2.0. **Still not forwarding to the box** — only Wabakipi is filtered, because its DNS is set manually |
| **Workstation** | `Wabakipi`, `192.168.0.7`, DNS manually → `192.168.0.10` |
| **Repo** | `E:\Gateflame`, branch `fix/mobile-dns-drops`, clean, pushed |
| **SSH** | PC → Pi **now works**. The key was registered on the Pi 2026-08-24; before that it had never been |
| **Test device** | BlueStacks. `Rvc64` (Android 11) is stable; the `Tiramisu64` "APP Test" (Android 13) crashed out three times — likely RAM with two instances running |

**Filtering, proven 2026-08-24 22:0x SAST** — five known ad domains resolve to
`::` through `192.168.0.10`, `github.com` resolves normally, 895 blocked of
130,066. Gravity holds 82,562 domains.

---

# 3 — TODAY'S COMMITS (all pushed)

| | |
|---|---|
| `7742dd5` | IoniBot: ADR-001 rewrite of the tree, and mounted in the app at last |
| `9a53f63` | Recovered: the import cycle that killed the app on launch |
| `6d37904` | Recovered: `allowMixedContent`, and revocation being ignored |
| `df24d31` | `protectionStatus` could say active on a box that was not filtering |
| `b00a8c0` | …and now asks Pi-hole rather than trusting local intent |
| `87168f0` | Every Pi-hole write checked and read back; `reconcile()` on boot |
| `b4f46e0` | **The root cause** — list type belongs in the query string |
| `c6586a2` | A null figure killed the app on the first screen after pairing |
| `0c96f73` | Deleted the dropped kiosk; promoted the mobile plan out of scratch |
| `b630554` | **Scrapped the old mobile app**, rebuilt on the console's engine |
| `2df4a13` | Repo identity, and dropped what nothing imports |

---

# 4 — WHAT CHANGED ARCHITECTURALLY

**The phone and the console now share one engine.** `kioskClient.ts` gained an
injectable transport (`configureNodeTransport`), so the phone supplies a remote
base URL and a bearer token while the console stays same-origin with no auth
header. Every endpoint, response type, formatter and honesty rule is described
exactly once. The old mobile app kept its own half-copy and drifted until the
two disagreed about the same network; that is what made it unsalvageable.

**New mobile app** lives in `src/mobile/` — seven screens (Home, Activity,
Blocked, Network, Health, Settings, Play), IoniBot as a bubble, Ionicrobes kept.
Bundle **841 kB → 285 kB**: recharts and motion are gone from the phone because
the console's charts are hand-rolled SVG.

**`ProtectionStatus` gained `degraded` and `unconfigured`.** Widening the type
immediately caught that `ConsoleLock` had no face for either — the box's own
lock screen would have shown a reassuring status over an empty blocklist.

---

# 5 — TRAPS, STILL TRUE

- **Windows OpenSSH is broken** on wabakipi. Only Git's copy works. Never set
  `GIT_SSH_COMMAND`.
- **The push failure is NOT an agent problem, and diagnosing it as one has now
  cost two sessions.** `~/.ssh/id_ed25519` is **unencrypted**, so no agent is
  involved at any point — ssh reads the file directly. Verbose ssh confirms it
  is offered (`Offering public key: … SHA256:8AQd4N…`) and GitHub still answers
  `Permission denied (publickey)`. There is exactly one cause: **the key is not
  registered on the account.** Before touching `ssh-agent`, run
  `"C:\Program Files\Git\usr\bin\ssh.exe" -T git@github.com -v` and read what
  it says; if it offers a key and is refused, the fix is on github.com, not here.
- **`GATEFLAME-load-ssh-key.cmd` was itself broken** and is now fixed. It tried
  to `printf >` a path that was already a live socket, silently failed, and left
  every tool pointing at a dead agent. It is also, per the point above,
  **irrelevant to this push** — an unencrypted key needs no agent.
- `NODE_ENV` is wrong on both machines — `production` + npm `omit=dev` here,
  `development` on the Pi. The rule is **per step, and the spacing matters**:
  - `npm ci` → `set NODE_ENV=&& npm ci …` (must NOT be `production`)
  - `vite build` → `set NODE_ENV=production&& npm run build:…`

  In cmd, `set VAR=value` swallows trailing spaces, so `set NODE_ENV= && …`
  assigns a **single space** — which is not `production`, so Node resolves
  React's `development` export condition and Vite bundles the dev build into a
  production artifact at 382 kB instead of 189 kB. That is the form this
  document used to recommend, and it shipped dev bundles for weeks.
  `scripts/verify-bundle.mjs` now fails the build rather than let it happen.
- The Pi's `/home/wabapi/node-agent/` is **staging**; the agent runs from
  `/opt/gateflame/node-agent/` and is root-owned. Deploy via the script.
- `pihole` is **`gateflame-pihole`**, and the image has no standalone `sqlite3`
  — use `pihole-FTL sqlite3`.
- cmd.exe `\"` breaks pipes. Write a `.sh`, scp it, run it.

---

# 6 — CREDENTIALS

- 🔴 **Rotate the Pi-hole admin password.** It was exposed in a session
  transcript on 2026-08-24 via `systemctl show -p Environment`, which dumps the
  whole environment. Rotate with the sed + `install-dns-stack.sh` pair; the new
  value never needs to leave the box.
- 🔴 Two GitHub PATs and the `GEMINI_API_KEY` — open since 14 Aug. A live
  plaintext copy of the Gemini key is still in `TempGateFlameBuild\.env.local`.
- 🔴 Release keystore exists at `~/.gateflame-signing/gateflame-release.jks`.
  **Not backed up, fingerprint not recorded.** No recovery path if lost.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
