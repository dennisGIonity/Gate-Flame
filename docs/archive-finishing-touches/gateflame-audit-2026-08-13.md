```
========================================================================================
GATE^FLAME NETWORK SECURITY NODE — FULL PROJECT AUDIT
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-AUD | Version: 1.0 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Gate^Flame — Full Project Audit

Audited against the **live public repo** `dennisGIonity/Gate-Flame` at commit `86deb08`,
plus the working copies on device `wabakipi`. Every claim below was executed, not
inferred, and independently re-verified by a second adversarial pass.

---

## Part 1 — Verification: what is actually working

### 1.1 What passes

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 |
| `npm run build` (web) | **passes** — 2,687 modules, 917 kB |
| `vite build -c vite.kiosk.config.ts` | **passes** — 748 kB single file |
| `vite build -c vite.mobile.config.ts` | **passes** — 888 kB single file |
| `vite build -c vite.standalone.config.ts` | **passes** |
| `node build-standalone.js` | **passes** (but is orphaned — see 2.14) |
| `npm run dev` | **works** — serves `/` and `/src/main.tsx`, HTTP 200 |
| Secrets in the repo / full git history | **none** — `AIza…`, `sk-…`, `ghp_…`, Bearer tokens, PEM: all clean. `.env` correctly ignored and untracked |
| README quick-start clone → install → dev | **works** (minus a meaningless env step) |

**The front end is sound.** It compiles, it type-checks, it builds four ways, and it
runs. Nothing is leaking a credential through git.

### 1.2 The three findings that change the picture

**A. The backend does not exist anywhere. It is gone.**

The ~7,500-line `node-agent/` Python backend recorded in
`claude/gateflame-backend-build.md` — commits `a4cf2c1` and `803e02c` on branch
`feat/node-agent-backend` — **was never pushed and can no longer be recovered.**

Searched and confirmed absent:

- Remote: `git ls-remote` returns **one** ref, `refs/heads/main`. No `feat/` branch.
- Full history: all 4 commits, all 218 git objects, all 153 paths ever tracked —
  zero occurrences of `node-agent`. Not a shallow clone; `git fsck --lost-found` empty.
- Device `wabakipi`: `find` across `Downloads`, `GateFlame-Repo`,
  `GateFlame-Backup-2026-08-13` and all 14 `antigravity` workspaces —
  **no `gateflame-node-agent.bundle`, no `.patch`, no `.py` agent tree.**
- `~/GateFlame-Repo` local clone is still at `97c6c4c` and knows only `main`.

The recovery window described in `claude/gateflame-unpushed-commits.md` (Options A, B
and C) has closed. The only remaining possibility is the chat attachment in the original
Cowork conversation, if that conversation is still open on your side — see item **1**
in Part 2.

**B. `main` regressed. Build output was merged over the clean release.**

Commit `86deb08` "Resolve merge conflicts and keep local files" is a merge of the clean
release `97c6c4c` with an unrelated root commit `384c9fc` "Initial commit from AI Studio".

The good news: **nothing was lost.** `git diff --diff-filter=DMRT 97c6c4c 86deb08` is
empty — zero deletions, zero modifications. README, LICENSE, CONTRIBUTING and
`docs/LINKS.md` all survived intact.

The bad news: it added 15 files that are all build artifacts —
`dist-kiosk/`, `dist-mobile/`, `dist-standalone/`, `release/`, `bun.lock`. Every one of
them is explicitly listed in the repo's own `.gitignore`, and `CONTRIBUTING.md` rule 2
says in plain words *"Never commit build output."* The merge bypassed both because the
files entered through the other root.

**C. The public release tarball is destroyed.**

`release/GateFlame-Complete-Package.tar.gz` (1,237,025 bytes) is **not a gzip file.**

```
expected: 1f 8b 08 00 ...
actual:   1f ef bf bd 08 00 ...
              ^^^^^^^^ U+FFFD REPLACEMENT CHARACTER
