========================================================================================
IONIBOT - PROPOSAL FOR APPROVAL
An embedded live instruction manual for the Gate^Flame mobile app.
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-004 | Version: 1.0 | Updated: 2026-08-19 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL - FOR APPROVAL | Building Tomorrow, Today.
Anything is Possible with God.
Companions: DOC-2026-08-002 (Function & Dependency Map)
            DOC-2026-08-003 (Guided Assistant Specification)
========================================================================================


1. PROPOSAL IN ONE PARAGRAPH
========================================================================================
Build IONIBOT: a live instruction manual embedded in the Gate^Flame mobile app,
reachable from every screen by one always-visible help button. It replaces the
call centre we cannot afford. It is a deterministic menu tree - no language
model, no cloud, no backend, no running cost - driven by five checks that run
entirely on the handset and require no new app permissions. It guides a customer
with zero computer knowledge through installing the device, and through every
fault the device can cause. It works with the phone completely offline, because
that is exactly when it is needed.

    Cost to build ...... 2-3 weeks, one developer
    Cost to run ........ R0.00 per month, in perpetuity
    New infrastructure . None
    New permissions ..... None
    New dependencies .... None required. One OPTIONAL - see 3.1.
    Kiosk impact ........ None. The device console is not touched.


2. SCOPE - WHAT IS AND IS NOT BEING BUILT
========================================================================================
IN SCOPE
    * Embedded surface in the MOBILE APP ONLY.
    * A floating help button present on every app screen, which opens a bottom
      sheet over the current screen. The customer never leaves where they were.
    * Context awareness: the button knows which screen it was pressed from and
      opens at the relevant place in the tree.
    * Six guided flows: Setup, Fault diagnosis, Blocked website, Protection
      status, Pause protection, Move/replace/remove.
    * Full English copy. Afrikaans string table structured from day one.

OUT OF SCOPE - EXPLICITLY
    * The kiosk / on-device console. Not touched, not modified, not referenced.
    * Any standalone section, separate screen stack, or bottom-nav destination.
      Ionibot is an overlay, never a place you navigate to and get stuck in.
    * Any language model, generative text, or free-text question answering.
    * Any backend, API service, or hosted component.
    * Any telemetry. No probe result or diagnosis leaves the handset, ever.

DESIGN DECISION - WHY AN OVERLAY AND NOT A TAB
    A tab is somewhere you have to think to go. A customer whose internet has
    stopped is not exploring an app - they need help to be already present. A
    persistent button costs one screen corner and is reachable in one tap from
    anywhere, including mid-setup. It also means Ionibot can badge itself when
    it detects a problem without hijacking the screen.
    RECOMMENDED: floating button + bottom sheet.
    Tab remains a one-line configuration change if you prefer it later.


3. CORRECTION TO THE SPECIFICATION (DOC-2026-08-003)
========================================================================================
DOC-2026-08-003 specified seven probes. Three of them cannot be implemented as
written and one carried an unacceptable cost. This is corrected here, and the
build reflects the correction.

    WITHDRAWN - P2 GATEWAY REACHABILITY
        Required a raw TCP connect and the gateway address. A Capacitor WebView
        cannot open raw sockets, and reading the gateway needs a native plugin.
        REPLACED BY: the gateway address is read from the agent at pairing time
        and cached locally, so it is available offline for router instructions.
        The reachability test is unnecessary - "no gateway" and "no internet"
        lead the customer to the same screen.

    WITHDRAWN - P6 DIRECT UDP DNS QUERY TO THE BOX
        Required a UDP socket. Not available in a WebView.
        REPLACED BY: the agent's own netcheck already reports whether the
        household-facing listener answers. Ionibot renders that answer instead
        of re-deriving it. Strictly better - it is the same check the box
        trusts, so the app and the box can never disagree.

    WITHDRAWN - P7 SSID MATCHING
        Reading the Wi-Fi SSID on Android 10+ requires ACCESS_FINE_LOCATION.
        A security product asking for location permission to run a help screen
        is a permission an informed customer should refuse, and an uninformed
        one should not be talked into. Not worth one diagnostic nicety.
        REPLACED BY: nothing. The two states it distinguished resolve to the
        same screen.

    NET EFFECT
        Five probes, all via fetch(). Seven states instead of eight. No native
        plugins, no new permissions, no loss of diagnostic power.

