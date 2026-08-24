```
========================================================================================
GATE^FLAME — PINNED STATE / RESUME HERE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-017-STATE | Version: 9.0 | Updated: 2026-08-17 19:20 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# PINNED — 2026-08-17 19:20 SAST (v9.0, supersedes v8.0)

Everything below was read live, not recalled.

## Git

| Ref | SHA | Note |
|---|---|---|
| `main` | `70dda20` | **NOT merged** — still yesterday's state |
| `feat/kiosk-and-icons` | `de01ace` | pushed |
| `feat/kiosk-console` | `de01ace` | pushed |
| `refs/tags/v1.0.2` | **`70dda20`** | 🔴 **WRONG COMMIT** — tagged old main by mistake |
| Working copy | `E:\Gateflame`, on `feat/kiosk-console`, clean except `?? claude/` |

## CI — green, and it now means something

| Run | SHA | Result |
|---|---|---|
| `feat/kiosk-and-icons` | `de01ace` | **success** |
| `feat/kiosk-console` | `de01ace` | **success** |
| `feat/kiosk-console` | `d127262` | failure (fixed by `de01ace`) |

Jobs: `verify` (typecheck, 4 builds, 109 vitest, hygiene gates) · `backend`
(441 pytest, ruff reported, agent boot check) · `audit` (npm advisories).

## Pi

`192.168.0.10` · agent `GF-72TYTITQ` v0.1.0 · kiosk serving **`Gate^Flame Node Console`**
· Pi-hole v6 filtering (2576 queries / 624 blocked / 24.2% / 98950 gravity)
· **`provisioned: false`** — no phone has ever paired.

## Credentials

| Item | State |
|---|---|
| Keystore `gateflame-release.jks` | DONE — created, valid JKS, 3932 b |
| SHA-256 `AB:F9:6D:F7:FF:E3:2F:FC:2D:A1:22:A4:B9:70:96:3E:1D:E8:C7:F8:D8:9A:D6:27:72:F6:1F:82:81:05:E2:7D` | DONE — recorded |
| Backup — OneDrive | DONE — present |
| Backup — Google_Drive | DONE — present |
| Vault backed up to both clouds | DONE — present |
| Gemini `.env` copies | DONE — **0 remaining** |
| KeePassXC master password changed | 🔴 unknown — was pasted in chat |
| GitHub PATs revoked | PENDING — unconfirmed |

---

# OUTSTANDING

## A. Needs Dennis (browser / his terminal)

1. 🔴 **Fix the `v1.0.2` tag.** After merging: `git tag -d v1.0.2` ·
   `git push origin :refs/tags/v1.0.2` · re-tag on the merge commit.
2. **PR `feat/kiosk-and-icons` → `main`**, merge commit (not squash), then tag.
   https://github.com/dennisGIonity/Gate-Flame/compare/main...feat/kiosk-and-icons
3. **Branch protection on `main`** — require PR + checks `verify` and `backend`.
4. 🔴 **Change the KeePassXC master password.**
5. **Confirm the two GitHub PATs are revoked** (settings/tokens and
   settings/personal-access-tokens).
6. `cmdkey /delete:git:https://dennisionityworld-create@github.com` — GCM still
   holds the wrong account (`dennisionityworld-create`, no write access).
7. **Test-restore one keystore backup** and confirm the same SHA-256. An untested
   backup is not a backup.
8. **Pair the phone** at the Pi's screen. `provisioned: false` — the single most
   important customer interaction has never once been executed. Proves E3 + E5.

## B. Unverified — believed done, never confirmed

9. **Does the v6 threat log actually work on the Pi?** The correct file was copied
   after fetching `fecdfc5`, but the confirming curl was never run:
   `curl -s "http://127.0.0.1:8080/api/v1/threats/recent?limit=5"` on the Pi.
   Old code says gap `"Pi-hole API unreachable"`; new code says
   `"did not answer an authenticated query read"` — the wording identifies which
   is running. Cannot be checked from the LAN (401) or from Claude's shell.
