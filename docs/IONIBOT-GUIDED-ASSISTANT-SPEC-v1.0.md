========================================================================================
IONIBOT - GUIDED ASSISTANT SPECIFICATION
The whole support desk, bundled in the app, working with the phone offline.
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-003 | Version: 1.0 | Updated: 2026-08-19 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
Companion document: DOC-2026-08-002 (Function & Dependency Map)
========================================================================================


========================================================================================
1. WHAT IONIBOT IS
========================================================================================

    A menu-driven guided assistant inside the Gate^Flame mobile app.
    No language model. No cloud. No backend. No inference.
    A deterministic decision tree over probes that run entirely on the handset.

PURPOSE
    1. Walk the owner through first-time setup of the Gate^Flame device.
    2. Diagnose any fault, and say honestly whether it is ours or not.
    3. Guide the owner to a fix, in their own words, with no jargon.
    4. Handle every dependency and foreseeable situation the device creates.

NON-PURPOSE
    Ionibot does not chat, improvise, generate text, or answer open questions.
    Every path is enumerable and testable. That is the point - on a security
    product, an auditable flow beats a clever one, and it can be signed off
    under Policy 986. An assistant that can invent router instructions is an
    assistant that can brick a household's internet.

THE FIVE RULES
    R1  OFFLINE OR IT DOES NOT COUNT.
        Every screen, every string, every image ships inside the app binary.
        Nothing is fetched. The moment Ionibot is needed most is the moment
        there is no DNS - so it must never need the network to render.

    R2  NO DEAD ENDS.
        Every leaf ends in either an action the owner can take, or an honest
        "this is ours, not yours" with what happens next. A leaf that only
        describes a problem is a support call with extra steps.

    R3  NEVER GUESS.
        Carried directly from router_handshake.py rule 5 - an unknown router
        model is a refusal, not a guess. Ionibot says "I don't know this
        router" and switches to the guided flow. It never improvises steps
        on someone's gateway.

    R4  NEVER BLAME THE CUSTOMER.
        When the fault is ours, say so first, plainly, before any instruction.
        When it is the ISP or router, say that too. Misattributed blame is
        how a product loses a household.

    R5  NOTHING LEAVES THE PHONE.
        No probe result, no diagnosis, no network detail is transmitted
        anywhere. This preserves the boundary health_feed.py enforces by
        construction. Ionibot is a local function, not a telemetry channel.


========================================================================================
2. THE PROBE LAYER
========================================================================================

Seven probes. All local. None requires a server, an account, or DNS to work.
Run in parallel where possible; whole sweep must complete in under 8 seconds.

    P1  WIFI          Is the handset associated with a Wi-Fi network?
                      Source: Capacitor Network API / native.
                      Also capture SSID for P7.

    P2  GATEWAY       Is the default gateway reachable?
                      TCP connect to <gw>:80, fall back to <gw>:53.
                      Timeout 2s.

    P3  RAWIP         Is there an internet path at all, with DNS taken out
                      of the question?
                      TCP connect to 1.1.1.1:443, then 8.8.8.8:443.
                      Timeout 3s each.
                      >>> THIS IS THE MOST IMPORTANT PROBE IN THE SYSTEM.
                      P3 pass + P4 fail = the fault is name resolution, which
                      means it is us. P3 fail = it is the router or the ISP,
                      which means it is not.

    P4  DNS           Does resolution work through whatever resolver this
                      handset was handed?
                      Resolve a known host. Timeout 5s.

    P5  NODE_API      Is the agent alive?
                      GET http://<node>:8080/api/v1/system/status
                      Node address resolution order:
                        1. last-known IP from local storage
                        2. mDNS gateflame.local
                      >>> ORDER MATTERS. avahi publishes every address the box
                      holds, so under dual-homing gateflame.local can resolve
                      to an address that serves the API but has no resolver
                      behind it. Last-known IP first avoids that trap.

    P6  NODE_DNS      Is the household-facing resolver answering?
                      UDP DNS query direct to <node>:53. Timeout 3s.
                      Distinct from P4: P4 tests the resolver the phone was
                      GIVEN, P6 tests the box itself. The difference between
                      them is how we detect that the router is not forwarding.

    P7  SSID_MATCH    Is this the same network the box was paired on?
                      Compare P1 SSID against stored pairing SSID.