3.1 CORRECTION - @capacitor/network IS NOT INSTALLED
========================================================================================
    An earlier draft of this proposal stated that @capacitor/network was already a
    dependency of the app. It is not. package.json carries only @capacitor/android
    and @capacitor/core. That claim was wrong and is withdrawn here.

    CONSEQUENCE - none that blocks anything. The import is dynamic and the failure
    is caught, so probe A1 returns 'unknown' rather than throwing, and the resolver
    is written so 'unknown' NEVER resolves to S0. A handset on mobile data therefore
    lands on S5 - "your internet is fine, I just cannot see your box" - which is
    true, useful, and pinned by a test.

    OPTIONAL UPGRADE - installing @capacitor/network unlocks the more specific S0
    copy ("this phone is not on your Wi-Fi"). It is a native plugin, so it needs
    `npx cap sync` and an Android rebuild. That cost is why it is optional rather
    than assumed, and why Ionibot is built to be correct without it.

    STANDING RULE - Ionibot adds no required dependency. If a future probe needs
    one, it degrades honestly instead.


4. THE DIAGNOSTIC ENGINE
========================================================================================
FIVE PROBES - ALL LOCAL, ALL VIA fetch()

    A1  WIFI       Is this handset on Wi-Fi rather than mobile data?
                   Uses @capacitor/network IF PRESENT (it is not, today - see
                   3.1). Absent, this probe reports 'unknown' and the resolver
                   routes to S5 instead of S0. Never guesses.

    A2  RAWIP      fetch('https://1.1.1.1/cdn-cgi/trace')
                   An IP literal. NO NAME LOOKUP OCCURS. Proves an internet
                   path exists with name resolution taken out of the question.
                   >>> THIS IS THE MOST IMPORTANT LINE OF CODE IN IONIBOT.

    A3  DNS        fetch('https://dns.google/generate_204')
                   A hostname. Requires resolution to succeed.

    A2 PASS + A3 FAIL = the fault is name lookup, which means it is OURS.
    A2 FAIL          = the fault is the line or the router, which is NOT OURS.
    That single comparison is the whole product.

    A4  NODE       fetch('http://<cachedNodeIp>:8080/api/v1/system/status')
                   Is the agent alive and reachable from this handset?

    A5  NETCHECK   The agent's netcheck payload. Only attempted when A4 passes.
                   Supplies: household listener alive, router actually
                   forwarding, IPv6 state, rate limit, bypass state.

SEVEN STATES

  ST  A1    A2    A3    A4    LISTENER  MEANING / SCREEN
  --  ----  ----  ----  ----  --------  ----------------------------------------
  S0  FAIL  -     -     -     -         Phone on mobile data          IB-201
  S1  PASS  FAIL  -     -     -         Internet down - NOT US        IB-203
  S2  PASS  PASS  FAIL  FAIL  -         BOX OFF - the Class A outage  IB-204
  S3  PASS  PASS  FAIL  PASS  FAIL      Box alive, resolver down      IB-206
  S4  PASS  PASS  FAIL  PASS  PASS      Phone bypassing the box       IB-208
  S5  PASS  PASS  PASS  FAIL  -         Fine, but cannot see the box  IB-209
  S6  PASS  PASS  PASS  PASS  PASS      Healthy                       IB-210

  S2 is the outage that started this work. No automatic recovery exists today.
  S4 is the 2026-08-18 field fault - the box answers but the handset asks the
     router instead, because the router advertises itself as IPv6 DNS server.
     Detected in under three seconds. It previously took days to find by hand.


5. WHY THIS REPLACES A CALL CENTRE
========================================================================================
    * IT ANSWERS THE QUESTION A CUSTOMER ACTUALLY ASKS. Not "what is wrong with
      my DNS" but "why is my internet not working, and is it your box". Ionibot
      answers that in five seconds, out loud, and tells them when it is not us.
    * IT STOPS THE WORST CUSTOMER BEHAVIOUR. An owner who suspects the box will
      UNPLUG IT to test - which is the Class A outage. Ionibot offers a five
      minute pause instead. Screen IB-306 exists solely to prevent that.
    * IT NEVER GUESSES. Carried from router_handshake.py rule 5: an unknown
      router is a refusal, not a guess. No improvised instructions on anyone's
      gateway.
    * IT IS AUDITABLE. Every path is enumerable and testable, so it can be
      signed off under Policy 986. A language model cannot offer that.
    * IT COLLECTS NOTHING. Preserves the boundary health_feed.py enforces by
      construction.


