```
========================================================================================
GATE^FLAME — SUPPORT FEED RECEIVER (feeds.ionity.today)
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-FEED | Version: 1.0 | Updated: 2026-08-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# feed-receiver

The server side of the §4 support feed. `node-agent/gateflame/health_feed.py`
has been posting node health to
`https://feeds.ionity.today/api/v1/nodes/{nodeId}/health` every 15 minutes with
nothing on the other end. This is the other end, plus a small read API so
Ionity support can answer "is that unit alive, and what is degraded on it".

It is a separate service from `node-agent` on purpose. The agent runs on
customer hardware inside a customer LAN; this runs at Ionity. They share a
contract, not a process, and nothing here can reach into a customer network —
the node initiates, always (§4.3 rule 2).

## The one design constraint that shaped everything

`docs/PAIRING-AND-TELEMETRY.md` §4.1 is a promise Ionity has made to customers
in writing: the feed carries health fields and **never** domains, client IPs,
MACs, hostnames, threat logs, per-client DNS volumes, DPI/SNI output, Wi-Fi
SSIDs or geolocation. §4.2 explains the stakes — those fields are personal
information under **POPIA**, and receiving them would make Ionity a
responsible party with lawful-basis, processing-agreement, Information
Officer, breach-notification and retention duties it has deliberately designed
its way out of.

A promise that lives only in a document is broken by the first careless agent
build. This service is built so that breaking it requires a deliberate,
visible code change rather than a mistake.

**1. The schema is a closed allowlist, and unknown fields are a 422.**
Every model in `gateflame_feed/schema.py` sets `extra="forbid"` — including the
nested `host`, `modules[]` and `counters` objects, because a leak smuggled
inside `host` is just as effective as one at the top level. Pydantic's default
behaviour is to *drop* unknown keys, and that is the genuinely dangerous
option here: a buggy agent that started attaching `clientIps` would be
accepted, the field would quietly vanish, and the fleet would post personal
information at Ionity's endpoint for months with the only evidence sitting in
someone else's traffic logs. A 422 lands in the agent's own log the same day
(`health_feed._send_once` treats any status ≥ 300 as a failure). Loud and
broken beats quiet and leaking.

**2. Identifier shapes cannot express the forbidden data.** A field named `id`
is unremarkable; a field named `id` whose value is `bank.example.co.za` is a
leak with a boring name. Module ids match `^[a-z][a-z0-9_]{0,63}$` and
`nodeId` matches `^GF-[A-Z0-9]{4,8}(-[A-Z0-9]{4,8})?$` — neither can contain a
dot, a colon or a lowercase label, so neither can carry a hostname or an
address as a *value* even under an allowed key.

**3. Free text is checked where §4.1 allows free text at all.** `gap` and
`remedy` are prose from the module registry ("the named gap" is explicitly on
the *send* side of the §4.1 table). They are capped at 200 characters and
rejected if they contain something that parses as an IP or a MAC. The check is
deliberately narrow: it does **not** look for domain-shaped text, because the
real firewall gap says "…AmbientCapabilities=CAP_NET_ADMIN in
`gateflame.service`…", `gateflame.service` is domain-shaped, and a validator
that rejects honest reports is a validator someone switches off. Every real
gap string from `services.py` and `firewall.py` is in the test suite as a
no-false-positive case.

**4. The database has nowhere to put it.** This is the part that does not
depend on the schema being correct. `gateflame_feed/storage.py` has no
`payload` column, no `raw_json`, no BLOB and no key/value side table. The
module list gets its own table with named columns rather than the
`modules_json TEXT` that would have been three lines shorter. Even if
validation were bypassed, weakened by a future edit, or simply wrong, there is
no column a domain or a client IP could be written to. Storing a leak would
require a migration — and a migration that adds `client_ips` is something a
reviewer can see, whereas widening a JSON blob is not. `record_report()` binds
named attributes off a typed model; it never sees the request dict and never
does `**body`.

**5. The error path is not the leak.** FastAPI's default validation handler
echoes the rejected value back in an `input` key — which would put `domains`
and `clientIps` into the response body and into whatever proxy log sits in
front of the service. The custom handler in `main.py` returns field *names*
and reasons only. Nothing in this service logs a request body.

