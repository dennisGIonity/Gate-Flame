```
========================================================================================
GATE^FLAME — TIERING PLAN AND LAYOUT
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-025-TIER | Version: 1.0 | Updated: 2026-09-25 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# The structure — decided by Dennis, 2026-09-25

Every model is a **tier (T1–T4)** and every tier comes in two editions, **Standard** and
**Premium**. Tiers are added as they are defined; this table is the layout they fill.

| Tier | Standard | Premium | Status |
|---|---|---|---|
| **T1** | **ESP32-S3 N16R8 DNS filter** + Ionity server (MCP, dashboard) — build in `t1/` | — | **Lab build v0.1 (2026-09-25)**: server running, firmware compiles, not yet on hardware |
| **T2** | — | — | To be defined |
| **T3** | **Radxa Cubie A7A, 6 GB** — the current product: DNS filtering side-car (ADR-001) | **Standard T3 + enough extra features to safeguard crypto wallets stored on a private server. 16 GB version** | Standard: built. Premium: to be specified |
| **T4** | — | — | To be defined |

In Dennis's words: *"the standard model the radxa 6gb - (Standard T3) the Premium we
referred to that is going to be the standard with extra enough features to safe guard
stored crypto wallets on a private server 16GB version - (Premium T3)… we will add a
Standard and Premium T2 + T1 and T4 models as we go."*

## What this changes in older documents

- **"Standard" and "Premium" are now editions within a tier, not the whole product line.**
  Where `CLAUDE.md`, `ADR-001` or `gateflame-two-tier-endgame.md` say *Standard* / *Premium*,
  read **Standard T3** / **Premium T3**.
- The old Premium definition ("anything a Bond villain would want": in-path, gateway claim,
  DPI) is **replaced** by the Premium T3 definition above. Whether Premium T3 goes in-path
  is **not yet decided** — open question 2.
- ADR-001 (router forwards to us; devices never pointed at the box) stands for Standard T3.

## Open questions — Dennis's calls, not yet answered

1. **"Safeguard stored crypto wallets on a private server" — what, concretely?** Candidates:
   isolating the wallet server on its own network segment; allow-listing only the
   exchanges/nodes it may talk to; alerting on any new outbound destination; blocking
   wallet-drainer / phishing domains; a hardware-backed signing step. Each has very
   different hardware and liability consequences.
2. **Is Premium T3 in-path?** Isolation and outbound allow-listing for a wallet server need
   the traffic to cross the box. That reopens load-shedding (ADR-001's reason) for the
   premium unit only.
3. **"16 GB version" — which board?** A Raspberry Pi 5 16 GB (the lab unit today) or a
   16 GB variant of another board.
4. **Where T2 and T4 sit** relative to T1 and T3 (price, hardware, features).

---

# T1 — ESP32 / Pico + MCP (scoping, 2026-09-25)

> ✅ **Approved by Dennis the same day and built:** `t1/README.md`. Separate folder, port
> 8095, own mDNS service and `t1_*` MCP tools — `E:\.ESP32-MCP` is untouched.

Engineering assessment, from the parts in `docs/ESP32-PARTS-INVENTORY-2026-09-24.md` and
the `Esp32-MCP` repo. Numbers marked *estimate* must be measured on the lab bench before
they go on a box or a brochure.

**Can it run a DNS filter? Yes — an ESP32-S3 can.** Not Pi-hole, not the full exact list,
but a real filter in its own firmware:

- The 3,081,748-domain list does not fit as text in any MCU. As a **Bloom filter** it does:
  ~3.7 MB at 1 % false positives, ~5.5 MB at 0.1 % — inside the 8 MB PSRAM of an
  ESP32-S3 N16R8. The **Ionity server compiles the filter**; the device downloads one
  signed binary. A small allow-list on the device fixes false positives.
- It forwards allowed queries to an upstream resolver. No Unbound (recursive resolving is
  too heavy); plain DNS forward is easy, DNS-over-TLS upstream is possible but slower.
- Same authority model as Standard T3 (ADR-001): the router uses T1 as its upstream DNS,
  so if T1 dies the router falls back on its own. That also makes 2.4 GHz Wi-Fi acceptable.
- Household DNS load is small; an S3 should keep up comfortably — *estimate, bench it*.

**Pico:** Pico 2 (no radio) cannot be a network device at all. Pico 2 W can, but with
520 KB RAM and 4 MB flash it could only filter a small curated list. **ESP32-S3 is the T1
board; Pico stays an accessory** (display, sensor, serial reporter).

**What it cannot do:** go inline / route household traffic at useful speed, run Unbound,
Pi-hole or Docker, host a VPN for the house, deep packet inspection or IDS, a kiosk touch
UI, or exact per-domain matching of the full list.

**What the MCP gateway adds:** the MCP server runs on the Ionity server, not on the chip. T1
is a thin client with a smart back end — list compilation, remote support, alerts,
load-shedding correlation, fleet reporting and AI queries (the 13 existing tools) all live
server-side. That is the subscription surface.

⚠ **Privacy line to hold:** if T1 ships raw DNS logs to the server, "almost nothing leaves
the LAN" (the Play data-safety answer and the POPIA position) stops being true. Send
counts and aggregates by default; raw logs only on explicit consent.