```

The file contains **282,516** U+FFFD sequences — 847,548 bytes, **68.5% of the file**.
The whole thing decodes cleanly as UTF-8, which is the tell: the binary was read as text
by something that replaced every invalid byte with U+FFFD, then written back. Each
replacement destroyed at least one unknown source byte.

Repair attempts: patching the magic byte then inflating → `invalid block type`;
raw-inflate from offset 10 → `invalid stored block lengths`. **Unsalvageable.** Anyone
who downloads it from the public repo gets a broken file. It must be deleted and rebuilt.

### 1.3 The UI is still entirely simulated

Nine feature cards, zero network calls. The only `fetch()` in `src/` is commented out.

| File | What it actually does |
|---|---|
| `src/services/serviceManager.ts` | `toggleService` → `setTimeout(800)` → `return true`. Real fetch commented out at line 74 |
| `src/hooks/useGateFlameEngine.ts` | `setInterval(4000)` fabricating query counts, block %, saved-MB and threat rows from `Math.random()` over 6 hardcoded domains |
| `src/components/DynamicModuleTab.tsx` | 7 `Math.random()` chart feeds |
| `src/store/useAppStore.ts` | Seeded from `src/data/mockData.ts`, persisted to `localStorage` key `ionity-app-storage` |

This is unchanged from the state recorded on 2026-08-13. **Every green light in the
product is currently fiction** — which is fine for a demo and not fine for anything sold.

### 1.4 Credential status

`GEMINI_API_KEY` is present in **14 identical `.env` files** across the Antigravity
workspaces on `wabakipi` (all MD5 `77ccd25b…`). It is an `AQ.A…` 53-character AI Studio
token, not a classic `AIza…` key. It has **never touched the repo** — but it sits in
plaintext on disk in 14 places and is still unrotated. The open action from
`docs/LINKS.md` §8.1 stands.

---

## Part 2 — What still needs to be done

Ordered by consequence. Items 1–4 are the ones that actually block you.

1. **Recover or rewrite the `node-agent` backend.** First check whether the original
   Cowork conversation is still open on your side — if it is, download
   `gateflame-node-agent.bundle` (224 KB) from that chat *now* and apply it per
   `claude/gateflame-unpushed-commits.md` Option B. If that conversation is gone, the
   work must be rebuilt from the specification in `claude/gateflame-backend-build.md`,
   which is detailed enough to serve as the brief. **This is the single largest
   outstanding item in the project.**

2. **Delete `release/GateFlame-Complete-Package.tar.gz` from the repo.** It is a
   corrupt 1.2 MB file being served to the public. Remove it, then either publish a
   freshly built tarball as a GitHub *Release asset* (not a tracked file) or drop the
   tarball concept entirely.

3. **Untrack all committed build output.**
   `git rm -r --cached dist-kiosk dist-mobile dist-standalone release bun.lock` —
   `.gitignore` already covers every one of them, so nothing else is needed. This also
   removes the stale artifacts described in item 5.

4. **Rotate `GEMINI_API_KEY`** at <https://aistudio.google.com/apikey>, then overwrite
   all 14 `.env` copies under `~/antigravity/Gate^Flame-Network-Security-Node*`. Open
   since 2026-08-13.

5. **Purge the stale committed bundles.** The committed `dist-kiosk/` and `dist-mobile/`
   assets do not match current source — every filename and size differs
   (`useGateFlameEngine.Be_MRIHh.js` 843 kB committed vs `bHX3q3Ty.js` 625 kB fresh).
   Worse, they are **React development builds**: they contain dev-only internals and
   **1,010 occurrences of the internal path `/app/applet/src/…`**, disclosing the AI
   Studio container layout. A fresh build has zero. Resolved by item 3.

6. **Fix the Android identity split.** There are **four** conflicting app IDs:

   | File | ID |
   |---|---|
   | `android/app/build.gradle` | `org.ionity.gateflame` |
   | `capacitor.config.ts` | `com.gateflame.node` |
   | `capacitor.config.json` / `.mobile.` | `com.gateflame.mobile` |
   | `capacitor.kiosk.config.json` | `com.gateflame.kiosk` |

   Capacitor resolves `.ts` **before** `.json`, so `capacitor.config.ts` silently wins
   and the `cp capacitor.*.config.json capacitor.config.json` step in
   `build:apk-mobile` / `build:apk-kiosk` **has no effect at all**. Consequence:
   **the Mobile and Kiosk APKs share one package name and cannot coexist on a device —
   installing one uninstalls the other.** Pick one config mechanism (delete
   `capacitor.config.ts` or generate it) and give the two surfaces distinct IDs.

7. **Fix `dist-mobile/index.html`.** No build script produces it — `build:html-mobile`
   writes `dist/index.html`, not `dist-mobile/index.html`. The committed copy is masking
   this. Once item 3 removes it, `cap sync` against `webDir: "dist-mobile"` will get a
   webDir with **no `index.html` and the app will load nothing.** Fix the script before
   untracking, or change `webDir`.

8. **Add release signing.** `grep -rn "signingConfig\|keystore\|storeFile" android/`
   returns nothing. `buildTypes.release` has no `signingConfig` and `minifyEnabled false`,
   so `assembleRelease` produces an **unsigned** APK. Only debug builds are installable
   today — no Play Store, no side-load distribution. Also bump `versionCode`/`versionName`
   off `1` / `"1.0"`.

9. **Fix `index.html` boot script.** Line 34 calls
   `document.body.setAttribute('data-filter-level', …)` from a classic `<script>` in
   `<head>`, where `document.body` is `null`. The `try{}catch{}` swallows the `TypeError`,
   so the pre-hydration theming in `src/index.css:41-56` never applies and the UI flashes
   on first paint. Move the script to end-of-body or set the attribute on
   `document.documentElement`.

10. **Add the Google Fonts link to `mobile.html` and `kiosk.html`.** Only `index.html`
    has it, so the two shipped surfaces render in fallback fonts.

11. **Resolve the licence contradiction.** Ten files under `src/` carry
    `SPDX-License-Identifier: Apache-2.0` — `types.ts`, `data/mockData.ts`, and
    `components/{Footer,Header,ContainerArchitectureView,DeploymentScriptViewer,`
    `DeviceOnboardingSimulator,ExportPackagingCenter,FutureFeatureRoadmap,`
    `GravityParticleCanvas}.tsx`. `LICENSE` is All Rights Reserved / AED 900 /
    CC BY-NC-SA 4.0, a **non-commercial** grant. Apache-2.0 permits commercial use.
    These cannot both be true of the same tree. Decide and make the headers agree.

12. **Correct the README.** It documents `GEMINI_API_KEY` as required and lists
    `@google/genai (Gemini, server-side)` in the stack. Neither is real — there is no
    `import.meta.env` or `define:` block anywhere, and `@google/genai` is imported
    nowhere. `cp .env.example .env.local # then fill in your own GEMINI_API_KEY` is a
    no-op instruction. `APP_URL` is likewise unused.

