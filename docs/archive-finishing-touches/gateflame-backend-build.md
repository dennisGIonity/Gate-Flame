```
========================================================================================
GATE^FLAME NETWORK SECURITY NODE — BACKEND BUILD RECORD
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-BE | Version: 2.0 | Updated: 2026-08-14 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Gate^Flame Backend — Build Record

> **STATUS (2026-08-14): commit `919856a` on branch `chore/repo-hygiene` is NOT PUSHED.**
> Same sandbox git-proxy 403 as every prior commit this project — `dennisGIonity/Gate-Flame`
> is not in this session's authorized repository set. A bundle
> (`gateflame-node-agent-and-pairing.bundle`) has been written directly to
> `C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\` on your machine,
> alongside the earlier `gateflame-branch.bundle`. This one is newer — use it.

## Security note (2026-08-14)

Two live GitHub PATs (a classic `ghp_...` and a fine-grained `github_pat_...`)
were pasted into chat this session. **Treat both as already disclosed and
revoke them** at https://github.com/settings/tokens and
https://github.com/settings/personal-access-tokens if you haven't already —
this is the same rule as the keystore and the old Gemini key: a credential
that passed through a session transcript is compromised regardless of whether
anyone used it. Generate a fresh token locally and use it only in a local git
credential prompt, never pasted into chat again.

## What happened to the previous build (v1.1 of this doc)

The build described in v1.1 of this doc — `node-agent`, commit `a4cf2c1`,
~15,000 insertions across nine modules (DPI, nftables bouncer, WAN budget,
zero-trust audit) — was **never recovered**. It lived only in that session's
ephemeral workspace on an unpushed branch, and the workspace was reclaimed
before the delivered bundle/patch were applied. It does not exist anywhere
now. If you still have `gateflame-node-agent.bundle` (193 KB) or
`gateflame-node-agent.patch` (632 KB) from that session on your own disk,
those are the only surviving copies — check before assuming this record is
your only option.

## What this session built instead: a clean-room rebuild

Not a restoration — a fresh implementation, deliberately scoped to what can
actually be built and tested inside a sandbox with no real Pi, no root, no
packet capture capability. `node-agent/` — Python 3.11, FastAPI, ~700 lines
across 10 modules plus 8 passing pytest cases.

| Module | What it does |
|---|---|
| `storage.py` | SQLite/WAL: node identity, pairing codes, paired devices. Owns the `provisioned` flag — see the fix below. |
| `security.py` | LAN-only (RFC1918/loopback/link-local) gate ahead of every route; scope enforcement where `kiosk` scope is synthesised from a loopback source address, never from a bearer token. |
| `main.py` | FastAPI app — all routes below. |
| `telemetry.py` | Real host stats: psutil CPU/mem/disk, `/sys/class/thermal`, `vcgencmd get_throttled`. |
| `clients.py` | Passive discovery only: `ip neigh` + dnsmasq/Pi-hole lease files. No probing. |
| `pihole.py` / `threats.py` | Optional Pi-hole HTTP API integration for real query/block/gravity/threat data. Without it: honest `null` + named gap, never a guess. |
| `services.py` | Module registry. Honest capability reporting — `not_implemented` with a named gap for anything not wired up, never a faked `running`. |
| `health_feed.py` | Outbound-only, health-fields-only loop per §4. Off by default. |

### Carried the revoke-all fix forward

The one defect from the lost build explicitly flagged as load-bearing: revoking
every paired device must never touch the node's `provisioned` flag, or a lost
phone re-arms first-boot admin (any tokenless loopback caller gets treated as
day-one setup). `storage.Store.revoke_all()` only ever touches the `devices`
table; `provisioned` is set once, on first successful claim, and nothing else
can unset it. Covered by
`test_revoke_all_does_not_unprovision_node` in `tests/test_pairing.py`.

### API routes (corrected against what the frontend already calls)

Two path mismatches were found and fixed against the already-committed
`gateflameApi.ts`/`nodeDiscovery.ts` (from commit `90c6757`, previous session):
`/api/v1/system/status` (not `/status`), `/api/v1/threats/recent` and
`/api/v1/modules/{id}/metrics` (not `/threats`, `/services/{id}/metrics`).
Everything else already matched.

```
GET    /api/v1/system/status            (LAN)
POST   /api/v1/pair/request             scope: kiosk
POST   /api/v1/pair/claim               scope: none (LAN)
GET    /api/v1/pair/devices             scope: read
DELETE /api/v1/pair/devices/{id}        scope: kiosk
POST   /api/v1/pair/devices/revoke-all  scope: kiosk
GET    /api/v1/telemetry/summary        scope: read
GET    /api/v1/threats/recent           scope: read
GET    /api/v1/clients                  scope: read
GET    /api/v1/services                 scope: read
GET    /api/v1/modules/{id}/metrics     scope: read
POST   /api/v1/services/{id}/start      scope: control
POST   /api/v1/services/{id}/stop       scope: kiosk
```

### Frontend: pairing UI added

- `src/services/gateflameApi.ts` — `requestPairingCode`, `claimPairingCode`,
  `pairedDevices`, `revokeDevice`. No mock fallback for pairing — it either
  talks to a real node or shows a real error.
- `src/components/KioskPairingScreen.tsx` — code display + live countdown,
  requested only when the kiosk has a live loopback connection.
- `src/components/AppPairingScreen.tsx` — discovery → code entry → claim,
  with distinct messages for wrong code / expired / rate-limited.
- `src/main-mobile.tsx` now gates on `hasToken()`: unpaired phones see
  `AppPairingScreen` instead of the dashboard.
- `src/main-kiosk.tsx` gained a "Pair a phone" toggle button.

### Verification actually performed (all inside this sandbox)

| Check | Result |
|---|---|
| `pytest node-agent/tests/` | **8/8 pass** — kiosk-only issuance, single-use codes, 5-wrong-guess lockout, per-IP rate limit, revoke-all/provisioned interaction, stop-requires-kiosk-not-control, non-LAN refusal |
| Live curl walkthrough (status → pair/request → pair/claim → telemetry) | passed, real token issued, real host telemetry returned |
| `tsc --noEmit` | clean |
| `npm run build:html-mobile` / `build:html-kiosk` | both succeed |

### What is explicitly NOT done, and why

Same three from the lost build's design, still not attempted, because none of
them can be honestly validated without root and a real kernel network stack:

1. **`module_firewall_bounce`** (nftables/iptables bouncer) — the lost build's
   worst defect was exactly here (unvalidated IP into an `nft` argv → `nft
   flush ruleset` via a crafted path param). Not rushing this back in without
   the same adversarial review it got last time.
2. **`module_dpi_flow`** (AF_PACKET SNI/Host parsing) — needs raw-socket
   capability and real traffic.
3. **`module_wan_audit`**, **`module_zero_trust`** — budget persistence and
   posture audit, lower priority than the two above.

Each reports `not_implemented` with a named gap via `/api/v1/services` — the
UI's existing `SimulatedBadge`/`DataSourceBanner` machinery means a customer
never sees a green light for a capability that isn't there.

## Recovering this commit

**Option A — you already have the bundle.** It's on your machine at
`C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-node-agent-and-pairing.bundle`.
From `C:\Users\DGMic\GateFlame-Repo`:

```bash
git fetch "C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-node-agent-and-pairing.bundle" chore/repo-hygiene:chore/repo-hygiene --force
git push origin chore/repo-hygiene   # generate a fresh PAT first — see security note above
```

**Option B — authorize the repo in-session and push directly**, if that
control exists in the Claude app: add `dennisGIonity/Gate-Flame` to this
session's sources, then `cd ~/gf && git push origin chore/repo-hygiene`.

## Open items for the next session

1. **Push `chore/repo-hygiene`** — see above. Time-sensitive; this session's
   workspace is ephemeral like every one before it.
2. **Real Pi hardware validation.** `psutil`, `/sys/class/thermal`,
   `vcgencmd`, `ip neigh` and the Pi-hole integration have only run in this
   container — no thermal zone, no `vcgencmd`, no real ARP table with live
   hosts on it. Flash a Pi, install per `node-agent/install.sh`, and confirm
   the numbers coming back are real device readings.
3. **Build the nftables bouncer**, with the same adversarial review the first
   attempt got — this is the one module where a shortcut is a security
   incident, not a missing feature.
4. **DPI (SNI/Host) and WAN budget modules.**
5. **Wire the health feed's server side** — `node-agent/health_feed.py` posts
   to `GATEFLAME_FEED_URL`; nothing at `feeds.ionity.today` exists yet to
   receive it.
6. Everything still open from the links-index / audit docs: keystore
   generation, `applicationId` decision, Gemini key rotation, POPIA review —
   unchanged, see `gateflame-STATE-resume-here.md`.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