10. **`/opt` is hand-assembled** — new `threats.py` + `pihole.py`, old everything
    else, matching no commit. Redeploy from `de01ace` so the box equals a SHA.

## C. Code items, all found today, none urgent

11. `/modules/{id}/metrics` returns `{id,label,status,gap}`, not the
    `{tiles,series}` that `src/types/api.ts` promises. **Decide: implement or delete.**
12. `install-dns-stack.sh`: `STACK="$HERE/dns-stack"` is relative — run it from the
    wrong directory and you get a second stack fighting over port 53. Make absolute.
13. Same script's closing text advises `secondary 1.1.1.1`. That breaks filtering
    intermittently while the dashboard still looks healthy. **Router secondary must
    be BLANK** — the watchdog is the correct fallback.
14. **Deploy integrity:** nothing records which commit the Pi runs. Stamp the SHA on
    `/system/status`; have `validate-on-pi.sh` assert the running tree matches.
15. **Lifespan refactor:** `main.py:41` builds the SQLite store at import, so
    importing the app writes to `/var/lib`. CI works around it with
    `GATEFLAME_DB_PATH`. Fixing it properly also retires the deprecated
    `@app.on_event` handlers at `main.py:44` and `:49`.
16. `generate-keystore.ps1` pipes passphrases via stdin and dies on PowerShell 5.1
    (`NativeCommandError` mid-generation). Should prompt interactively. `keytool`
    on this machine: `C:\Program Files\Android\openjdk\jdk-21.0.8\bin\keytool.exe`.
17. 51 ruff violations, reported not enforced. Mostly `datetime.utcfromtimestamp()`
    at `wan.py:409,415`. Clearing them and dropping `continue-on-error` makes it a gate.
18. Consider `noImplicitAny` in tsconfig — a missing type package currently
    degrades silently to `any` instead of erroring. That is what hid 8 real errors.

## D. The big arc

19. **E6 — stored history.** No telemetry tables exist. ~15 days. The last
    structural gap; every chart is "since this screen opened".
20. Router DNS cutover — one device first, secondary blank.
21. Docs rewrite: `GATEFLAME-STATUS-2026-08-17.md` and
    `GATEFLAME-START-HERE-2026-08-18.md` predate today and are wrong about the push
    cause, the repo path and the test counts.
22. POPIA review, privacy notice, Play Console — untouched.

---

# WHERE WE GO FROM HERE

**Next session, in order:**

1. Confirm the threat log (item 9) — one curl, closes the last loose thread.
2. PR + merge + fix the tag + branch protection (items 1–3). CI is green, so this
   is the moment.
3. Pair the phone (item 8). This is the highest-value single action left in the
   project — it converts E3 and E5 from "code exists" to "demonstrated".
4. Redeploy the agent properly (item 10).

**Then pick one of two directions:**

- **Toward a working product:** E6 telemetry tables (item 19). Biggest remaining
  engineering item, and the last thing standing between the console and honesty
  about yesterday.
- **Toward a shippable one:** POPIA + Play Console (item 22), both lead-time bound.

## Traps confirmed today

- Claude **cannot** push or ssh — packaged Store app, no ssh-agent pipe access.
  It can do all local git, npm, builds, and HTTP to the Pi. Delivery is by bundle.
- `NODE_ENV=production` machine-wide + `npm config omit=dev`: every `npm install`
  strips 188 devDependencies; vitest fails 23 tests. Use `--include=dev` and
  `NODE_ENV=test`.
- Piped output swallows stderr from `git`/`ssh`. Use file redirection.
- Three GitHub identities cached on this box: `dennisGIonity` (correct, owns repo),
  `dennisionityworld-create` (GCM, no access), `DennisIonity`. Consolidate before
  Play Console, where the account is hard to change later.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