Tested in `tests/test_privacy_contract.py`, including the headline case: a
payload carrying `clientIps`, `domains` and `hostnames` is rejected with 422,
nothing is persisted, and none of the values appear in the response.

## The exact accepted payload

Anything not listed is a 422. The live version of this list is served
unauthenticated at `GET /api/v1/contract`, so the kiosk's "what we send"
screen (§4.3 rule 3) and any customer with `curl` can read it.

```jsonc
POST /api/v1/nodes/{nodeId}/health
Authorization: Bearer <per-node feed token>
Content-Type: application/json      // Content-Length required, ≤ 8192 bytes

{
  "nodeId":       "GF-A7K29QX4",    // required, ^GF-[A-Z0-9]{4,8}(-[A-Z0-9]{4,8})?$
                                    //   must equal the {nodeId} in the path
  "agentVersion": "1.0.1",          // required, ^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$
  "sentAt":       "2026-08-13T15:04:05Z",  // required, ISO-8601; see "Clock skew"
  "uptimeSeconds": 864000,          // required, int 0 … 3155760000

  "host": {                         // required object, all members optional/nullable
    "cpuPercent":       12.4,       // float 0–100
    "memUsedMB":        412,        // int 0–1048576
    "memTotalMB":       3906,       // int 0–1048576
    "diskUsedPercent":  38,         // float 0–100
    "tempC":            54.2,       // float -90–200, null where no thermal zone
    "throttleFlags":    "0x0"       // ^0x[0-9a-fA-F]{1,16}$, omitted without vcgencmd
  },

  "modules": [                      // optional, max 32 entries
    {
      "id":          "module_firewall_bounce",  // required, ^[a-z][a-z0-9_]{0,63}$
      "status":      "degraded",    // required: running | stopped | degraded |
                                    //           not_implemented | unknown
      "gap":         "no CAP_NET_ADMIN",                    // ≤200 chars, no IP/MAC
      "remedy":      "grant CAP_NET_ADMIN to the agent unit", // ≤200 chars, no IP/MAC
      "restarts24h": 0              // int ≥ 0
    }
  ],

  "counters": {                     // optional object, all members optional/nullable
    "errors24h":            3,      // int ≥ 0
    "restarts24h":          0,      // int ≥ 0
    "wanBudgetUsedPercent": 41      // float 0–1000, null until module_wan_audit exists
  },

  "piholeReachable": true           // bool or null
}
```

Responses:

| Status | Meaning |
|---|---|
| `202` `{"status":"stored", …}` | Accepted and persisted. Carries `clockSkewSeconds`, `clockSuspect`, `retentionDays`. |
| `202` `{"status":"duplicate", …}` | Byte-identical report already held. A retry, not an error. |
| `401` `{"error":"unauthorized"}` | Every auth failure, identically. See "Auth". |
| `411` / `413` | No `Content-Length`, or body over 8 KB (§4.3 rule 5). |
| `422` `{"error":"schema_rejected", "rejected":[…]}` | Field not in the allowlist, or out of range. |
| `422` `{"detail":{"error":"node_id_mismatch"}}` | Path `nodeId` ≠ body `nodeId`. |
| `422` `{"detail":{"error":"implausible_timestamp"}}` | `sentAt` before the epoch or 10+ years ahead. |
| `429` `{"detail":{"error":"rate_limited", …}}` | Per-node rate limit. Carries `Retry-After`. |

### Client/server mismatches found while building this

The suite in `tests/test_client_contract.py` imports `build_payload` from
`node-agent/gateflame/health_feed.py`, builds a real payload from a real
`Store` and real host telemetry, and posts that exact object. Three places
where the shipped client and `docs/PAIRING-AND-TELEMETRY.md` §4.4 disagree
were found that way, and in every case the **client** is authoritative and the
schema was widened to match it:

1. **`status: "not_implemented"`.** §4.4 shows only running/degraded/stopped.
   `services.py:module_status()` also emits `not_implemented` — for the three
   modules this build honestly does not implement — and `unknown` for an id
   absent from `MODULE_DEFS`. Accepting only the documented three would have
   422'd most of a real node's report.
2. **Optional/nullable host fields.** §4.4 shows a fully populated `host`.
   `telemetry.host_snapshot()` omits `throttleFlags` entirely on any host
   without `vcgencmd` and sets `tempC` to `null` where no thermal zone is
   exposed. Likewise `counters.wanBudgetUsedPercent` is `null` until
   `module_wan_audit` exists, where §4.4 shows `41`.
