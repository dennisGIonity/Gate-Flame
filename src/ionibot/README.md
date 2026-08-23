========================================================================================
IONIBOT - INTEGRATION NOTES
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
Approval: DOC-2026-08-004 | Spec: DOC-2026-08-003 | Dependencies: DOC-2026-08-002
========================================================================================

MOBILE APP ONLY. THE KIOSK IS NOT TOUCHED.

Drop `ionibot/` into `src/` of the Capacitor app and mount it once, at the app root,
inside whatever provider/router tree already exists:

    import Ionibot from './ionibot';

    <Ionibot
      ctx={{
        nodeIp: '192.168.0.10',      // cached at pairing
        gateway: '192.168.0.1',      // read from the agent at pairing, cached
        routerChanged: true,
        routerModel: 'TP-Link AX10',
        paired: true,
      }}
      contactUrl="mailto:info@ionity.today"
    />

That is the whole integration. It renders a floating help button on every screen and
opens a sheet over whatever the customer was doing. It is never a destination.

----------------------------------------------------------------------------------------
FILES
----------------------------------------------------------------------------------------
  types.ts          Data description only. No I/O.
  probes.ts         Five probes. All fetch(). No native plugins, no new permissions.
  resolveState.ts   Pure ProbeReport -> one of seven states. No clock, no randomness.
  tree.ts           THE ENTIRE INSTRUCTION MANUAL AS DATA. Approve this file.
  actions.ts        The only place that changes anything.
  render.ts         Placeholder substitution. Pure, so it tests without React.
  Ionibot.tsx       Floating button, sheet, renderer, netcheck panel, styles.
  index.ts          Public surface.
  ionibot.test.ts   33 tests. All seven states, tree integrity, copy discipline.

----------------------------------------------------------------------------------------
VERIFIED
----------------------------------------------------------------------------------------
  vitest run          33 passed / 33
  tsc --noEmit --strict   clean (except @capacitor/network, which the app provides)

Two real defects were found by these tests during the build and fixed, not waived:
  * three screens (IB-109, IB-304, IB-305) were unreachable by any tap. They are
    reached on a result, and that is now declared explicitly per screen rather than
    exempted in bulk - so a genuinely dead screen can still fail the suite.
  * IB-110 carried the word "DHCP" outside the allow-list. It is legitimate there -
    the customer has to find that literal word in their router's own menu - so the
    allow-list is now per-screen AND per-word, and cannot widen into a blanket
    exemption.

----------------------------------------------------------------------------------------
HOST APP OBLIGATIONS
----------------------------------------------------------------------------------------
  1. CLEARTEXT TO THE BOX
     Probes A4/A5 and every action reach the agent over plain HTTP on the LAN. Android
     needs the network-security-config entry, iOS an ATS exception. Commit cfccc48
     fixed exactly this ("the cleartext policy could not match a node's IP, so no
     request left the phone"). Re-verify after any app rebuild - it fails silently.

  2. CACHE gateway AND nodeIp AT PAIRING
     Both must be available with the handset offline, so they are stored, not probed.
     The gateway cannot be read from a WebView without a native plugin; the agent
     already knows it, so capture it once during the handshake.

  3. AGENT ENDPOINTS EXPECTED
       GET  /api/v1/system/status
       GET  /api/v1/posture/netcheck        <- see below
       POST /api/v1/services/dns/start
       POST /api/v1/filtering/pause | /resume
       PUT  /api/v1/filtering/categories
       POST /api/v1/filtering/allow
       POST /api/v1/pair/router/revert      <- see below
       POST /api/v1/pair/devices/revoke-all

  4. TWO ENDPOINTS DO NOT EXIST YET
     /api/v1/posture/netcheck   - expose gateflame-netcheck.sh --json over the agent.
                                  The script and its JSON mode already exist; this is
                                  a route, not a feature. Without it Ionibot degrades
                                  honestly: it says it could not read the full report,
                                  and never pretends the box is healthy.
     /api/v1/pair/router/revert - replay router_handshake.py's recorded changes.
                                  Without it, IB-605 cannot protect the customer and
                                  the uninstall path stays untested (T15).

  5. DEEP LINKS
     openWifiSettings and openExternal are injected props with browser fallbacks.
     Override them with @capacitor/app / native intents for real deep-linking.

  6. @capacitor/network IS OPTIONAL AND NOT INSTALLED
     package.json carries only @capacitor/android and @capacitor/core. Ionibot does
     NOT add it. The import is dynamic and the failure is caught, so probe A1 returns
     'unknown', and resolveState is written so 'unknown' never resolves to S0 - a
     handset on mobile data lands on S5 instead, which is true and pinned by a test.

     Installing it (`npm i @capacitor/network && npx cap sync`) unlocks the more
     specific S0 copy. It is a native plugin, so it needs an Android rebuild; that
     cost is why it is optional rather than assumed.

     STANDING RULE: Ionibot adds no required dependency. A probe that needs one
     degrades honestly instead.

----------------------------------------------------------------------------------------
MAINTENANCE - THE ONLY ONGOING COST
----------------------------------------------------------------------------------------
TREE.netcheckContract is pinned to the agent's netcheck output ('2026-08-18'). If
netcheck gains, renames or removes a check, bump it and add the branch. The test
suite asserts the pin exists; it is on you to bump it deliberately.

Unmapped netcheck checks fall through to netcheck's own engineer-facing wording in
Ionibot.tsx PLAIN. Imperfect but honest - better than hiding a real failure because
nobody wrote a customer sentence for it.

----------------------------------------------------------------------------------------
WHAT THIS DOES NOT FIX
----------------------------------------------------------------------------------------
Ionibot cannot resolve a single Class A dependency. It can only explain one.

Five screens are marked `architectureDependent: true` and exist ONLY because the box
makes a permanent change to the router that only the living box can undo:

    IB-110  the router instruction that creates the dependency
    IB-204  "your box is off, so your internet is down"
    IB-205  the emergency "revert my router by hand" walkthrough
    IB-602  "moving it will take your internet down for a minute"
    IB-605  "do NOT unplug before letting me revert your router"

Under DOC-2026-08-002 Part 5 Option 2, IB-205 is DELETED, IB-204 becomes reassurance
instead of an emergency, IB-605 loses its warning, and IB-602 loses its caveat. Filter
the tree on that flag - the rewrite is a search, not an excavation.

Under load-shedding the box loses power routinely, not exceptionally. Today every
outage schedule is a household internet outage needing human recovery. Ionibot turns
that phone call into a screen. Only the architecture turns it into a non-event.

========================================================================================
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Governance: Policy 986 AED | Anything is Possible with God.
========================================================================================