6. RISKS AND WHAT COMPENSATES FOR THEM
========================================================================================
    R1  CLEARTEXT HTTP TO THE BOX (A4/A5)
        The box serves the API over plain HTTP on the LAN. Reaching it from the
        app needs an Android network-security-config entry and an iOS ATS
        exception. ALREADY SOLVED - commit cfccc48 fixed exactly this ("the
        cleartext policy could not match a node's IP, so no request left the
        phone"). Ionibot inherits it. Must be re-verified on any app rebuild.

    R2  BUNDLED CONTENT GOES STALE
        Every screen ships in the binary, so a wrong instruction ships too.
        COMPENSATION: the tree is one data file, versioned independently and
        pinned against the agent's netcheck version. A netcheck gaining a check
        without a matching branch is a FAILING TEST, not a silent gap.

    R3  FALSE REASSURANCE
        The most dangerous failure is telling a customer they are protected
        when they are not.
        COMPENSATION: a check that could not run renders as "I couldn't check
        this", never as a pass - the findings/gaps split posture.py already
        enforces. S5 says "probably still working", and that wording is not to
        be upgraded.

    R4  COMPETING RECOVERY
        Ionibot restarting the DNS stack while dns-watchdog.sh is mid-escalation
        makes outages longer.
        COMPENSATION: S3 tells the customer to wait two minutes and offers a
        manual restart only after five. Ionibot never acts inside the
        watchdog's window.

    R5  IONIBOT CANNOT FIX A CLASS A DEPENDENCY - ONLY EXPLAIN ONE
        Screens IB-204, IB-205, IB-602 and IB-605 exist ONLY because the box
        makes a permanent change to the router that only the living box can
        undo. Ionibot makes that outage survivable. It does not make it rare.
        >>> THIS IS NOT A SUBSTITUTE FOR THE ARCHITECTURE DECISION IN
            DOC-2026-08-002 PART 5. Under Option 2, IB-205 is deleted outright
            and IB-204 becomes reassurance rather than an emergency.
        >>> SOUTH AFRICAN CONTEXT: under load-shedding the box loses power
            routinely, not exceptionally. Every outage schedule is currently a
            household internet outage requiring human recovery. Ionibot turns
            that from a phone call into a screen. Only the architecture turns
            it into a non-event.


7. BUILD ORDER
========================================================================================
    PHASE 1 - now, unaffected by the architecture decision
        Probe layer, state resolver, overlay shell, Setup flow (IB-100),
        Blocked website (IB-300), Protection status (IB-400), Pause (IB-500).
        ~2 weeks.

    PHASE 2 - after the architecture decision
        Fault-flow copy (IB-200 series) and Move/Remove (IB-600).
        ~1 week.
        Written before the decision, half of this copy is thrown away.

    DELIVERED WITH THIS PROPOSAL
        A complete, working Phase 1 + Phase 2 implementation, written against
        the current architecture, with every architecture-dependent string
        marked in the source so the Option 2 rewrite is a find, not a rewrite.


8. ACCEPTANCE CRITERIA
========================================================================================
    AC1  All seven states reachable and correct on real hardware. The three
         that matter: box powered off (S2), router IPv6 with no route (S4),
         and uninstall attempted while the box is dead - which has never been
         tested.
    AC2  Every screen renders with the handset in airplane mode plus Wi-Fi
         only, with no internet. A build-time test asserts the Ionibot module
         imports no remote resource.
    AC3  No screen is a dead end. Automated assertion over the tree: every
         node has at least one action, and every target resolves.
    AC4  No probe result is logged, stored beyond the session, or transmitted.
    AC5  Zero new runtime dependencies and zero new app permissions.
    AC6  Readable by TalkBack and VoiceOver; no meaning carried by colour
         alone.
    AC7  Tested by someone who did not write it and does not work in IT.


9. APPROVAL
========================================================================================
    RECOMMENDATION
        Approve Phase 1 and Phase 2 as delivered. Ionibot is the cheapest
        meaningful reduction in support burden available to this product:
        no running cost, no infrastructure, no permissions, no privacy
        surface, and it is auditable.
        It must not, however, be treated as the answer to the dependency
        problem. Approve it alongside a decision on DOC-2026-08-002 Part 5,
        not instead of one.

    DECISIONS REQUIRED
        D1  Approve Ionibot as an embedded overlay in the mobile app.      [ ]
        D2  Confirm floating button (recommended) or bottom-nav tab.       [ ]
        D3  Approve Afrikaans as a launch language.                        [ ]
        D4  Separately decide the architecture (DOC-2026-08-002 Part 5).   [ ]

    APPROVED BY ......................................  DATE ................
        Johan Wilhelm van Antwerp
        Founder, Technical Lead & Architect - Ionity (Pty) Ltd

========================================================================================
END OF DOCUMENT - DOC-2026-08-004 v1.0
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Governance: Policy 986 AED | Anything is Possible with God.
========================================================================================
