```
========================================================================================
GATE^FLAME — UNPUSHED WORK: RECOVERY INSTRUCTIONS  [SUPERSEDED]
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-REC | Version: 2.0 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ⛔ STATUS: SUPERSEDED — the recovery window closed

**Do not spend time on Options A, B or C below. They no longer work.**
Verified 2026-08-13 in a later session. Kept as the record of what was lost and why.

## What was verified

Commits `a4cf2c1` and `803e02c` on branch `feat/node-agent-backend` — the ~7,500-line
`node-agent/` Python backend — **do not exist in any reachable location.**

| Searched | Result |
|---|---|
| Remote `dennisGIonity/Gate-Flame` | `git ls-remote` returns one ref: `refs/heads/main`. No `feat/` branch. |
| Full repo history | All 4 commits, all 218 git objects, all 153 paths ever tracked. Zero `node-agent`. Not a shallow clone; `git fsck --lost-found` empty. |
| `~/GateFlame-Repo` | Still at `97c6c4c`, knows only `main`. |
| Device `wabakipi` | `find` across `Downloads`, `GateFlame-Repo`, `GateFlame-Backup-2026-08-13` and all 14 `antigravity` workspaces. No `.bundle`, no `.patch`, no Python agent tree. |
| Session container | No uploads directory, no bundle, no patch. |

**Option A** required the session that held the work — that session is gone.
**Options B and C** required the bundle or patch delivered in chat — neither was ever
saved to disk.

## The one remaining possibility

If the original Cowork conversation is still open on your machine, its chat attachments
may still be downloadable. Download `gateflame-node-agent.bundle` (224 KB) and place it
in `C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\`, then apply it per the
recipe preserved at the bottom of this document.

Otherwise the backend must be rebuilt from the specification in
`claude/gateflame-backend-build.md`, which is detailed enough to serve as the brief —
nine modules, the honest-capability-reporting design centre, the kiosk/mobile execution
split, the legal position, and all ten reviewed defects with their fixes.

## Why it was lost — the lesson worth keeping

The push was refused by the sandbox git proxy:

```
remote: access denied by the git proxy: dennisGIonity/Gate-Flame is not in
this session's authorized repository set, so the proxy will not inject a
credential for it. To fix, add the repository to the session's sources.
fatal: ... The requested URL returned error: 403
```

**This is still true today.** A `git push --dry-run` from the 2026-08-13 audit session
returned the identical 403. The repository has never been added to a session's
authorized set.

**The misleading signal, recorded so nobody repeats the diagnosis:**
`git ls-remote https://github.com/dennisGIonity/Gate-Flame.git` **succeeds** from the
sandbox. That proves nothing — the repo is public, so anonymous read needs no
credential. Only `git push` reveals the block, and by then the work exists only
somewhere ephemeral.

### The rule

> **Authorise the target repository in the session, and prove it with
> `git push --dry-run`, BEFORE starting work that will need to be pushed.**
>
> If push cannot be authorised, write every artefact to a real disk as you go —
> not to chat, and not to the session workspace.

This is how the 2026-08-13 repo-hygiene fix (`7eb0d30`) was handled instead: the commit
was built in the container, then fetched into `C:\Users\DGMic\GateFlame-Repo` over the
device bridge, where it now lives in real git objects awaiting nothing but `git push`.
Add it to `CONTRIBUTING.md`.

## Verification state at the time the work was lost

Recorded for the rebuild. These are the targets to hit again.

| Suite | Result |
|---|---|
| `node-agent/tests/smoke_test.sh` | 85 / 85 |
| `node-agent/tests/test_security_regressions.py` | 15 / 15 |
| `node-agent/tests/ui_layout_check.py` | 35 / 35 |
| `ruff check gateflame` | clean |
| `tsc --noEmit` | clean |
| kiosk + mobile Vite builds | both succeed |

## Still open regardless of how the backend returns

1. **Test on real hardware.** Everything ran in a container: no thermal zone, no
   `vcgencmd`, no cgroup v2, no Pi-hole, no `CAP_NET_ADMIN`. The *enforcing* branches —
   nftables bouncer, AF_PACKET capture, SoC throttle flags — have never executed on a Pi.
2. **Load the APK on a real phone.** Layout was verified in headless Chromium at five
   viewports, not on glass.
3. **Rotate `GEMINI_API_KEY`.** Still open. Confirmed 2026-08-13: an `AQ.A…` 53-character
   token sits in plaintext in **14 identical `.env` files** across the Antigravity
   workspaces (all MD5 `77ccd25b…`). It has never touched the repo, but it is unrotated.
4. Not yet proxied to Pi-hole: domain allow-listing and blocklist refresh.

## Preserved recipe — only if the bundle resurfaces

```bash
git clone https://github.com/dennisGIonity/Gate-Flame.git && cd Gate-Flame
git bundle verify /path/to/gateflame-node-agent.bundle
git fetch /path/to/gateflame-node-agent.bundle \
  feat/node-agent-backend:feat/node-agent-backend
git push -u origin feat/node-agent-backend
```

Note the bundle requires base commit `97c6c4c`. That is no longer `main` — `main` is now
`7eb0d30` — but `97c6c4c` is still an ancestor, so the fetch still applies cleanly.

**See also:** `claude/gateflame-audit-2026-08-13.md` (full audit),
`claude/gateflame-backend-build.md` (the rebuild specification).

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