3. **`nodeId` alphabet.** §3.3 specifies base32, whose alphabet is `A-Z2-7`,
   and `storage._gen_node_id()` correctly produces only those characters — but
   §4.4's own worked example is `GF-A7K2-9QX4`, containing a `9` that base32
   cannot emit. Rather than 422 the identifier printed in the contract, the
   pattern accepts uppercase alphanumerics with optional grouping. The
   security property is unaffected: no dots, no colons, no lowercase.

Also noted, not changed here because it is out of scope: `modules[].remedy`
and `modules[].restarts24h` appear in §4.4 but `build_payload()` does not send
them. They are accepted as optional so the agent can start sending them
without a receiver change.

## Auth

Two credential types, deliberately kept apart (`gateflame_feed/security.py`).

**Node token** — one per appliance, minted at provisioning. It can post that
node's own health and read that node's own history. Nothing else.

**Admin token** — Ionity support, from `GATEFLAME_FEED_ADMIN_TOKEN`. Reads the
fleet, never posts health. It is not in the database, so no node token can
ever match it.

A node token presented for another node's data is rejected. So is a node token
on the fleet list, and so is the admin token on the ingest route. All of these
are tested explicitly.

### Every failure looks the same

No header, malformed header, unknown token, revoked token, a real token for
the wrong node — all return `401 {"error": "unauthorized"}` with nothing
further. Posting to `/api/v1/nodes/GF-DOESNOTEXIST/health` is byte-identical to
posting to a real node id with a wrong token. `nodeId`s are printed on
enclosure labels and read out on support calls (§3.3); an endpoint that
distinguished "no such unit" from "wrong credential" would be a free,
unauthenticated oracle for which units Ionity has sold and which are online.
Token lookup is by hash across the whole token table rather than "fetch this
node's tokens", so the work done is the same either way.

### Token storage: HMAC-SHA256 with an out-of-database pepper

Tokens are `secrets.token_urlsafe(32)` — 256 bits from the OS CSPRNG — and
only `HMAC-SHA256(pepper, token)` ever reaches the database.

*Why not bcrypt/argon2/scrypt.* Those are password hashes. Their cost factor
buys resistance to offline guessing of low-entropy, human-chosen secrets;
there is no guessing attack against 256 random bits to slow down. What a
deliberately slow hash would buy is a self-inflicted denial of service on the
authentication path of an endpoint every node in the fleet hits every 15
minutes.

*Why not a bare SHA-256.* `node-agent/gateflame/storage.py:_hash_token` uses a
bare digest (its comment says "salted", which it is not — worth fixing there;
out of scope for this directory). A keyless digest of a bearer token is
verifiable offline by anyone holding a database dump, and lets an attacker
confirm whether a token seen elsewhere belongs to this fleet. Keying it with a
pepper held **outside** the database means a stolen `feed.db` is inert on its
own. The pepper comes from `GATEFLAME_FEED_TOKEN_PEPPER`, or failing that a
`0600` sidecar file beside the DB — a separate file, since a pepper stored
inside `feed.db` would defend against nothing.

> Back the pepper up separately from the database. Losing it invalidates every
> node token in the fleet.

## Replay, idempotency and clock skew

**Replay.** `_send_once` returns `False` on any transport error, including a
response lost on the way back, so `HealthFeedLoop` re-posts byte-identical
content. Each report is keyed by a SHA-256 of its *validated model* (canonical
JSON, sorted keys) under a `UNIQUE (node_id, report_hash)` constraint, so a
retry returns `202 duplicate` and creates no row. Hashing the model rather
than the raw bytes means key reordering and `38` vs `38.0` still collapse to
one report. `sentAt` is part of the hash, which is what makes this a *replay*
key rather than a change-detector: the agent stamps a new second on every
genuinely new report.

The replay check runs **before** the rate limiter. If it ran after, a node
whose responses were being dropped would burn its entire hourly budget
re-sending a report the server already had, and then be unable to send the
next real one.

