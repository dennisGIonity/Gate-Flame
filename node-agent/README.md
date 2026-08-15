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

### `module_firewall_bounce` — implemented 2026-08-14

`gateflame/firewall.py`, with the adversarial review the previous attempt's
critical defect earned. That build put an unvalidated IP straight into an
`nft` argv, so a crafted path parameter could reach `nft flush ruleset` and
take down the firewall of a device sold as a security appliance.

The rebuild makes that class of bug unreachable rather than merely filtered:

- argv lists only, `shell=False`, one `subprocess.run` in the whole module;
- the ruleset is a **constant** — no f-string, no `%`, no `.format()` — and
  nothing at runtime ever writes a *rule*, only set elements;
- validation parses with `ipaddress.ip_address()` and forwards
  `str(parsed)`, a stdlib-generated value, so caller text stops existing at
  the boundary;
- deny-by-default on the target: loopback, multicast, unspecified, public
  addresses, the node itself and the default gateway are all refused with a
  named reason, because each of those bounces is a self-inflicted outage;
- every bounce carries an nftables `timeout` (30 s – 24 h), so it self-heals
  even if the agent dies; there is no way to express a permanent bounce;
- the table is `policy accept`, so the worst-case failure is "the bouncer
  does nothing", never "the LAN goes dark".

93 tests, including the historical injection payload as an explicit
regression case. Endpoints: `POST /api/v1/firewall/bounce`,
`DELETE /api/v1/firewall/bounce/{address}`, `GET /api/v1/firewall/bounced`.

**Still needs real-hardware validation** — run `./validate-on-pi.sh` on the
Pi. Without `CAP_NET_ADMIN` the capability probe reports `degraded` and the
exact remedy, never a green light over a bouncer that cannot drop a packet.

It deliberately does **not** yet implement, and says so at `/api/v1/services`:

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
