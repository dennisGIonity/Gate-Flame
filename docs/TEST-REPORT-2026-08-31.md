```
========================================================================================
GATE^FLAME — TEST REPORT
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-08-014-TEST | Version: 1.0 | Run: 2026-08-31 01:30–01:45 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Classification: INTERNAL | Building Tomorrow, Today.
========================================================================================
```

# What this is

Every test I could actually run against Gate^Flame, on 2026-08-31, across the
three surfaces: **kiosk console**, **mobile app**, **fleet dashboard**, plus the
**node agent** they all depend on.

**Everything below was observed, not assumed.** Where a check could not be run,
it says so rather than being counted as a pass. Where something failed, the
cause was traced before it was written down.

---

# 1 — HEADLINE

| Suite | Result | Notes |
|---|---|---|
| **Node agent — pytest** | **547 passed, 5 failed** | All 5 failures are **pre-existing**, proven at a pre-session commit. Not regressions. |
| **Frontend — vitest** | **187 passed, 0 failed** (11/11 files) | Only with `NODE_ENV` cleared. With this machine's default `NODE_ENV=production`, 34 fail — see §3. |
| **TypeScript — `tsc --noEmit`** | **clean** | Run after every change, exit 0. |
| **Python — `py_compile`** | **clean** | All node modules + the fleet server. |
| **Live node routes** | **30 of 30 answering** | Two apparent 404s were my own wrong paths, corrected and re-run. |
| **Kiosk build + install** | **pass** | Bundle verified by re-read on the box after installing. |
| **Mobile build + install** | **pass** | APK confirmed on disk and `lastUpdateTime` confirmed on the handset. |
| **Fleet API + auth** | **pass** | 6/6 auth-rollout assertions, admin round-trip, live Pi still feeding. |
| **DNS filtering** | **pass** | 359,667 domains; blocks a tracker, resolves a clean domain. |

---

# 2 — NODE AGENT (pytest)

```
547 passed, 5 failed, 5 warnings in 3.73s
```

Run as: `GATEFLAME_DB_PATH=/tmp/gf-test/state.db python3 -m pytest -q`

### ⚠ The suite does not run out of the box

Without `GATEFLAME_DB_PATH`, collection **crashes** — three test files import
`gateflame.main`, which constructs `Store(config.db_path)` at module import,
which tries to `mkdir /var/lib/gateflame` and hits `PermissionError` for any
non-root user.

That is a genuine papercut: a fresh clone cannot run its own tests without
knowing an undocumented environment variable. See BUG-01 in the function
report.

### The 5 failures, and why they are not mine

| Test | Symptom |
|---|---|
| `test_blocklist_readback::test_a_successful_apply_still_succeeds` | expects 1 list URL, gets 3 |
| `test_blocklist_readback::test_reconcile_repairs_an_empty_box` | same |
| `test_blocklist_readback::test_reconcile_is_cheap_when_everything_already_agrees` | `gravity_runs == 1`, expected 0 |
| `test_dns_watchdog_lan::test_missing_lan_ip_degrades_loudly_but_does_not_hard_fail` | got `VERDICT=unhealthy`, expected healthy |
| `test_filtering_honesty::test_a_stale_error_is_dropped_when_pihole_contradicts_it` | got `degraded`, expected `active` |

**Proven pre-existing.** I checked out commit `3f08d33` — the state of the repo
*before* any of this session's work — into a separate worktree and ran the same
three files:

```
5 failed, 22 passed        ← identical 5 failures, at the base commit
```

Cause: commit `dd76ec7` ("broaden threat-level lists") took the `low` threat
level from one blocklist to three. The live box confirms it —
`blocklistCount: 3`. The tests were never updated to match. The other two look
like fixture drift in the same family.

**None of my commits touch any of the implicated files** — verified with
`git log 3f08d33..HEAD -- <file>` for `blocklists.py`, `threat_level.py`,
`filtering_state.py`, `dns-watchdog.sh` and `pihole.py`: no results.

---

# 3 — FRONTEND (vitest)

### First run: 34 failed

Every failure was the same line: `TypeError: React.act is not a function`,
thrown from `react-dom/cjs/react-dom-test-utils.**production**.js`.

### Cause found, not guessed

The filename says it: React was loading its **production** build inside a test
runner, and React ships `act()` only in development. This machine has
`NODE_ENV=production` set globally — which `CLAUDE.md` already documents as a
trap for `npm ci` silently stripping devDependencies. It bites vitest too.

```
NODE_ENV before: 'production'
$env:NODE_ENV = "test"

Test Files  11 passed (11)
     Tests  187 passed (187)
```

**187/187, zero failures.** Nothing was wrong with the code.

I also ruled out my own change first: I edited `vite.config.ts` this session
(added the dev-builds plugin), so I checked whether vitest even reads it — it
does not. `vitest.config.ts` is a separate file and the plugin never loads
under test. My first attempt to prove this by running vitest against the old
config was **invalid** (it overrode the real test config and produced a worse,
meaningless result); the correct check was reading `vitest.config.ts`.

**Action:** builds and tests on this machine must clear `NODE_ENV` first. See
BUG-02.

---

# 4 — LIVE NODE AGENT (the real Pi, `GF-72TYTITQ`)

Every registered route, called on the box:

