```
========================================================================================
GATE^FLAME 1.0.3 — HANDOVER TO TESTER AND APPROVER (STANDARD BOX)
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-024-HANDOVER | Version: 1.0 | Updated: 2026-09-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

This is the one page to read first. It covers **the original Gate^Flame box only** — the
standard, side-car DNS filter on a Raspberry Pi 5. The larger premium model and the new
small ESP32/Pico concepts are **not** part of this release.

`TEST-REPORT-1.0.3.md` is the record of what was verified, on what, with what result.
This page is the runbook.

## 1. What Gate^Flame 1.0.3 is

A small box that sits **next to** the household router, not in the path of the traffic.
The router uses it as its upstream DNS server; the box filters malicious and unwanted
domains (Pi-hole + Unbound, ~3 million blocked domains) and shows what it is doing on an
attached screen (the kiosk) and in an Android app.

Because traffic never passes through it, a box that is off, unplugged or broken cannot
take the household offline — the router simply falls back to its own DNS. That is a design
decision (`ADR-001` in the repo), not a limitation to report.

## 2. What is in the zip

```
node/GateFlame-Node-1.0.3.tar.gz    the box software: installers, agent, DNS stack, kiosk
mobile/GateFlame-Mobile-1.0.3-debug.apk   Android app (version code 15)
fleet-console/                       operator console that boxes report into
docs/                                this page and the test report
SHA256SUMS.txt                       check the files arrived intact
```

Nothing in the zip is a credential: no keystore, no passwords, no tokens, no databases.

## 3. Hardware you need

| Item | Notes |
|---|---|
| Raspberry Pi 5 (4 GB or more) | Raspberry Pi OS / Debian Trixie **64-bit** |
| microSD or NVMe, 32 GB+ | fresh image |
| Wired Ethernet to the test router | Wi-Fi works but the product is specified wired |
| HDMI screen (optional) | shows the kiosk console |
| An Android phone | for the app |
| A test router you are allowed to change | only its **upstream/WAN DNS** field is touched |

**Do not test on a network other people depend on.** Use a separate test router, the way
Ionity does with its lab network.

## 4. Install on a fresh Pi

Copy the node tarball to the Pi, then on the Pi:

```
tar -xzf GateFlame-Node-1.0.3.tar.gz
cd GateFlame-Node-1.0.3
sudo bash install-all.sh
```

To have it report into a fleet console (§7), add
`--feed-url http://<console-ip>:8091/api/v1/nodes --feed-token <token>`.

It installs Docker, the agent, the DNS stack, the watchdog, the timers, and — if a screen
is attached — the kiosk, then prints the box's address. It needs internet access while it
runs. **Working looks like:** the last screen says `INSTALLED` and lists the API, DNS and
Pi-hole addresses.

## 4b. Upgrade a box that already runs Gate^Flame

```
tar -xzf GateFlame-Node-1.0.3.tar.gz && cd GateFlame-Node-1.0.3
sudo bash upgrade.sh <fleet-console-ip>
```

It backs up everything it replaces, rolls the agent back by itself if the new one will not
start, and ends with a read-back. **Working looks like:** `RELEASE INSTALLED AND READ BACK OK`.

## 5. Point the router at the box — the one change a customer makes

In the test router's admin page, set the **upstream / WAN / ISP DNS** to the box's address.
Leave the DHCP-handed DNS alone. Do **not** set a secondary DNS — clients use primary and
secondary in random order, which makes filtering intermittent and impossible to explain.

**Working looks like:** from any device on that router, `nslookup doubleclick.net` returns
`0.0.0.0`, and `nslookup ionity.today` returns a real address.

## 6. Pair the phone

```
adb install -r GateFlame-Mobile-1.0.3-debug.apk
```

Open the app. It finds the box (`gateflame.local`) or you type its address. Get a code
from the box's screen, or on the box: `curl -s -X POST http://127.0.0.1:8080/api/v1/pair/request`.
Type the 6 digits within 5 minutes.

**Working looks like:** Home shows **"Your network is filtered"** with real numbers
(queries, blocked, devices), not dashes or zeros.

## 7. Fleet console (optional, operator side)

On any Windows/Linux machine with Python 3.10+: copy `fleet.env.ps1.example` to
`fleet.env.ps1`, set the admin user/password and the fleet token, and run `start-fleet.ps1`
(or `uvicorn app:app --host 0.0.0.0 --port 8091`). Browse to `http://<machine>:8091/`.
A box configured with the same token appears within one feed interval (15 minutes).

## 8. What to test — the approval checklist

| # | Feature | How | Pass when |
|---|---|---|---|
| 1 | Filtering | `nslookup doubleclick.net <box-ip>` | `0.0.0.0` |
| 2 | Resolution | `nslookup ionity.today <box-ip>` | a real address |
| 3 | Kiosk | look at the box's screen | protection state + live counts |
| 4 | Protection states | pause from the app, then resume | kiosk shows PAUSED, then PROTECTED |
| 5 | Threat level dial | change it in the app/kiosk | shows *applying*, then the new level (can take minutes on first run) |
| 6 | Device list | app → Network | the devices on the router appear |
| 7 | Health | app → Health | CPU, memory, temperature, disk are real |
| 8 | Power cut | pull the box's power | household internet keeps working |
| 9 | Recovery | plug it back in | protection returns by itself within ~2 minutes |
| 10 | Router swap | change the box's IP (new router/DHCP) | DNS comes back on the new address without a technician |
| 11 | Revoke phone | kiosk → revoke paired devices | the app returns to its pairing screen |
| 12 | Fleet | console | box listed with live health |

## 9. Known, intentional behaviour — do not file as bugs

- Opening the kiosk from a laptop browser shows *"This is not the appliance console"*
  and no live data. Live data is only for the box's own screen or a paired phone.
- The fleet console is read-only. There is no remote-control button, by design.
- Per-device query history is not recorded. The box sees the router, not each device; a
  **device list** is provided instead.
- The box does not take over the router's role (no DHCP, no gateway) on the standard model.
- Filtering is not 100%: the router may occasionally use its own upstream. The kiosk never
  claims total coverage.

## 10. Known open items (tracked, not blockers for testing)

- The Android build is a **debug** build. The Play Store (release-signed) build waits on
  the signing-key decision.
- `install-all.sh` on a **blank** image is new in 1.0.3 and was not run on a blank card
  before this handover (see the test report). The upgrade path was run on the lab box.
- Per-site allow-listing and "revert router" actions are not built; the in-app assistant
  says so honestly.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
