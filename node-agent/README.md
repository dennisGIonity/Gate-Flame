# node-agent

The backend that runs on the Pi appliance. Implements the pairing contract and
the API surface the dashboard (`src/services/gateflameApi.ts` in the main
repo) already calls.

## Status: rebuilt from scratch, honestly scoped down

A previous, much larger implementation (~15,000 insertions across nine
modules — DPI, an nftables bouncer, WAN budget accounting, zero-trust posture
audit) was written in an earlier session but never reached `origin/main`: it
lived only in an ephemeral sandbox workspace on an unpushed branch, and that
workspace was reclaimed before it could be recovered. It no longer exists
anywhere. This is a clean-room rebuild, not a restoration.

This rebuild implements, for real:

- The full pairing contract (§3 of `docs/PAIRING-AND-TELEMETRY.md`): six-digit
  codes, 5-minute expiry, single use, 5-attempt lockout, per-source-IP rate
  limiting, kiosk-only issuance, `read`/`control`/`kiosk` scopes, and the
  `provisioned` flag fix so revoke-all can never re-arm first-boot admin.
- LAN-only + loopback-only enforcement ahead of every route.
- Real host telemetry (CPU/mem/disk/thermal/throttle) via `psutil` and
  `/sys/class/thermal` / `vcgencmd`.
- Real client listing via the kernel neighbour table and dnsmasq/Pi-hole lease
  files — passive only, no probing.
- Optional Pi-hole integration for query counts, block percentage, gravity
  size and the threat log, when `GATEFLAME_PIHOLE_URL` is configured.
- An outbound-only, health-fields-only feed loop per §4, off by default.
- A module registry that reports `not_implemented` with a named gap rather
  than a faked `running` for anything not yet wired up.

It deliberately does **not** yet implement, and says so at `/api/v1/services`:

- `module_firewall_bounce` — the nftables/iptables bouncer. Needs
  `CAP_NET_ADMIN` and validation against a real kernel netfilter stack; the
  previous build's critical defect (unvalidated IP straight into an `nft`
  argv, allowing `nft flush ruleset` via a crafted path parameter) is the
  reason this isn't rushed back in without the same adversarial review.
- `module_dpi_flow` — AF_PACKET SNI/Host parsing. Needs raw-socket capability
  and real traffic to test against; a sandbox container has neither.
- `module_wan_audit` — persisted monthly data budget, jitter/loss measurement.
- `module_zero_trust` — posture audit and hardened-unit generation.

None of these are silently faked. The UI's `SimulatedBadge`/`DataSourceBanner`
architecture (see the main repo's `src/services/mockAdapter.ts` and
`gateflameApi.ts`) means a customer never sees a green light for a capability
that isn't there — they see `not_implemented` and the gap.

## Running it

```bash
cd node-agent
python3 -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
uvicorn gateflame.main:app --host 0.0.0.0 --port 8080
```

Point the dashboard at it with `VITE_NODE_BASE_URL=http://<pi-address>:8080`.

## Tests

```bash
python3 -m pytest tests/ -v
```

8 tests, all passing in this sandbox, covering the pairing/security contract:
kiosk-only issuance, single-use codes, the 5-wrong-guess lockout, per-IP rate
limiting, the revoke-all/provisioned interaction, and stop-requires-kiosk
scope enforcement.

**What these tests do not prove**, because nothing in this sandbox can: that
`/sys/class/thermal`, `vcgencmd`, `ip neigh`, and a real Pi-hole install behave
the same way on an actual Raspberry Pi as the fallback paths behave here. That
is real-hardware validation item #8 in the outstanding list — flash a Pi, run
`bash node-agent/install.sh`, and confirm the fields that come back are real
readings, not just "didn't crash."

## Configuration

| Variable | Purpose |
|---|---|
| `GATEFLAME_DB_PATH` | SQLite state file. Default `/var/lib/gateflame/state.db`. |
| `GATEFLAME_HOST` / `GATEFLAME_PORT` | Listen address. Default `0.0.0.0:8080`. |
| `GATEFLAME_PIHOLE_URL` | e.g. `http://127.0.0.1` — enables real query/block/client/threat data. |
| `GATEFLAME_FEED_ENABLED` | `true` to start the outbound health feed loop. Off by default. |
| `GATEFLAME_FEED_URL` / `GATEFLAME_FEED_TOKEN` | Health feed endpoint and per-node bearer token, issued at provisioning. |
| `GATEFLAME_FEED_INTERVAL_SECONDS` | Default `900` (15 min), per §4.3 rule 5. |

## Legal position

No GPL/AGPL/EUPL source is imported or vendored. Pi-hole is reached over its
own HTTP API as a separate running program; `ip` and `vcgencmd` are invoked as
separate OS-supplied binaries. Nothing here bundles or redistributes either.