| Route | Result |
|---|---|
| `/system/status` `/system/kiosk` | 200 |
| `/telemetry/summary` `/filtering` | 200 |
| `/clients` `/services` `/threats/recent` | 200 |
| `/vpn/regions` `/vpn/continents` `/vpn/devices` | 200 |
| `/vpn/devices/{mac}` | 200 |
| `/wan/summary` | 200 |
| `/flows/recent` | 200 |
| `/posture/audit` `/posture/netcheck` | 200 |
| `/firewall/bounced` `/pair/devices` | 200 |
| `PUT /clients/{mac}/name` | 200 |
| `POST /console/unlock` | **503** — correct: no PIN is configured on this box, and the route says so rather than accepting anything |

> **A correction on my own method:** my first pass reported `/wan` and
> `/dpi/flows` as 404. Those were **my wrong paths**, not missing routes — the
> real ones are `/wan/summary` and `/flows/recent`, and both return 200. I only
> caught it by dumping the actual route table out of `main.py` instead of
> trusting my own list. Worth recording: a 404 in a hand-written checklist is
> more often a typo than a bug.

Also noted: `/posture/netcheck` **exists and answers**. The STATE doc had it
listed as a missing route; that item is resolved.

---

# 5 — DEVICE NAMING (new this session, tested live)

Exercised against the running agent, not a mock:

| Check | Result |
|---|---|
| Name a device via `PUT /clients/{mac}/name` | 200, label becomes "Dennis S10e" |
| Read back from a **fresh** `GET /clients` | persisted |
| Bad MAC (`not-a-mac`) | **400**, not stored |
| Clear the name (`""`) | label reverts to the raw MAC — the honest fallback |
| Re-name | restored |
| De-duplication | **17 raw neighbour rows → 4 real household devices** |
| Vendor lookup | workstation → `Intel 1A00`, router → `TP-Link 1E8B` |
| Randomised MACs | correctly identified; no vendor invented |

---

# 6 — KIOSK CONSOLE

| Check | Result |
|---|---|
| `/device-kiosk/` served by the node | 200 |
| Shield panel present in the **installed** bundle | confirmed by `grep` on the box after install |
| Install verified by re-read, with rollback on failure | pass |
| `gateflame-kiosk.service` | active |
| `gateflame-node-agent.service` | active |
| Resolver untouched during deploys | confirmed — DNS kept serving |

---

# 7 — FLEET DASHBOARD

### Per-node token rollout — 6/6 assertions

The important one. Written in **Python** after a PowerShell version mixed its
own log output into the value it returned and reported a pass it had not
observed. *A test that can lie is worse than no test.*

```
1. brand new box enrols with the shared installer token   [OK] 201 + token
2. OLD agent posts again with the shared token            [OK] still accepted
3. upgraded agent posts with its OWN token                [OK] 204, activates
4. shared token now REFUSED for that box                  [OK] 401
5. its own token keeps working                            [OK] 204
6. a stranger's token                                     [OK] 401
ALL PASSED
```

Step 2 is the one that matters: an earlier version of this code returned **401**
there, which would have silently killed the feed of every box already in the
field on its next check-in. Caught in test, before deploy.

### Other fleet checks

| Check | Result |
|---|---|
| `GET /healthz` unauthenticated | 200 |
| `GET /` **without** auth | **401** — correctly refused |
| `GET /api/v1/nodes` with auth | 200 |
| Admin save (label, ref, tags, billing) | round-tripped; came back as filter chips in the summary |
| Support note | persisted, appears in the log |
| History | 12 points, correctly labelled "5 minute samples" |
| Live Pi still feeding after the auth change | **yes** — last seen 171s ago |
| Schema migration on an existing DB | pass, after fixing a real bug (see §9) |

---

# 8 — DNS FILTERING (the actual product)

| Check | Result |
|---|---|
| Gravity domains | **359,667** |
| Registered blocklists | 3, all enabled |
| `protectionStatus` | `active` |
| `doubleclick.net` asked directly | **`0.0.0.0`** — blocked |
| `ionity.today` asked directly | `185.199.109.153` — resolves normally |

⚠ The Pi's own `/etc/resolv.conf` still points at the router, so a lookup run
*on the Pi* resolves trackers normally. That is known fault #2 (the router does
not forward to the box), not a filtering failure.

---

# 9 — BUGS I FOUND AND FIXED DURING THIS RUN

| # | Bug | How it was caught |
|---|---|---|
| 1 | Per-node tokens broke existing boxes on their 2nd check-in (401) | Wrote the test before trusting the design |
| 2 | `CREATE TABLE IF NOT EXISTS` does not add a column, so an existing fleet DB 500'd on every read of `activated_at` | The 500 appeared in a live test run |
| 3 | `ship-apk2.ps1` installed from `release/` without refreshing it — silently reinstalled the **previous** build | Noticed the copy step was missing before claiming the install |
| 4 | Assistant bubble covered the last row of the bottom card on the phone | Screenshotting the real handset instead of assuming |
| 5 | I wrongly "corrected" `CLAUDE.md` to say sudo is passwordless | The next deploy failed; `sudo -n` had only succeeded inside the credential cache window |

---

# 10 — WHAT COULD NOT BE TESTED

Stated plainly rather than left as an implied pass:

- **Remote support actions** — do not exist. Nodes post outward only; there is
  no channel back. Nothing to test until the control plane exists.
- **Ionity's own VPN exit servers** — `controlPlaneReachable: false`. Every
  region on offer today is VPN Gate.
- **Multi-node fleet behaviour at scale** — only one real box reports. Filters,
  sorting and the 90-day rollup are exercised by code but not by 400 devices.
- **The release (signed) APK** — only debug builds were made; the keystore
  properties file has still never been written.
- **On-device visual QA of every mobile screen** — Home was screenshotted
  before and after. The other six were changed by text edits, type-checked and
  built, but not individually photographed.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