13. **Remove the unused dependencies** `@google/genai`, `express`, `dotenv`,
    `@types/express`. Also `vite` is declared in **both** `dependencies` and
    `devDependencies`.

14. **Fix or delete `build-standalone.js`.** No npm script calls it —
    `build:standalone` runs `vite build -c vite.standalone.config.ts` instead. The
    README table row "Standalone bundle | `build-standalone.js`" is wrong. Separately,
    the committed `dist-standalone/` files are single-file inlined HTML that **no script
    in the repo can reproduce**: `vite-plugin-singlefile` is in `devDependencies` but
    referenced by no vite config.

15. **Fix the two high-severity advisories.** `npm audit` reports `nanoid <3.3.17`
    (GHSA-2v37-7h3g-55p8) and `brace-expansion 4.0.0–5.0.8` (GHSA-rgw5-rvv9-x895).
    `npm audit fix` clears both.

16. **Delete the 36 one-off codemod scripts at the repo root** — 33 `*.cjs`
    (`patch_*`, `update_*`, `fix_*`, `patch.cjs`), plus `fix-css.sh`,
    `update_server_sync.js` (a stray duplicate of the `.cjs`) and `test.css`. These are
    destructive one-shot regex rewrites; `patch.cjs` rewrites `SettingsManager.tsx`
    in place. Re-running any of them on already-patched source corrupts it. Their work
    is already in `src/`.

17. **Drop one lockfile.** Both `bun.lock` and `package-lock.json` are tracked and
    drifting. `.gitignore` line 14 already ignores `bun.lock` — honour it.

18. **Fix `package.json` metadata.** `name` is `"react-example"`, `version` is
    `"0.0.0"`, there is no `repository` field, and `npm run clean` (`rm -rf dist server.js`)
    does not clean `dist-mobile/`, `dist-kiosk/` or `dist-standalone/`.

19. **Fix the `docs/LINKS.md` claims.** §4 links to GitHub Actions and Releases; there
    is no `.github/` directory, no workflow and no release. §5 documents auth tokens
    passed over plain HTTP query strings — which pairs badly with
    `allowMixedContent: true` in all three Capacitor configs.

20. **Then the two items that were already known and still stand:** test the agent on
    real Raspberry Pi hardware (nothing has ever executed on a Pi — no thermal zone, no
    `vcgencmd`, no cgroup v2, no `CAP_NET_ADMIN`), and load the APK on a physical phone.
    Both are blocked on item 1.

---

## Part 3 — Recommendations (optimisation and improvement)

Not defects. Things that would make the project materially better.

### Repository and process

