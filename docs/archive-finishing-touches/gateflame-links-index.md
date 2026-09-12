```
========================================================================================
GATE^FLAME NETWORK SECURITY NODE — COMPLETE LINK INDEX
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-L | Version: 1.1 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Complete Link Index — Gate^Flame Network Security Node

Gathered 2026-08-13 from the live working copies on device `wabakipi`.
Canonical copy lives in the repo at `docs/LINKS.md`.

## 1. Google AI Studio

One AI Studio app; everything else derives from it.

- **App:** https://ai.studio/apps/e1a2c692-d18b-4b05-bb7b-7b29e360f0d8
- App / cascade ID: `e1a2c692-d18b-4b05-bb7b-7b29e360f0d8`
- Name: Gate^Flame Network Security Node
- Capability: `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` · Model: `gemini-pro-latest`
- AI Studio home: https://aistudio.google.com/
- API keys (rotate here): https://aistudio.google.com/apikey
- Gemini API docs: https://ai.google.dev/gemini-api/docs

## 2. Antigravity — https://antigravity.google

Three agent trajectories, all under cascade `e1a2c692-d18b-4b05-bb7b-7b29e360f0d8`:

| Trajectory ID | Size | First turn |
|---|---|---|
| `e1a2c692-d18b-4b05-bb7b-7b29e360f0d8` | 23.0 MB | 2026-07-25 scaffold |
| `6dc342de-ac4f-450b-9476-638a9983c3a2` | 27.6 MB | 2026-07-28 full rebuild |
| `3926881f-858e-45cc-ad4a-4e4ca21e2969` | 20.8 MB | 2026-07-28 perf pass |

14 local workspaces under `%USERPROFILE%\antigravity\Gate^Flame-Network-Security-Node*`.
Newest and canonical: `...-2026-08-05-02164` — this is what was published.

## 3. Android Studio

- `%USERPROFILE%\AndroidStudioProjects\GateFlamev01`
- `%USERPROFILE%\AndroidStudioProjects\GateFlame_Ionity`
- Capacitor tree: `%USERPROFILE%\TempGateFlameBuild\android`

## 4. GitHub — dennisGIonity/Gate-Flame  ✅ LIVE, PUBLIC

- Repo: https://github.com/dennisGIonity/Gate-Flame
- HTTPS: `https://github.com/dennisGIonity/Gate-Flame.git`
- SSH: `git@github.com:dennisGIonity/Gate-Flame.git`
- CLI: `gh repo clone dennisGIonity/Gate-Flame`
- Issues / PRs / Actions / Releases under the same path
- Collaborators: https://github.com/dennisGIonity/Gate-Flame/settings/access
- Owner account: https://github.com/dennisGIonity
- Org: https://github.com/Ionity-Global
- Assets repo: https://github.com/Ionity-Global/ionity-assets-ionity-global-ionity-today
- 2026 template: https://github.com/Ionity-Global/ionity-assets-ionity-global-ionity-today/blob/main-Ionity/TEMPLATE_2026_OFFICAL_v1.1%20(1).docx

## 5. Runtime & node endpoints

- Dev server: `http://localhost:3000`
- Device kiosk: `http://localhost:8080/device-kiosk`
- Node admin API: `http://192.168.1.100/admin/api.php?summaryRaw` (secondary `192.168.1.105`)
- Hosted URL injected at runtime as `APP_URL` (Cloud Run)
- Pi-hole installer: https://install.pi-hole.net
- PADD: https://raw.githubusercontent.com/pi-hole/PADD/master/padd.sh
- DNS root hints: https://www.internic.net/domain/named.root

## 6. Ionity / AEDI properties

https://www.ionity.today · https://www.ionity.world · https://www.ionity.co.za ·
https://ionityearth.shop · https://ionityearth.wordpress.com ·
https://orcid.org/0009-0005-7181-0347

Contact: info@ionity.today · johan@ionity.today · ai@ionity.today · +27 646 999 877

## 7. Publication record (2026-08-13)

Repo `dennisGIonity/Gate-Flame` — public, default branch `main`.

| Commit | Content |
|---|---|
| `67fefd8` | Initial public release — 138 files from Antigravity workspace 2026-08-05-02164 |
| `97c6c4c` | Docs repointed at dennisGIonity/Gate-Flame; collaborator access documented |

Built locally at `%USERPROFILE%\GateFlame-Repo` and pushed over SSH. Adds README,
LICENSE (Policy 986 AED / AED 900), CONTRIBUTING, docs/LINKS.md, hardened .gitignore.
Verified: no `.env`, keys or build output in the published tree.

## 8. Open actions

1. **Rotate `GEMINI_API_KEY`** — a live key sits in plaintext `.env` files across all 14
   Antigravity workspaces. Excluded from the repo, but rotate at
   https://aistudio.google.com/apikey.
2. **Add collaborators** for direct push:
   https://github.com/dennisGIonity/Gate-Flame/settings/access
3. Optional: transfer the repo to the `Ionity-Global` org so team permissions apply
   automatically instead of per-person collaborator invites.

© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