**Clock skew.** `sentAt` is node-controlled and therefore load-bearing for
nothing. Ordering, `lastSeen`, the online/stale/offline classification and
retention pruning all key on the server's `received_at`. A node claiming to be
in 2099 cannot make its rows immortal or park itself permanently at the top of
the support console; one claiming 1970 cannot have its rows pruned the instant
they land. Both cases are tested.

Skew is measured, stored, flagged (`clockSuspect` past ±24 h) and returned in
the response so it appears in the node's own log. The accept window is
asymmetric because the causes are:

- **Behind, any amount:** accepted. A Pi has no battery-backed RTC; a unit
  that boots before NTP lands honestly believes it is 1970. That unit is
  *exactly* the one support needs to see, so throwing its health away would be
  precisely the wrong failure mode.
- **Before the Unix epoch:** rejected. No UNIX clock produces that, however wrong.
- **More than 10 years ahead:** rejected. Not skew — fabrication.

## Rate limiting

Per node, not per source address: a fleet behind one carrier-grade NAT must
not share a budget, and a node's identity here is its token, not its IP.
Defaults are one accepted report per 60 s and 60 per hour — generous headroom
over the contracted 15-minute interval for restarts, backoff and manual
re-sends, while capping one broken node at ~1440 rows/day instead of a
disk-filling retry loop. A rate-limited report is not stored.

The limiter keeps exactly one row per node, so the limiter's own bookkeeping
can never be the thing that fills the disk. Body size is capped at the 8 KB
§4.3 rule 5 promises, refused in middleware on the declared `Content-Length`
before the body is read — a cap, not a complaint issued after the allocation.
A realistic report is under 2 KB.

## Retention and privacy stance

**90 days, then deleted.**

§4 does not state a lifetime for health data; §4.2 only lists "retention
limits and deletion on request" among the POPIA duties the health-only line is
designed to avoid. So a period is chosen here and implemented rather than left
to whoever eventually runs out of disk:

- A quarter covers warranty triage, "which units are on an old agent" (§4.1),
  and enough thermal history to see a fan failing gradually rather than only
  the moment it fails.
- §4.2's purpose-limitation principle argues for the shortest period that
  still serves support, and support questions are asked about recent
  behaviour. A year of CPU percentages answers no question the last quarter
  does not.
- It is short enough to state plainly to a customer, which is the test that
  matters: if the retention period is awkward to say out loud, it is wrong.

Pruning keys on `received_at`, runs inline on the accept path (throttled to
once a minute) and needs no cron job, no systemd timer and no second process
someone forgets to enable — the promise is kept by the only code path that can
create data. A hard per-node row cap (10 000, ≈104 days at the contracted
interval) applies independently, so even a misconfigured retention setting
cannot let one node grow without bound.

`DELETE /api/v1/admin/nodes/{nodeId}` erases a node completely — history,
module rows, tokens, rate state, identity. Health-only data mostly stays out
of POPIA's scope, but a support feed with no delete button is a bad answer to
a customer who asks.

Configure with `GATEFLAME_FEED_RETENTION_DAYS`. If you shorten it, say so on
the kiosk's "what we send" screen too.

## Running it

```bash
cd feed-receiver
python3 -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt

export GATEFLAME_FEED_DB_PATH=/var/lib/gateflame-feed/feed.db
export GATEFLAME_FEED_ADMIN_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
export GATEFLAME_FEED_TOKEN_PEPPER="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"

uvicorn gateflame_feed.main:app --host 0.0.0.0 --port 8081
```

Terminate TLS in front of it (nginx/Caddy). The agent posts to `https://` and
the token is a bearer credential; there is no plaintext deployment of this
service that is acceptable.

### Issuing a node token

Token issuance is CLI-only. There is no HTTP route that mints one:
provisioning happens at Ionity, on the machine holding the pepper, by someone
with a shell — one fewer remotely reachable path to a valid credential.

```bash
python -m gateflame_feed.cli issue-token GF-A7K29QX4 --label "unit 0142"
```

```json
{
  "tokenId": "nft-1a2b3c4d5e6f",
  "nodeId": "GF-A7K29QX4",
  "token": "hHqk…-only-shown-once"
}
```

Put it on the appliance:

```bash
GATEFLAME_FEED_TOKEN=<token>
GATEFLAME_FEED_URL=https://feeds.ionity.today/api/v1/nodes
GATEFLAME_FEED_ENABLED=true
```

