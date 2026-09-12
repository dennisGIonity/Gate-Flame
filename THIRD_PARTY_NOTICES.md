```
========================================================================================
GATE^FLAME — THIRD-PARTY NOTICES
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-012-TPN | Version: 1.0 | Updated: 2026-09-12 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Third-party notices

Gate^Flame is distributed under Policy 986 AED / AED 900 (see `LICENSE`). That
covers Ionity's own work. It does not cover the third-party software Gate^Flame
is built on or ships alongside, which carries its own terms — listed here.

**Why this file exists.** It was specified on 2026-08-14, re-raised twice, and
did not exist until 2026-09-12. Google Play asks for it, POPIA does not care
about it, and one of the licences below genuinely constrains how the product may
be sold. That last point is the reason it is not paperwork.

---

# 🔴 1. THE ONE THAT NEEDS A DECISION — Pi-hole, EUPL-1.2

**Pi-hole is licensed under the European Union Public Licence v1.2.** The EUPL is
a **copyleft** licence with a network-distribution trigger, and it is not
compatible-by-default with shipping inside a closed commercial appliance.

This matters in a very specific way, and only in one direction:

| Scenario | Position |
|---|---|
| Customer installs Pi-hole themselves; Gate^Flame talks to it over its API | **Almost certainly fine.** Using a program's network API is not creating a derivative work |
| Gate^Flame ships a **pre-built OS image with Pi-hole baked in** | **This is redistribution**, and the EUPL's terms attach to it |

The 2026-08-15 plan (Phase 6.1) calls for exactly that pre-built image — `pi-gen`
or Packer, "agent + Pi-hole + avahi + systemd baked in". So the question is live,
not hypothetical.

> **STATUS: UNRESOLVED. This is a lawyer question, not a developer question,**
> and it belongs in the same POPIA review already scheduled. Two things to
> establish: whether distributing an image containing an unmodified Pi-hole
> triggers EUPL obligations on Gate^Flame's own code, and — separately —
> whether AED 900 / CC BY-NC-SA 4.0, a **non-commercial** grant, is coherent
> with selling hardware at all. That second one has been an open question since
> 2026-08-15 and is not about Pi-hole.

Pi-hole is also a **trademark**. Using the name to describe what the box runs is
normally fine; implying endorsement or affiliation is not.

- Pi-hole — <https://github.com/pi-hole/pi-hole> — EUPL-1.2
- Unbound (NLnet Labs) — <https://github.com/NLnetLabs/unbound> — BSD-3-Clause,
  permissive, no equivalent constraint

---

# 2. Bundled into the shipped app

These are compiled into the web, kiosk, mobile and desktop bundles, so they
**are** redistributed to customers. Versions and licences below were read from
each package's own `package.json` in `node_modules/` on 2026-09-12 — not from
memory.

| Package | Version | Licence |
|---|---|---|
| `react` | 19.3.0 | MIT |
| `react-dom` | 19.3.0 | MIT |
| `zustand` | 5.0.15 | MIT |
| `recharts` | 3.10.1 | MIT |
| `motion` | 12.43.0 | MIT |
| `lucide-react` | 0.546.0 | **ISC** |
| `clsx` | 2.1.1 | MIT |
| `tailwind-merge` | 3.6.0 | MIT |
| `@tailwindcss/vite` | 4.3.3 | MIT |
| `@vitejs/plugin-react` | 5.2.0 | MIT |
| `@capacitor/core` | 8.5.1 | MIT |
| `@capacitor/android` | 8.5.1 | MIT |
| `@capacitor/filesystem` | 8.1.3 | MIT |
| `@capacitor/share` | 8.0.1 | MIT |

All MIT and ISC. Both require the copyright notice and permission text to travel
with the software — which is what this file is for — and neither restricts
commercial use.

---

# 3. Build-time only — not redistributed

Present in `devDependencies`, used to produce the artifacts, not shipped inside
them. Listed for completeness.

`vite` 6.4.3 (MIT) · `vitest` 3.2.7 (MIT) · `typescript` 5.8.3 (**Apache-2.0**) ·
`esbuild` 0.25.12 (MIT) · `tailwindcss` 4.3.3 (MIT) · `jsdom` 30.0.1 (MIT) ·
`@capacitor/cli` 8.5.1 (MIT) · `@testing-library/{dom,react,jest-dom,user-event}`
(MIT) · `@types/{node,react,react-dom}` (MIT)

---

# 4. Python — the node agent and the feed receiver

Installed on the appliance and on the receiver host.

**`node-agent`** — `fastapi` · `uvicorn[standard]` · `psutil` · `httpx`
**`feed-receiver`** — `fastapi` · `uvicorn[standard]` · `pydantic`
**Test-only** — `pytest` · `ruff`

> ⚠ **Not machine-verified in this pass.** The npm table above was read from
> installed package metadata; this list was read from `requirements.txt` only,
> which declares names and version floors but not licences. FastAPI, uvicorn,
> psutil, httpx and pydantic are all permissive (MIT or BSD-family) upstream,
> but **confirm each against the installed distribution before this file is
> published or put in front of Play**, rather than trusting this sentence.

---

# 5. Fonts

Loaded at runtime from Google Fonts by `index.html`, `kiosk.html` and
`mobile.html`. **Not redistributed** in any bundle today — the browser fetches
them.

`Outfit` · `Plus Jakarta Sans` · `JetBrains Mono` — all published under the
SIL Open Font License 1.1.

> If fonts are ever self-hosted or embedded — which is likely, since the kiosk
> may have no internet and the OFL permits it — they become redistributed, and
> the OFL requires the licence to ship with them. Two consequences worth knowing
> in advance: OFL-licensed fonts must not be sold on their own, and a Reserved
> Font Name may not be reused on a modified version.

---

# 6. Brand assets — not third-party

The Ionity and Gate^Flame marks, tokens and icons come from
`Ionity-Global/ionity-assets-ionity-global-ionity-today` and are Ionity's own
property under Policy 986 AED. They are listed here only so nobody mistakes them
for third-party material with permissive terms. They have none.

---

# 7. Keeping this file true

It was generated by reading installed metadata, and it will rot the moment a
dependency moves. Regenerate it when `package.json` or either `requirements.txt`
changes — and note that the version numbers above are the ones that were
installed on 2026-09-12, not floors.

The `audit` job in `.github/workflows/ci.yml` already fails on high-severity
advisories. A licence check is a natural neighbour to it, and is the only way
this file stays honest without someone remembering.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