OPTIONAL, ONLY WHEN P5 PASSES
    P8  NETCHECK      GET the agent's netcheck JSON (gateflame-netcheck.sh
                      --json equivalent). Gives the seven Class A conditions
                      with severity and fix order, already computed. Ionibot
                      renders it; it does not re-derive it.


========================================================================================
3. STATE RESOLUTION MATRIX
========================================================================================

Eight terminal states. This table IS the diagnostic engine.
"-" means not evaluated (short-circuited).

  STATE  P1    P2    P3     P4    P5      P6    MEANING
  -----  ----  ----  -----  ----  ------  ----  --------------------------------
  S0     FAIL  -     -      -     -       -     Handset not on Wi-Fi
  S1     PASS  FAIL  -      -     -       -     On Wi-Fi, no working network
  S2     PASS  PASS  FAIL   FAIL  -       -     Router or ISP down - NOT US
  S3     PASS  PASS  PASS   FAIL  FAIL    -     BOX OFF OR UNREACHABLE  <<<
  S4     PASS  PASS  PASS   FAIL  PASS    FAIL  Box alive, resolver down
  S5     PASS  PASS  PASS   FAIL  PASS    PASS  Box resolves - phone isn't using it
  S6     PASS  PASS  PASS   PASS  FAIL    -     Internet fine, box unreachable
  S7     PASS  PASS  PASS   PASS  PASS    PASS  Everything healthy

NOTES ON THE STATES THAT MATTER

  S3 is the Class A outage. Today it has no automatic recovery at all. This is
     the single screen whose copy changes completely if the architecture moves
     to router-forwarding (see DOC-2026-08-002 Part 5, Option 2).

  S4 is a software failure while the box is alive - exactly what dns-watchdog.sh
     covers. Ionibot's job is to say "it is already fixing itself, wait 2
     minutes" and offer a manual restart if it does not.

  S5 IS THE 2026-08-18 FAULT. The box answers on :53 but this handset is using
     a different resolver - almost always because the router advertised itself
     as IPv6 DNS server (RDNSS) and phones prefer IPv6. The phone is unfiltered
     AND stalling on AAAA. Desktops do not show this (RFC 6724 ranks ULA below
     IPv4 on Windows). If S5 appears on a phone and S7 on a laptop, it is IPv6.

  S7 is not "no problem" - it routes to the blocked-site flow, because a
     healthy network with an unhappy owner means a false positive.


========================================================================================
4. ROOT MENU
========================================================================================

[IB-000]  ROOT
TITLE:    "How can I help?"
BODY:     none
ACTIONS:
    "Set up my Gate^Flame"              -> IB-100
    "Something isn't working"            -> IB-200  (runs full probe sweep)
    "A website I need is blocked"        -> IB-300
    "Check my protection"                -> IB-400
    "Turn filtering off for a while"     -> IB-500
    "Move, replace or remove my box"     -> IB-600
NOTES:
    Order is deliberate. "Something isn't working" is second because it is
    what a distressed owner reaches for, and it must not be buried.


========================================================================================
5. SETUP FLOW  (IB-100)
========================================================================================

[IB-101]  WHAT YOU NEED
BODY:
    "This takes about five minutes.
     You will need:
       - your Gate^Flame box and its power supply
       - the network cable in the box
       - your router's admin password
     Don't have the router password? It is often printed on a sticker on the
     router itself. If you can't find it, I can show you another way."
ACTIONS:  "I have everything" -> IB-102
          "I can't find my router password" -> IB-110

[IB-102]  PLUG IN
BODY:
    "1. Plug the network cable from the box into any spare port on your router.
     2. Plug in the power.
     3. Wait until the screen on the box shows a code.
     This takes about a minute the first time."