The plaintext token is never stored and cannot be shown again — reissue
instead. Other subcommands: `list-tokens`, `revoke-token`, `list-nodes`,
`prune`, `delete-node`.

### Support read API

```http
GET    /api/v1/admin/nodes                      admin token
  → { "nodes": [ { "nodeId", "agentVersion", "firstSeen", "lastSeen",
                   "lastSeenAgeSeconds", "status", "reportCount",
                   "degradedModules" } ], "count": n }

GET    /api/v1/admin/nodes/{nodeId}/history?limit=50
                                                admin token, or that node's own
  → { "nodeId", "count", "retentionDays", "reports": [ … newest first … ] }

DELETE /api/v1/admin/nodes/{nodeId}             admin token — POPIA erasure

GET    /api/v1/contract                         no auth — the accepted field list
GET    /healthz                                 no auth — liveness, no node data
```

`status` is `online` (seen within 45 min, i.e. two missed posts tolerated),
`stale` (within 6 h), `offline`, or `never_seen`. It is computed from the
server's receive time, never from anything the node claims.

## Configuration

| Variable | Purpose |
|---|---|
| `GATEFLAME_FEED_DB_PATH` | SQLite/WAL state file. Default `/var/lib/gateflame-feed/feed.db`. |
| `GATEFLAME_FEED_HOST` / `GATEFLAME_FEED_PORT` | Listen address. Default `0.0.0.0:8081`. |
| `GATEFLAME_FEED_ADMIN_TOKEN` | Ionity support bearer token. Unset ⇒ admin routes answer `503`, never `401`. |
| `GATEFLAME_FEED_TOKEN_PEPPER` | HMAC key for node token hashes. Unset ⇒ generated into a `0600` sidecar. |
| `GATEFLAME_FEED_RETENTION_DAYS` | Default `90`. |
| `GATEFLAME_FEED_MIN_INTERVAL_SECONDS` | Minimum spacing between accepted reports. Default `60`. |
| `GATEFLAME_FEED_MAX_PER_HOUR` | Per-node hourly cap. Default `60`. |
| `GATEFLAME_FEED_MAX_BODY_BYTES` | Default `8192`, per §4.3 rule 5. |
| `GATEFLAME_FEED_MAX_ROWS_PER_NODE` | Hard per-node row cap. Default `10000`. |

## Tests

```bash
cd feed-receiver
python3 -m pytest -q
```

83 tests. What they cover, and why each is there rather than as a comment:

- **§4.1 enforcement** — forbidden fields rejected with nothing persisted and
  nothing echoed; every name in the "never send" column tested individually;
  nested objects strict too; identifier patterns that cannot hold a domain;
  free-text IP/MAC rejection *and* no-false-positive on every real agent gap
  string; the database's full column list asserted, with no JSON or BLOB
  column anywhere.
- **Auth** — no oracle for node existence, cross-node reads refused, admin and
  node credentials non-interchangeable, revocation, plaintext tokens absent
  from the whole DB file.
- **Replay and clock** — duplicate collapse, key-order independence, replays
  not consuming rate budget, 1970 and 2099 timestamps neither pruned early nor
  made immortal.
- **Limits and retention** — min interval, hourly cap, per-node isolation,
  8 KB cap, 90-day pruning including child rows, per-node row cap, pruning on
  the accept path.
- **Client contract** — the real `build_payload()` from `node-agent`, a real
  `Store`, real host telemetry, posted at the real route. This is the test that
  found all three mismatches listed above; a fixture written alongside the
  schema would have agreed with itself and disagreed with production.

**What these tests do not prove**: that a real fleet's traffic matches this
host's. The client-contract test runs `build_payload()` against *this*
machine, where there is no `vcgencmd`, no thermal zone and no Pi-hole, so the
`throttleFlags` and populated-`tempC` paths are exercised only by synthetic
fixtures. Point one real Pi at a staging instance before the first unit ships.

## Legal position

No GPL/AGPL/EUPL source is imported or vendored. FastAPI, Starlette, Pydantic
and uvicorn are MIT/BSD. Nothing here bundles or redistributes Pi-hole or any
part of the node's OS.

Not legal advice. §4.2's standing recommendation applies to this service too:
before the first unit ships, have someone who practises POPIA read the sale
agreement alongside §4.2 and the retention section above.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