1. **Protect `main` and require a PR.** The `86deb08` merge is exactly what branch
   protection prevents: an unrelated root merged straight into the release branch,
   carrying files the project's own rules forbid. Enable "Require a pull request" and
   "Require status checks" on `main`.

2. **Add CI — this is the highest-leverage single change.** A three-line GitHub Actions
   workflow running `npm ci && npm run lint && npm run build` on every PR would have
   caught the stale bundles, the broken tarball and the dependency advisories before
   they reached `main`. `docs/LINKS.md` already links to an Actions tab that has nothing
   in it.

3. **Add a `.gitattributes` with `*.tar.gz binary`, `*.apk binary`, `*.png binary`.**
   The tarball corruption is precisely what this prevents — a binary handled as text.
   Cheap insurance against the exact failure that already happened once.

4. **Never track release binaries. Use GitHub Releases.** Tracked binaries bloat every
   clone forever, cannot be diffed, and — as demonstrated — can be silently corrupted.

5. **Transfer the repo to the `Ionity-Global` org.** Already noted as optional in
   `docs/LINKS.md` §8.3, but it also solves the push problem that stranded the backend:
   org-level permissions apply automatically instead of per-person collaborator invites.

6. **Add a `SECURITY.md` and a `THIRD_PARTY_NOTICES.md`.** For a product in the network
   security category, a disclosure policy is table stakes. The notices file was written
   for the backend build and never landed.

### Front-end

7. **Code-split.** The main chunk is 918 kB (269 kB gzipped) and Vite is warning about
   it. `IonicrobesGame.tsx`, `GravityParticleCanvas.tsx` and `DeploymentScriptViewer.tsx`
   are all obvious `React.lazy()` candidates — none is on the critical path to a
   dashboard. Recharts and `motion` are the other heavy hitters and belong in a
   `manualChunks` vendor split. Realistic target: **under 250 kB** for first paint.

8. **Put the mock layer behind one flag.** Rather than deleting `mockData.ts` when the
   backend lands, gate it: `VITE_USE_MOCK_DATA`. You keep a demo mode that sells the
   product without a Pi on the table, and the same build talks to a real node. This is
   worth doing *before* the backend returns, because it defines the seam the backend
   plugs into.

9. **Extract the hardcoded IPs.** `192.168.1.105`, `192.168.1.100`, `localhost:8080` and
   `localhost:3000` are scattered across five components. One `src/config/endpoints.ts`
   reading `import.meta.env`, so a customer on `10.0.0.0/8` is a config change and not
   a rebuild.

10. **Add tests.** There are currently **zero** — the only test files in the tree are
    Capacitor's `ExampleInstrumentedTest.java` boilerplate. Vitest plus React Testing
    Library on the store and the engine hook would be a day's work and would have caught
    most of the store bugs already fixed by hand in the `fix_store.cjs` era.

11. **Type the API surface now.** Define the request/response shapes for the nine
    `/api/v1/services/*` endpoints as TypeScript interfaces in `src/types.ts` *before*
    rebuilding the backend. It becomes the contract both sides build against, and it
    makes item 8's seam explicit.

12. **Replace `allowMixedContent: true` with an Android network security config.**
    Blanket mixed content is a big hammer for "talk to one LAN device over HTTP".
    A `network_security_config.xml` scoped to the private ranges is narrower and will
    survive Play Store review.

### Product and delivery

13. **Version the document set.** The three project docs are excellent but two of them
    now describe a recovery path that has expired. Add a `Status:` line to each
    (`CURRENT` / `SUPERSEDED`) so the next session does not spend its first twenty
    minutes chasing a bundle that no longer exists.

14. **Split the repo, or at least the build.** One repo holding a React app, an Android
    Capacitor shell, and eventually a Python agent is workable — but give each its own
    top-level directory and its own CI job, rather than 36 loose scripts at the root.

15. **Record the decision that killed the backend once.** The push failure was an
    authorization boundary, not a git problem, and the misleading `git ls-remote` success
    is already documented. Add "authorize the target repo in the session *before*
    starting work" to `CONTRIBUTING.md`. It cost ~7,500 lines once; it should not cost
    them twice.

---

## Summary

The front end is healthy — it type-checks clean, builds four ways, runs, and leaks no
secrets. Everything below the glass is still simulated, and the real backend that was
written to replace it is **unrecoverable from any location I can reach**. Two artifacts
in the public repo are actively harmful: a corrupt release tarball and a set of stale
development-mode bundles that disclose internal paths. Fix those two today (Part 2,
items 2–3, roughly ten minutes), chase the bundle in the old chat window (item 1), and
the rest is an orderly queue.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