ACTIONS:  "I see a code" -> IB-104
          "Nothing on the screen" -> IB-103

[IB-103]  NO LIGHT / NO SCREEN
BODY:
    "Let's check the basics.
       - Is the power adapter pushed all the way in at both ends?
       - Is the plug switched on at the wall?
       - Try a different wall socket.
     Give it two minutes after plugging in before deciding it isn't working."
ACTIONS:  "It's working now" -> IB-104
          "Still nothing" -> IB-990

[IB-104]  JOIN THE SAME WI-FI
PROBE:    P1, P2
BODY:
    "Make sure this phone is on the same Wi-Fi as your router - not on mobile
     data. I'll find the box automatically."
ACTIONS:  auto-advance on P1 PASS -> IB-105
          "Open Wi-Fi settings" -> native settings deep link
BRANCH:   P1 FAIL -> IB-201 (not on Wi-Fi)

[IB-105]  ENTER THE PAIRING CODE
PROBE:    P5 (discovery)
BODY:
    "Type the code showing on the box's screen.
     The code expires after a few minutes - if it runs out, the box will show
     a new one."
ACTIONS:  submit -> IB-106
BRANCH:   P5 FAIL -> IB-206 (can't find the box)
NOTES:    Pairing codes have limited attempts (storage.py). After the last
          attempt, say so plainly and tell them to read the new code off the
          screen. Never say "invalid code" without saying what to do next.

[IB-106]  WHY I NEED THE ROUTER PASSWORD
BODY:
    "One setting on your router has to change, once, so that every device in
     your house is protected - not just this phone.
     I will change that one setting and nothing else.
     Your password is used for this and then forgotten. It is never saved,
     never written down, and never sent anywhere."
ACTIONS:  "Continue" -> IB-107
          "I'd rather do it myself" -> IB-110
NOTES:    This screen exists because asking for a router password with no
          explanation is how an install gets abandoned. Copy must be exact -
          it is a promise the code keeps (router_handshake.py rule 1).

[IB-107]  MAKING THE CHANGE
BODY:     "Talking to your router. This takes a few seconds."
BRANCH:   known model, success   -> IB-108
          known model, failed    -> IB-109
          UNKNOWN MODEL          -> IB-110
NOTES:    R3. An unknown model is a refusal. Never attempt endpoints to see
          what happens.

[IB-108]  CHECKING IT ACTUALLY TOOK
PROBE:    P6, P8
BODY:     "Confirming the change really saved."
BRANCH:   verified -> IB-111
          not verified -> IB-109
NOTES:    A router UI that reports "saved" and did not save has already cost
          this project days of believing a cutover was live. Verification by
          re-read is mandatory and must never be removed to save a second.

[IB-109]  I COULDN'T CHANGE IT AUTOMATICALLY
BODY:
    "I couldn't make the change on your router. That's on me, not you.
     I'll show you exactly where to tap instead - it's two settings and about
     a minute."
ACTIONS:  "Show me" -> IB-110

[IB-110]  GUIDED MANUAL ROUTER CHANGE
BODY:
    "Open your router's settings page in a browser: <gateway IP>
     Then find the DHCP or LAN settings.
     Set the DNS server to: <node IP>
     Leave the second DNS field EMPTY.
     Save."
ACTIONS:  "Done" -> IB-111
          "I can't find that setting" -> IB-991
NOTES:    Per-vendor screenshots bundled where available; generic wording
          otherwise. Screenshots must ship in the binary (R1).
          >>> ARCHITECTURE-DEPENDENT. Under Option 2 this screen changes to
          the router's UPSTREAM / WAN DNS field instead of the LAN/DHCP field,
          and the "leave second field empty" instruction is REMOVED - a
          fallback upstream becomes desirable rather than forbidden.

[IB-111]  ONE MORE THING - IPv6
PROBE:    P8 (ipv6 check)
BODY:     shown ONLY if netcheck reports IPv6 advertised with no route:
    "Your router is advertising a newer type of internet address that it
     cannot actually reach. Phones prefer it, so they try it, fail, and then
     decide your Wi-Fi is broken.
     This must be switched off or your phones will keep dropping off the Wi-Fi.
     In your router settings, find IPv6 and set it to Off or Disabled."
ACTIONS:  "Done" -> IB-112
          "I'll do it later" -> IB-112 with a persistent warning banner
NOTES:    >>> THIS IS A REQUIRED STEP, NOT AN OPTIONAL ONE.
          The box can mask this with filter-AAAA, but masking makes the box
          load-bearing for a router fault - so unplugging the box then breaks
          phones a SECOND, independent way. Fix it at the source, once.
          Ionibot must never present the mask as the solution.

[IB-112]  YOU'RE PROTECTED
PROBE:    P8
BODY:
    "Done. Every device on your Wi-Fi is now protected.
     Two things to know:
       - Protection is on the lowest setting. It blocks ads and trackers and
         will not break anything. You can turn it up later.
       - Some devices need to reconnect to the Wi-Fi before they're covered.
         Turning Wi-Fi off and on again on each one is enough."
ACTIONS:  "Finish" -> IB-000


========================================================================================
6. FAULT FLOW  (IB-200)
========================================================================================

[IB-200]  DIAGNOSING
BODY:     "Checking a few things. About five seconds."
ACTION:   run P1-P6 (+P8 if P5 passes), resolve state, route to IB-201..IB-208.
NOTES:    Show a progress indicator, never a spinner with no text. If the
          sweep exceeds 8s, route on what has resolved and mark the rest
          unknown - never hang.

----------------------------------------------------------------------- S0
[IB-201]  THIS PHONE ISN'T ON WI-FI
BODY:
    "This phone is using mobile data, not your home Wi-Fi. That's why things
     look different.
     Connect to your home Wi-Fi and I'll check again."
ACTIONS:  "Open Wi-Fi settings" -> native
          "Check again" -> IB-200

----------------------------------------------------------------------- S1
[IB-202]  ON WI-FI, BUT NO NETWORK
BODY:
    "This phone has joined the Wi-Fi but isn't getting through to your router.
     Usually this is signal or the router itself.
     Try, in this order:
       1. Move closer to the router.
       2. Turn this phone's Wi-Fi off and on.
       3. Restart the router - unplug it, wait ten seconds, plug it back in.
     This is not your Gate^Flame box."
ACTIONS:  "Check again" -> IB-200

----------------------------------------------------------------------- S2
[IB-203]  YOUR INTERNET IS DOWN - NOT YOUR BOX
BODY:
    "Your internet connection itself is down. I checked, and it isn't your
     Gate^Flame box - the box only handles which sites are allowed, and it
     can't stop your line from working.
     This is your router or your internet provider.
     Try restarting the router. If that doesn't help, it's worth checking
     whether your provider has a fault in your area."
ACTIONS:  "Check again" -> IB-200
NOTES:    R4. Saying "not us" clearly and early is the entire value of this
          screen. Owners blame the newest thing on the network by default.

----------------------------------------------------------------------- S3  <<<
[IB-204]  YOUR BOX IS OFF OR UNPLUGGED
STATE:    THE CLASS A OUTAGE
BODY (CURRENT ARCHITECTURE):
    "Your Gate^Flame box isn't responding, and because your router sends all
     name lookups to it, websites won't load until it's back.
     Check, in this order:
       1. Is the box's power light on?
       2. Is the power adapter firmly in at both ends?
       3. Is the network cable still in the router?
       4. Was there a power cut? The box needs a minute or two after power
          comes back.
     If the box is on and you still have no internet, tap below and I'll walk
     you through getting your internet back straight away."
ACTIONS:  "The box is on now" -> IB-200
          "I need internet NOW" -> IB-205
NOTES:    >>> ARCHITECTURE-DEPENDENT - THIS IS THE SCREEN THAT JUSTIFIES THE
          WHOLE REDESIGN.
          Under Option 2 (router forwards to us), this state stops being an
          outage. The copy becomes:
              "Your box is off, so filtering is paused. Your internet is
               working normally. Plug the box back in whenever you like."
          No emergency, no instructions, no IB-205 at all. Same code path,
          completely different product.
          >>> SOUTH AFRICAN CONTEXT: with load-shedding, the box loses power
          ROUTINELY, not exceptionally. Under the current architecture every
          single outage schedule is a household internet outage plus a
          recovery that needs a human. This state is not an edge case here -
          it is a weekly event.

[IB-205]  EMERGENCY - GET MY INTERNET BACK
BODY:
    "This will switch protection off until your box is working again.
       1. Open your router settings: <gateway IP>
       2. Find DHCP or LAN settings.
       3. Set DNS back to Automatic (or clear the DNS field).
       4. Save.
       5. On each device, turn Wi-Fi off and on.
     Your internet will work immediately. Nothing is protected until you set
     it back, and I'll remind you."
ACTIONS:  "I've done that" -> set persistent UNPROTECTED banner -> IB-000
NOTES:    This screen is the support call in written form. Its existence is
          the argument for Option 2. Under Option 2, DELETE IT.

----------------------------------------------------------------------- S4
[IB-206]  YOUR BOX IS BUSY FIXING ITSELF
BODY:
    "Your box is on, but the part that looks up website names has stopped.
     It has already noticed and is restarting itself. This usually takes
     under two minutes.
     Give it a moment and check again."
ACTIONS:  "Check again" -> IB-200
          "It's been more than five minutes" -> IB-207
NOTES:    True statement - dns-watchdog.sh runs every 60s and escalates
          restart -> recreate -> bypass over five cycles. Ionibot should NOT
          restart anything before the watchdog has had its five minutes;
          competing recovery attempts make outages longer.

[IB-207]  RESTART THE PROTECTION SERVICE
BODY:
    "I'll restart the lookup service on your box now. Your internet may pause
     for a few seconds."
ACTIONS:  "Restart it" -> POST /api/v1/services/{id}/start (control scope)
          then -> IB-200
          "No, leave it" -> IB-000
NOTES:    Requires only `control` scope - starting a module is what a remote
          is for (services.py). Stopping needs kiosk scope and is not offered
          here.

----------------------------------------------------------------------- S5
[IB-208]  THIS PHONE IS BYPASSING YOUR BOX
STATE:    THE 2026-08-18 FAULT
BODY:
    "Your box is working, but this phone isn't using it - so this phone isn't
     protected, and it may keep dropping off the Wi-Fi.
     This happens when your router hands out a newer type of internet address
     that it can't actually reach. Phones prefer it and get stuck.
     The fix is on your router, and it's permanent once done:
       1. Open your router settings: <gateway IP>
       2. Find IPv6.
       3. Set it to Off or Disabled.
       4. Save, then turn this phone's Wi-Fi off and on."
ACTIONS:  "Show me where" -> IB-110 style per-vendor guide
          "Done" -> IB-200
NOTES:    Detection is exactly P4 FAIL + P6 PASS, or P8 reporting IPv6
          advertised with no default route. If this shows on a phone but a
          laptop is fine, it is certainly this.

----------------------------------------------------------------------- S6
[IB-209]  INTERNET IS FINE, I JUST CAN'T REACH YOUR BOX
BODY:
    "Your internet is working normally. I just can't talk to your box from
     this phone, so I can't show you its status.
     Most often this is because:
       - this phone is on a guest network, or a different Wi-Fi
       - the box's address changed after a restart
     Check you're on your main Wi-Fi, then check again. Your protection is
     probably still working - I just can't confirm it from here."
ACTIONS:  "Check again" -> IB-200
          "Find my box again" -> re-run discovery
NOTES:    Honesty: "probably still working" is correct and must not be
          upgraded to "working". A blind check must never render as a pass.

----------------------------------------------------------------------- S7
[IB-210]  EVERYTHING LOOKS HEALTHY
PROBE:    P8 rendered
BODY:
    "I checked everything and it all looks right:
       - your internet is working
       - your box is answering
       - this phone is protected
     If a particular website isn't loading, it may be blocked on purpose."
ACTIONS:  "A website is blocked" -> IB-300
          "Show me the details" -> IB-400
          "Something else is wrong" -> IB-992


========================================================================================
7. BLOCKED WEBSITE FLOW  (IB-300)
========================================================================================

[IB-301]  WHICH SITE?
BODY:     "Type the address of the site that isn't working."
ACTIONS:  submit -> IB-302

[IB-302]  IS IT US?
BODY:     "Checking whether we're the reason."
ACTION:   query the box for that domain's block status + which list matched.
BRANCH:   blocked by us -> IB-303
          not blocked   -> IB-306

[IB-303]  YES, WE BLOCKED IT
BODY:
    "We blocked <site>. It's on the <list name> list, which is part of your
     <threat level / category> setting.
     You have three choices."
ACTIONS:  "Always allow this site"     -> allowlist -> IB-305
          "Turn off <category>"         -> IB-304
          "Leave it blocked"            -> IB-000

[IB-304]  TURNING A CATEGORY OFF
BODY:
    "This will unblock <site> and everything else in <category>.
     <plain statement of what else the category covers>"
ACTIONS:  "Turn it off" -> PUT /api/v1/filtering/categories -> IB-305
          "Cancel" -> IB-303
NOTES:    content_categories.py already requires each category to state what
          it breaks. Surface that string verbatim - "Social Media" that also
          kills WhatsApp is a support call.

[IB-305]  DONE - GIVE IT A MOMENT
BODY:
    "Changed. Your box is updating its lists now - this takes up to a minute.
     If the site still doesn't load after that, close and reopen your browser."
NOTES:    blocklists.py rebuilds gravity on a thread and exposes `applying`.
          Show that state; never imply the change has taken effect before it
          has, or the owner taps again and queues a second rebuild.

[IB-306]  IT ISN'T US
BODY:
    "We're not blocking <site>. Your box is letting it through.
     The site may be down, or blocked somewhere else - your browser, your
     phone's settings, or the site's own country restrictions.
     If you want to be certain it isn't us, you can pause protection for five
     minutes and try again."
ACTIONS:  "Pause for 5 minutes" -> IB-500
          "OK" -> IB-000
NOTES:    Offering the pause here is what stops the owner UNPLUGGING THE BOX
          to test - which is the Class A outage. filtering_state.py exists
          for precisely this reason. This screen is load-bearing.


========================================================================================
8. PROTECTION STATUS  (IB-400)
========================================================================================

[IB-401]  YOUR PROTECTION
PROBE:    P8
BODY:     Render netcheck JSON in plain language. One line per condition.
          PASS -> plain tick and a sentence.
          WARN -> amber, sentence, optional action.
          FAIL -> red, sentence, action, in netcheck's own fix order:
                    1. router forwarding
                    2. IPv6
                    3. dual-homing
                    4. rate limiting
          Each condition can mask the next, so they must be presented and
          fixed in that order - never as an unordered list.
ACTIONS:  per-condition "Fix this" -> relevant guide
          "Done" -> IB-000
NOTES:    A GAP (could not check) renders as "I couldn't check this", never
          as a pass. posture.py already separates findings from gaps for this
          reason - preserve the distinction in the UI.


========================================================================================
9. PAUSE FLOW  (IB-500)
========================================================================================

[IB-501]  PAUSE PROTECTION
BODY:
    "While paused, nothing is filtered. Ads come back and nothing is blocked.
     Your internet keeps working normally."
ACTIONS:  "5 minutes" / "1 hour" / "Until I turn it back on" -> IB-502
          "Cancel" -> IB-000

[IB-502]  PAUSED
BODY:
    "Protection is OFF. It comes back on by itself at <time>."
    (indefinite: "It stays off until you turn it back on. It will still be
     off after a restart.")
ACTIONS:  "Turn protection back on now" -> POST /filtering/resume
NOTES:    Persistent app-wide banner while paused. Every surface must report
          OFF. The product must never look like it is working when it isn't.
          Threat level and categories are remembered and restored on resume -
          say so, or owners fear losing their settings and unplug instead.


========================================================================================
10. MOVE / REPLACE / REMOVE  (IB-600)
========================================================================================

[IB-601]  WHAT ARE YOU DOING?
ACTIONS:  "Moving it to another spot"   -> IB-602
          "I got a new router"           -> IB-603
          "New phone"                    -> IB-604
          "Removing it for good"         -> IB-605

[IB-602]  MOVING THE BOX
BODY:
    "Unplug it, move it, plug it back in. Same router, any spare port.
     Nothing else to do - I'll find it again automatically.
     Your internet will be down for a minute or two while it starts up."
NOTES:    >>> ARCHITECTURE-DEPENDENT. The last line disappears entirely under
          Option 2.

[IB-603]  NEW ROUTER
BODY:
    "A new router doesn't know about your box yet, so we need to make that one
     setting change again.
     Plug the box into the new router, then tap below."
ACTIONS:  "Set up with my new router" -> IB-106
NOTES:    Also the recovery path for a factory-reset router. Detect it by
          netcheck's router-forwarding check failing while the box is healthy.

[IB-604]  NEW PHONE
BODY:
    "Install the app on the new phone, then read the code off the box's screen
     to pair it. Your old phone stays paired unless you remove it."
ACTIONS:  "Remove my old phone" -> device list

[IB-605]  REMOVING THE BOX PROPERLY
BODY:
    "IMPORTANT: do this BEFORE you unplug the box.
     Your router is currently pointed at the box. If you just unplug it, your
     router keeps looking for a box that isn't there and websites will stop
     loading.
     Tap below and I'll put your router back the way it was first."
ACTIONS:  "Put my router back and remove the box" -> handshake reversal -> IB-606
          "Cancel" -> IB-000
NOTES:    >>> THE MOST IMPORTANT WARNING IN THE PRODUCT under the current
          architecture. router_handshake.py records every change so it can be
          reversed - but only the LIVING box can do the reversal. Uninstall
          must happen while it is still on.
          >>> Under Option 2 this screen becomes routine and loses the warning
          entirely: unplugging is safe, and reversal is housekeeping.

[IB-606]  DONE
BODY:
    "Your router is back the way it was. You can unplug the box now.
     Nothing on your network is filtered any more."


========================================================================================
11. FALLBACK LEAVES
========================================================================================

[IB-990]  BOX WON'T POWER ON
BODY:     "The box isn't powering up. That's a hardware fault, not something
           you can fix. Here's how to reach us: <contact>"
NOTES:    R2 - a dead end is only acceptable when the answer genuinely is
          "this needs replacing", and even then it must name the next step.

[IB-991]  CAN'T FIND THE ROUTER SETTING
BODY:     "Routers hide this in different places. Take a photo of your
           router's settings page and send it to <contact> - we'll tell you
           exactly where to tap, and add your router model so the next person
           doesn't have to ask."
NOTES:    Turns an unknown model into a one-time data collection rather than a
          recurring support call. Feeds router_handshake.py's model coverage.

[IB-992]  SOMETHING ELSE
BODY:     "Tell us what's happening: <contact>. Include what you were doing
           and what you expected."
NOTES:    Only reachable from S7 (everything healthy). This is the honest
          "we don't know" leaf, and it should be rare.


========================================================================================
12. COPY RULES
========================================================================================
    C1  Short sentences. Target Grade 8. Written for an English second-language
        reader without simplifying to the point of vagueness.
    C2  No jargon in body copy. Banned: DNS, resolver, DHCP, gateway, IPv6
        (except where the owner must find that literal word in a router UI),
        Pi-hole, container, upstream, ARP.
        Use: "looking up website names", "your router", "your box".
    C3  Say whose fault it is in the FIRST sentence.
    C4  Every instruction is a numbered step with one action per step.
    C5  Never say "error", "invalid" or "failed" without the next action in
        the same breath.
    C6  Never claim something is fixed before it is. Use the `applying` state.
    C7  Never render a check we could not perform as a pass.
    C8  All device-specific values (<gateway IP>, <node IP>, <site>) are
        substituted at render time from local probes, never hardcoded.


========================================================================================
13. IMPLEMENTATION NOTES
========================================================================================
    I1  Ships inside the Capacitor app bundle. No network fetch for any
        screen, string, or image. Enforce with a build-time test that the
        Ionibot module imports nothing remote.
    I2  Tree defined as data (JSON/TS const), not scattered through
        components. One file, reviewable, diffable, sign-off-able under 986.
    I3  Version the tree independently of the app (ionibot.tree.version) and
        pin it against the agent's netcheck version. If netcheck grows a
        check, the tree needs a branch - that is the only ongoing maintenance
        cost and it must be a visible, failing test rather than a silent gap.
    I4  Probes go through one injectable module so all eight states can be
        driven in tests without a Pi, a router, or a network - the same seam
        discipline as firewall.py and wan.py.
    I5  No analytics, no crash payloads containing probe output. R5.
    I6  Accessibility: every screen readable by TalkBack/VoiceOver; no
        meaning carried by colour alone (netcheck PASS/WARN/FAIL must carry
        text as well as colour).
    I7  Afrikaans string table from day one - the tree is data, so a second
        language is a translation file, not a rewrite. Do it before the copy
        set grows.


========================================================================================
14. TEST MATRIX - MUST ALL BE EXERCISED ON REAL HARDWARE
========================================================================================
    T0  Phone on mobile data only                            -> S0  / IB-201
    T1  Wrong Wi-Fi password / weak signal, associated only   -> S1  / IB-202
    T2  WAN cable out of the router                           -> S2  / IB-203
    T3  BOX POWERED OFF                                       -> S3  / IB-204
    T4  Box on, Pi-hole container stopped                     -> S4  / IB-206
    T5  Router IPv6 on with no v6 route, box healthy          -> S5  / IB-208
    T6  Phone on guest SSID, box healthy                      -> S6  / IB-209
    T7  Everything healthy                                    -> S7  / IB-210
    T8  Box in bypass mode                          -> IB-401 shows UNPROTECTED
    T9  Dual-homed box, :53 on one address only     -> IB-401 FAIL, correct order
    T10 Pi-hole rate limit non-zero, router forwarding -> intermittent, must be
                                                          NAMED not guessed at
    T11 Unknown router model at handshake                     -> IB-110, no guess
    T12 Router says "saved" but did not                       -> IB-109, not IB-112
    T13 Pairing code attempts exhausted             -> clear next action, not
                                                       "invalid code"
    T14 Uninstall while box is ALIVE                          -> IB-605 reversal OK
    T15 Uninstall attempted while box is DEAD  -> must refuse and explain, never
                                                  silently fail
    NOTE: T3, T5 and T15 are the three that matter. T3 and T5 are the faults
    that were observed in the field. T15 is the one that has never been tested.


========================================================================================
15. WHAT THIS DOES NOT SOLVE
========================================================================================
    Ionibot is a guide, not a fix. It cannot resolve a single Class A
    dependency - it can only explain one. Screens IB-204, IB-205, IB-602 and
    IB-605 exist ONLY because the box currently makes a permanent change to
    the router that only the living box can undo.

    Under Option 2 of DOC-2026-08-002:
        IB-205  is DELETED
        IB-204  becomes reassurance instead of an emergency
        IB-605  loses its warning and becomes housekeeping
        IB-602  loses its outage caveat

    BUILD ORDER, THEREFORE:
        1. Decide the architecture.
        2. Build IB-100 (setup) and IB-300/400/500 now - none of those change.
        3. Write the fault-flow copy LAST. Written before the decision, half
           of it is copy you will throw away.

    SIZING: 2-3 weeks for one developer, all of it. R0 running cost, no
    backend, no inference, works with the handset fully offline.

========================================================================================
END OF DOCUMENT - DOC-2026-08-003 v1.0
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Governance: Policy 986 AED | Anything is Possible with God.
========================================================================================
