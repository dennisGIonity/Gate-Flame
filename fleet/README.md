# Gate^Flame Fleet Dashboard

The operator console every Gate^Flame box reports into — the billable surface. It receives
the check-in each node already sends (`node-agent/gateflame/health_feed.py`, off by default,
`GATEFLAME_FEED_ENABLED`) and shows which boxes are online, agent version, uptime,
CPU/RAM/disk/temperature, Pi-hole reachability, per-module status and gaps, support findings,
Shield state, 24h/7d/30d/90d trends, and your own admin record and support log per box.

**What boxes send:** health fields, plus the Shield devices an owner put on a VPN region (the
owner's own device name, MAC, region — a product decision of 2026-08-31, see `health_feed.py`).
**Never:** domains, query logs, client IP addresses, DPI output.

## Run it today — the Ionity offline server (this laptop)

```
tools\START-IONITY-SERVER.cmd
```

Starts the fleet (`fleet\.venv`, created on first run; secrets from `fleet\fleet.env.ps1`) on
`0.0.0.0:8091`, then the Ionity Local Drive, whose `/gateflame/` bridge fronts it, and prints:

| Address | What |
|---|---|
| `https://ionity.local/gateflame/` | dashboard via mDNS |
| `https://ionity.wifi.storage/gateflame/` | dashboard after hosts setup (Local Drive → Connect & Setup) |
| `http://<laptop-ip>:8080/gateflame/` | dashboard, plain HTTP via the Local Drive |
| `http://<laptop-ip>:8091/` | the fleet directly |

Autostart at boot/logon (elevated, run it yourself): `tools\install-fleet-autostart.ps1`. It
also registers the daily backup below.

**Back up `fleet\fleet.db`: `tools\FLEET-BACKUP.cmd`** (or `tools\fleet-backup.ps1`). It is the
customer trust store — the per-node tokens live there, and losing it 401s every box's own token
at once (boxes with the BUG-30 agent fix re-enrol by themselves; older ones cannot, and until each
box re-enrols the shared token could claim its id). SQLite online backup, safe while the fleet
runs, to `E:\Gateflame-backups\fleet\fleet-YYYYMMDD-HHMM.db` (never inside the repo), keeps the
last 30, prints the copy's integrity check and `nodes`/`tokens` counts. Restore: stop the fleet,
delete `fleet.db-wal`/`fleet.db-shm`, copy a backup over `fleet.db`, start it.

## Auth

- **Browser:** a login page sets a signed, HttpOnly, `SameSite=Strict` session cookie (Secure over
  HTTPS), 12 h by default. Pages without a session **redirect** to the login page — never a 401 —
  so a front door that bans on repeated 401s is not tripped by an expired session.
- **Scripts:** HTTP Basic works on every `/api/v1/...` route (`tools\fleet-verify.ps1`).
- **Rate limit:** 8 failed logins or Basic attempts per client address per 15 min → 429.
- **Nodes:** unchanged. `POST {GATEFLAME_FEED_URL}/{nodeId}/health` with `Bearer`; the shared
  `GATEFLAME_FLEET_TOKEN` only enrols a box, which then gets and must use its own token.
- **Re-imaged box / lost token:** its shared-token check-ins are refused while the console holds
  an activated token for it. Support forgets that token — the **Forget token (re-enrol)** button
  on the box's page, or `DELETE /api/v1/nodes/{nodeId}/token` (admin) — and the box's next
  check-in enrols it again. Only the token goes (history, notes, your record stay); the old token
  is dead at once; the support log records who did it. Nothing on file is a 404, not a success.

## Behind a reverse proxy, under a path

The app reads `X-Forwarded-Prefix`, `-Proto` and `-For` **only from trusted proxies**
(`GATEFLAME_FLEET_TRUSTED_PROXIES`, default loopback). The page uses only relative URLs plus a
server-rendered `<base href>`, so the same process works at `http://host:8091/` and at
`https://ionity.local/gateflame/`. Run uvicorn with `--no-proxy-headers` (all launchers here do),
otherwise uvicorn rewrites the client address first and the proxy looks untrusted.

## Move to a real server in 10 minutes

On a Linux VPS with Docker and a domain (say `feeds.ionity.today`):

1. **DNS:** point an A (and AAAA) record for the domain at the server. Do this first.
2. **Code:** copy this `fleet/` folder to the server, e.g. `/opt/gateflame-fleet`.
3. **Secrets:** `cp fleet.env.example fleet.env`, fill it in, `chmod 600 fleet.env`. Use the
   **same** `GATEFLAME_FLEET_TOKEN` as today (boxes that have not activated their own token yet
   still enrol with it) and set `FLEET_DOMAIN` / `FLEET_ACME_EMAIL`.
4. **Data:** stop the fleet on the laptop first (WAL: a copy of a running database can miss the
   last writes), then copy `fleet\fleet.db` to `data/fleet.db` on the server. (Or run
   `tools\fleet-backup.ps1` after stopping it and carry the newest backup: one self-contained,
   integrity-checked file.)
   `mkdir -p data && sudo chown 10001:10001 data`. Node tokens, history, admin records, notes
   and the session key all live in that one file.
5. **Start:** `docker compose up -d --build`. Caddy fetches the certificate automatically.
   Check: `curl https://feeds.ionity.today/healthz` → `{"ok":true}`.
6. **Boxes:** on each box set `GATEFLAME_FEED_URL=https://feeds.ionity.today/api/v1/nodes`
   (keep `GATEFLAME_FEED_ENABLED=true`, token unchanged) and restart `gateflame-node-agent.service`.
   Each box keeps its own token — it is in `fleet.db`, so nothing re-enrols.

No Docker? `deploy/gateflame-fleet.service` (systemd, secrets in
`/etc/gateflame-fleet/fleet.env`) + `deploy/Caddyfile.example`.

## Files

| File | |
|---|---|
| `app.py` | the service (FastAPI, SQLite) |
| `static/` | `index.html`, `login.html`, `assets/` (css, js, self-hosted fonts, mark) |
| `Dockerfile`, `docker-compose.yml`, `deploy/Caddyfile` | real-server packaging |
| `deploy/gateflame-fleet.service`, `deploy/Caddyfile.example` | systemd alternative |
| `fleet.env.example` / `fleet.env.ps1.example` | secrets templates (Linux / Windows) |
| `..\tools\fleet-backup.ps1`, `..\tools\FLEET-BACKUP.cmd` | online backup of `fleet.db` (Windows) |
| `requirements.txt`, `requirements-dev.txt` | pinned runtime / test dependencies |
| `test_*.py` | `python -m pytest -q` from this folder |

## Known limits

- **Remote control** does not exist: boxes post outward and nothing reaches back. The UI says so.
- **Consent screen:** per `docs/PAIRING-AND-TELEMETRY.md` §4.3 a customer's box should not have the
  feed on until the kiosk consent screen and kill toggle exist.
