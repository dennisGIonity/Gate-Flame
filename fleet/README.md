# Gate^Flame Fleet Dashboard

Receives the health check-in every node already sends (`node-agent/gateflame/health_feed.py`,
off by default, `GATEFLAME_FEED_ENABLED`) and shows it on one page: which boxes are online,
agent version, uptime, CPU/RAM/disk/temp, Pi-hole reachability, per-module status, error and
restart counts. Nothing else — no domains, no client IPs, no hostnames, no threat logs. Matches
the field list in `docs/PAIRING-AND-TELEMETRY.md` §4.1 exactly, on purpose.

**Not built into `ionity-local-drive` on purpose.** That project is a per-LAN, single-instance,
no-cloud file-drive app — the opposite shape of a public multi-tenant fleet receiver. This is a
separate ~250-line service so it can move to a different box, a different language, or a
different auth model later without touching that codebase at all.

## Why it's not wired up yet

Two things stop this from doing anything useful today, in order:

1. `feeds.ionity.today` doesn't resolve. There is no server yet. Point DNS at wherever this
   ends up running, or use a different domain/subdomain — the code doesn't care what it's
   called.
2. Every node has `GATEFLAME_FEED_ENABLED=false` by default. Nothing reports anywhere until
   you flip that (see "Pointing a node at this" below) — and per `docs/PAIRING-AND-TELEMETRY.md`
   §4.3, that's deliberately consent-gated for real customer units: a kiosk consent screen and
   a kill toggle are supposed to exist before a *customer's* box has this on. Neither is built
   yet. Turning it on for your own dev/test Pi right now is fine; don't ship it live to a
   customer unit until that screen exists.

## Run it

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
GATEFLAME_FLEET_TOKEN=<shared-secret> \
GATEFLAME_FLEET_ADMIN_USER=admin \
GATEFLAME_FLEET_ADMIN_PASSWORD=<pick-one> \
./venv/bin/uvicorn app:app --host 127.0.0.1 --port 8090
```

It refuses to start without both `GATEFLAME_FLEET_TOKEN` and `GATEFLAME_FLEET_ADMIN_PASSWORD` —
that's deliberate, not a bug.

## Deploy to your own/rented server

1. Copy this folder to the server (`scp -r gateflame-fleet user@host:/opt/`).
2. `deploy/gateflame-fleet.service` — a systemd unit. Edit the two `CHANGE_ME` values, then:
   ```bash
   sudo cp deploy/gateflame-fleet.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now gateflame-fleet
   ```
3. `deploy/Caddyfile.example` — reverse proxy with automatic free HTTPS. Point your domain's
   DNS A record at the server first, then:
   ```bash
   sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile   # edit the domain name in it
   sudo systemctl reload caddy
   ```
4. The dashboard is now at `https://<your-domain>/` — browser will prompt for the admin
   user/password you set in the systemd unit.

Nothing here is tied to a specific host or domain — this genuinely is "deploy anywhere, migrate
later." SQLite is a single file (`fleet.db`); moving servers is copying that file plus the repo.

## Pointing a node at this

On the Pi (or wherever node-agent runs), set:

```bash
GATEFLAME_FEED_ENABLED=true
GATEFLAME_FEED_URL=https://<your-domain>/api/v1/nodes
GATEFLAME_FEED_TOKEN=<same shared secret as GATEFLAME_FLEET_TOKEN above>
```

and restart the agent. It'll start posting within one `GATEFLAME_FEED_INTERVAL_SECONDS`
(default 900s / 15 min).

## Known shortcut — read before adding real customer units

Every node currently authenticates with the **same shared token**
(`GATEFLAME_FLEET_TOKEN` == every device's `GATEFLAME_FEED_TOKEN`). That's what the existing
client code (`health_feed.py`) already does — this server matches it rather than inventing a
new contract. But `docs/PAIRING-AND-TELEMETRY.md` §4.4 documents **per-node tokens issued at
provisioning**, which is the right design once more than one physical customer has a box:
a token leaked from one device shouldn't let anyone post as every other device. The `tokens`
table in `app.py` is already there for this — wiring it up is a follow-up, not a rewrite.
