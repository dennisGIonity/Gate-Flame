========================================================================================
GATE^FLAME - FUNCTION & DEPENDENCY MAP
Every function on the small device: what it does, and what it costs you.
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-002 | Version: 1.0 | Updated: 2026-08-19 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================

SOURCE OF TRUTH
    Compiled by reading the code at E:\Gateflame, commit 031a5bc (= tag v1.0.2).
    Nothing in this document is assumed. Every claim traces to a module or script
    in node-agent/gateflame/ or node-agent/*.sh.

PURPOSE
    You asked: list every function we put on the device, what it does, and what
    complications it causes that must be compensated for.
    This is that list. It is ordered by BLAST RADIUS, worst first - not by
    importance, not by build order.


========================================================================================
PART 0 - THE ONE QUESTION THAT DECIDES EVERYTHING
========================================================================================

For every function, ask: IF THE BOX IS UNPLUGGED, WHAT BREAKS?

    CLASS A - HARD DEPENDENCY
        The household loses internet. Requires a human to fix. This is a
        support call. There must be as close to zero of these as possible.

    CLASS B - SOFT DEPENDENCY
        The feature stops. Internet keeps working. Nobody phones anybody.
        This is where every function should live.

    CLASS C - NO DEPENDENCY
        Nothing outside the box is affected at all.

    SELF-HEALING vs PERMANENT
        A Class A fault that recovers on its own in minutes is survivable.
        A Class A fault that NEVER recovers without human action is the
        business-ending one. These are marked separately below - the
        distinction matters more than the class itself.


========================================================================================
PART 1 - CLASS A: HARD DEPENDENCIES (THE SUPPORT-CALL GENERATORS)
========================================================================================

----------------------------------------------------------------------------------------
A1. ROUTER HANDSHAKE                                     router_handshake.py (11 KB)
----------------------------------------------------------------------------------------
WHAT IT DOES
    During pairing, the app asks for the router's admin password. The box logs
    into the router, changes two settings - the LAN DNS server and the router's
    IPv6 DNS advertisement - verifies the change by re-reading it, then wipes
    the password from memory. Password is never written to disk or logged.
    Every change is recorded so it can be reversed on uninstall.

COMPLICATIONS - THIS IS THE ROOT CAUSE OF THE OUTAGE YOU HIT
    * The change is PERMANENT AND ONE-WAY. Once the router is pointed at the
      box, it stays pointed at the box - through power cuts, SD corruption,
      theft, and you unplugging it to test.
    * The reversal path lives IN THE BOX. Uninstall can put it back. A dead
      box cannot. The only thing that can undo the change is the one thing
      that is gone.
    * >>> THIS IS WHY A "RESET THE ROUTER AFTER 5-10 MINUTES" RULE CANNOT
      EXIST. The rule would have to run on the box (off) or on the router
      (not our firmware, no such TTL mechanism). There is no third machine.
      A graceful-shutdown hook can cover a planned power-off from the kiosk.
      It cannot cover unplugging, a crash, a power cut, or a dead SD card.
    * Unknown router models are refused rather than guessed at - correct, but
      it means an unknown router falls back to a guided manual flow, which is
      the support article you are trying not to have.
    * A router web UI that says "saved" and did not save has already cost you
      days of believing the cutover was live. Re-read verification is in place;
      it must never be removed.

MUST BE COMPENSATED FOR
    Change WHICH setting the handshake writes. Writing the router's UPSTREAM
    DNS (router keeps serving clients, forwards to us) instead of the LAN DHCP
    DNS option (clients point at us directly) moves the failure from
    catastrophic to cosmetic - because the fallback then lives in the router,
    which is always on.

----------------------------------------------------------------------------------------
A2. NETWORK CLAIM - "CLAIM" TIER                                    netclaim.py (22 KB)
----------------------------------------------------------------------------------------
WHAT IT DOES
    Three escalating tiers of how much of the network the box takes:
      HEAL  - changes only the box (suppress AAAA, rebind a socket, drop a
              rate limit). Invisible to other devices, instantly reversible.
      OFFER - adds a Router Advertisement naming the box as a DNS server.
              Additive, takes nothing away, safe to ignore.
      CLAIM - THE BOX ANSWERS ARP FOR THE ROUTER'S ADDRESS. Clients send it
              all their traffic and it forwards what it does not filter.
              Nothing on the router is touched.

COMPLICATIONS - THIS IS THE LARGEST BLAST RADIUS IN THE PRODUCT
    * CLAIM does not just take DNS. It takes the DEFAULT GATEWAY. If the box
      dies while claiming, clients do not lose name resolution - they lose
      ALL connectivity, to everything, immediately.
    * It is, however, SELF-HEALING. Clients hold the poisoned ARP entry only
      until their cache expires - typically 30 seconds to a few minutes, up
      to ~10 minutes on some Windows stacks - then re-ARP and the real router
      answers. Bad, loud, but it comes back without a human.
    * Every byte of household traffic now crosses the box. That is a
      throughput ceiling, a latency floor, and a single point of failure on
      hardware you do not control the thermals of.
    * The code already gates this on headroom, and correctly notes an Orange
      Pi Zero 2W has no wired uplink - routing a house through one Wi-Fi radio
      halves throughput and adds latency to every packet.
    * It also destroys the "side-car, never carries your traffic, cannot slow
      you down" performance guarantee that router_handshake.py is built on.
      CLAIM and that guarantee cannot both be true.

MUST BE COMPENSATED FOR
    RECOMMENDATION: CLAIM should not ship on the small device at all. It is a
    heavyweight-appliance capability. HEAL and OFFER are safe and should stay.

----------------------------------------------------------------------------------------
A3. PI-HOLE AS SOLE RESOLVER                    dns-stack/docker-compose.yml, pihole.py
----------------------------------------------------------------------------------------
WHAT IT DOES
    Pi-hole v6 in Docker, answering DNS on 127.0.0.1:53 and <LAN_IP>:53, with
    Unbound behind it for recursion. This is the actual product.

COMPLICATIONS
    * PERMANENT, NON-SELF-HEALING FAILURE. A client holds its DHCP lease for
      hours. When the box dies, that client keeps a dead resolver configured
      and will never look elsewhere. No timeout, no fallback, no recovery.
      Unlike ARP, DNS-by-DHCP does not expire its way back to health.
    * Secondary DNS is deliberately refused: clients query primary and
      secondary in arbitrary order, so a share of queries would bypass the
      filter and blocking would become intermittent and unexplainable. This
      reasoning is correct - and it is exactly what removes the safety net.
    * Phones suffer worse than desktops: DNS failure fails their captive-portal
      connectivity check, the OS marks the Wi-Fi as having no internet, and the
      handset drops to mobile data and remembers the network as bad.

MUST BE COMPENSATED FOR
    See PART 3. This is the decision.

----------------------------------------------------------------------------------------
A4. IPv6 AAAA SUPPRESSION (SELF-HEAL)             dns-watchdog.sh :: autoheal_ipv6()
----------------------------------------------------------------------------------------
WHAT IT DOES
    Detects a LAN that advertises IPv6 with NO IPv6 route to the internet, and
    injects "filter-AAAA" into dnsmasq so handsets stop attempting IPv6.
    Self-reversing: the line is removed the moment real IPv6 routing appears.
    Idempotent - the .env file is the state, so a 60s timer cannot thrash it.

COMPLICATIONS - THIS IS WHY PHONES SPECIFICALLY DIED
    * The box has become LOAD-BEARING FOR A ROUTER MISCONFIGURATION. Unplug it
      and you get TWO simultaneous failures, not one:
          (1) no resolver at all, and
          (2) broken IPv6 unmasked - phones resume stalling on every AAAA,
              fail connectivity validation, and drop the Wi-Fi.
    * This is precisely why the symptom looked so violent on handsets and will
      not reproduce cleanly on a laptop. Windows ranks ULA below IPv4 under
      RFC 6724 and is largely unaffected.
    * Masking a fault is not fixing it. The longer the mask holds, the more
      catastrophic its removal.

MUST BE COMPENSATED FOR
    The router's IPv6 must be fixed or disabled PERMANENTLY at install time -
    by the handshake, or by an instruction the owner completes once. The mask
    should be a stopgap that raises an alert, never a permanent silent crutch.

----------------------------------------------------------------------------------------
A5. PI-HOLE RATE LIMITING                                gateflame-netcheck.sh check 6
----------------------------------------------------------------------------------------
WHAT IT DOES
    Pi-hole FTL's per-source query rate limit. Must be set to 0.

COMPLICATIONS
    * When the router forwards, EVERY query in the household arrives from ONE
      source address. A normal home passes 1000/min easily. On trip, FTL
      REFUSES every further query from that address until the window rolls -
      the whole house loses DNS in repeating one-minute blocks, with nothing
      shown in any UI.
    * Looks exactly like an intermittent ISP fault. Undiagnosable by a customer.

MUST BE COMPENSATED FOR
    FTLCONF_dns_rateLimit_count=0 must be enforced by the installer and
    re-asserted on every stack recreate, not set once by hand.

----------------------------------------------------------------------------------------
A6. DUAL-HOMING ON ONE SUBNET                            gateflame-netcheck.sh check 1
----------------------------------------------------------------------------------------
WHAT IT DOES
    Not a feature - a deployment state. The box holds eth0 AND wlan0 addresses
    on the same /24 while port 53 is published on only one of them.

COMPLICATIONS
    * Linux answers ARP for an address out of whichever interface the request
      arrived on. A client can ask for LAN_IP and be handed the OTHER
      interface's MAC - so it reaches an address with no resolver behind it.
    * Intermittent, per-device, and hardest on phones, which re-ARP every time
      they sleep, wake, or roam.
    * avahi publishes BOTH addresses for gateflame.local, and the app's first
      discovery candidate is gateflame.local - so the app can pair happily on
      an address that serves the API but no DNS.

MUST BE COMPENSATED FOR
    The installer must refuse to complete while two addresses sit on one
    subnet, or bind port 53 to all of them. Currently detected only by a
    manual netcheck run.

----------------------------------------------------------------------------------------
A7. FIREWALL BOUNCE                                              firewall.py (20 KB)
----------------------------------------------------------------------------------------
WHAT IT DOES
    nftables set-based bouncer. Temporarily denies a misbehaving LAN host the
    ability to forward traffic through the node; the bounce expires by itself.
    Rewritten clean-room after a command-injection defect in the previous
    build: no shell ever, constant ruleset, set-elements only, re-emitted
    validation, deny-by-default on what may be bounced.

COMPLICATIONS
    * Only has meaning if traffic actually crosses the box - i.e. it depends on
      CLAIM (A2). As a pure side-car it bounces nothing.
    * Bouncing the wrong host is a self-inflicted outage on a device sold as
      the thing that keeps the network up.
    * Rules die with the box - which is the SAFE direction. Box off = nobody
      bounced.

MUST BE COMPENSATED FOR
    Ships disabled unless CLAIM is active. If CLAIM is dropped from the small
    device, this module goes with it.


========================================================================================
PART 2 - CLASS B: SOFT DEPENDENCIES (SAFE - FEATURE STOPS, INTERNET FINE)
========================================================================================

B1. THREAT LEVEL DIAL                                            threat_level.py
    Three positions - low (ads/trackers, the default), medium (+malware and
    phishing), high (+aggressive tracking, telemetry, shady TLDs). Selects
    which public blocklists are active. Lists are fetched by Pi-hole, never
    vendored, so their licences stay their problem.
    COMPLICATION: higher levels raise false positives. "high" will occasionally
    break a site. Low is the default because a box that breaks Netflix on day
    one gets returned. Blast radius on box-off: none.

B2. CONTENT CATEGORIES                                      content_categories.py
    Separate opt-in axis - adult, gambling, social, etc. ALL OFF by default,
    deliberately: a box that silently blocked legal content out of the carton
    would be making a moral decision for the owner and be indistinguishable
    from a fault. Kept out of the threat dial so nobody loses legal sites by
    sliding a security control.
    COMPLICATION: each category must state plainly what it breaks. "Social
    Media" that also kills WhatsApp is a support call. Blast radius: none.

B3. FILTERING PAUSE / RESUME                                  filtering_state.py
    Protection can be paused; short expiring durations by default, indefinite
    available as a separate deliberate choice that survives reboot. Every
    surface reports protection OFF while it lasts. Threat level and categories
    are remembered and restored on resume.
    COMPLICATION: the honest reason this exists - refusing to allow pause makes
    the box the prime suspect whenever anything misbehaves, and the customer's
    only remaining move is to UNPLUG IT, which is the Class A outage. Pause is
    a pressure-release valve that prevents a support call. Blast radius: none.

B4. BLOCKLIST APPLICATION / GRAVITY REBUILD                       blocklists.py
    Translates the three settings into Pi-hole config and rebuilds gravity on a
    background thread; routes return immediately with an "applying" flag.
    Pause pushes an EMPTY blocklist set rather than using Pi-hole's disable API,
    so there is ONE source of truth and the resolver never stops answering.
    COMPLICATION: rebuild is tens of seconds on a Pi, longer on Orange Pi Zero
    2W. Without the applying flag the customer taps twice and queues a second
    rebuild. Blast radius: none.

B5. DNS WATCHDOG                                                dns-watchdog.sh
    systemd timer, every 60s. Probes BOTH 127.0.0.1:53 and <LAN_IP>:53 with a
    hand-rolled UDP query (no dig/nslookup - neither Trixie nor Armbian ship
    them). Ladder: 1 fail = wait; 2 = compose restart; 3-4 = full recreate;
    5 = enter bypass.
    COMPLICATION: >>> IT ONLY COVERS SOFTWARE FAILURE WHILE THE BOX IS ALIVE.
    Every rung executes on the Pi. Power off the Pi and none of it runs. This
    is the "5 minute rule" and it did exactly what it was written to do - the
    misconception is about what it was ever able to cover.
    Blast radius: none (it IS the mitigation).

B6. BYPASS MODE                                    docker-compose.bypass.yml
    On 5 consecutive failures, tears the filtered stack down and brings up
    plain Unbound to Quad9/1.1.1.1 on the same port 53. Both cannot run at
    once, which structurally prevents queries leaking past the filter while
    healthy. Retries restoring filtering every 10 minutes, not every minute,
    because each attempt costs a short outage as port 53 changes hands.
    COMPLICATION: bypass STILL SERVES DNS FROM THE BOX. It is not "hand the
    network back to the router". A dead box cannot enter bypass.
    Note: a real bug was caught here - compose reads .env (mode 600, root) so
    a non-root leave_bypass() failed silently and would have left the house
    unfiltered forever. Fixed with explicit sudo -n. Recovery-path bugs stay
    invisible until the day they matter.

B7. NETWORK SHAPE CHECK                                  gateflame-netcheck.sh
    Read-only outward-looking diagnostic: addresses, both listeners, filtering,
    recursion, whether the router is ACTUALLY forwarding, IPv6 state, rate
    limit, bypass state, watchdog timer. --json for machine use.
    COMPLICATION: currently run by hand. Everything it catches is invisible
    until someone runs it. Blast radius: none.

B8. DEVICE PAIRING & SCOPES                              storage.py, security.py
    SQLite (WAL, one file, no ORM) holding node identity, paired devices, and
    expiring pairing codes. Scopes: control (any paired handset may START a
    module - restoring protection is what a remote is for) vs kiosk (required
    to STOP one, because a real stop tears down enforcement and must survive a
    stolen but still-paired phone). "provisioned" must never be un-set by
    revoking devices - that defect turned a lost phone into a node takeover in
    the previous build.
    COMPLICATION: revoke-all must not read as "never provisioned". Pinned by
    tests. Blast radius: none.

B9. CLIENT LIST                                                    clients.py
    Passive only. Reads the kernel neighbour table and dnsmasq/Pi-hole lease
    files for friendly names. Never probes, never sends anything. Empty list
    rather than fabricated entries where there is no neighbour table.
    COMPLICATION: incomplete by nature - a silent device may not appear.
    Under router-forwarding mode, per-client attribution in Pi-hole is lost
    entirely (all queries arrive from the router). Blast radius: none.

B10. THREAT LOG                                                    threats.py
    Recent blocked/flagged queries, read from Pi-hole's v6 REST API.
    COMPLICATION: was written against the v5 API and returned nothing on v6 -
    fixed in fecdfc5. Pi-hole v6 removed /admin/api.php entirely; sessions are
    limited and expire, so the sid is cached rather than re-authenticated on
    every 4-second poll. Blast radius: none.

B11. WAN AUDIT / DATA BUDGET                                    wan.py (41 KB)
    Monthly data accounting and link quality, updated every minute - the
    customer will trust this over their ISP's portal.
    COMPLICATION: interface byte counters are NOT monotonic - they reset on
    reboot and interface bounce, and wrap at 2^32 on a 32-bit kernel (4.29 GB,
    under six minutes on 100 Mbit). Naive subtraction produces phantom
    multi-gigabyte spikes. WAN interface cannot be guessed (eth0 may be LAN);
    unset means "degraded" with the env var named, never a guess. Months are
    HOST LOCAL CIVIL months, because ISPs reset caps at local midnight.
    Blast radius: none.

B12. SECURITY POSTURE AUDIT                                 posture.py (38 KB)
    Read-only host audit. NEVER changes the host - not sshd_config, not a file
    mode, not a unit file. Every finding carries a remedy the operator runs.
    Asserted at source level by tests so a future edit cannot add a write.
    A check that cannot reach its evidence yields a GAP, not a pass.
    COMPLICATION: sshd_config is FIRST-match-wins (opposite of most formats)
    and Include expands where it appears - Raspberry Pi OS ships an Include as
    line 1, so a drop-in beats the main file. Nested includes are not followed;
    a gap is emitted instead. Blast radius: none.

B13. FLOW OBSERVATION / DPI                                     dpi.py (16 KB)
    Headers only: TLS ClientHello SNI and HTTP/1.x Host. Never plaintext
    bodies, no termination, no proxy, no MITM, no certificate ever generated.
    Parses a bounded prefix, retains a hostname and a counter, discards frames.
    COMPLICATION: requires traffic to cross the box - depends on CLAIM (A2).
    Encrypted Client Hello will make SNI unreadable over time; reports null
    rather than reaching for a more invasive technique. A shrinking DPI number
    is the internet getting more private, not the product breaking. Blast
    radius: none (but ships dead without CLAIM).

B14. MODULE REGISTRY                                              services.py
    Every module declares what it needs (binary, capability, config) and checks
    at status time. Missing a requirement = degraded or not_implemented with a
    named gap and remedy - never a faked "running".
    COMPLICATION: honesty means the UI will show gaps on a fresh box. That is
    correct and must not be smoothed over. Blast radius: none.

B15. HOST TELEMETRY                                              telemetry.py
    CPU, memory, disk, temperature, throttle flags - from the OS, never a
    generator. Missing source = field omitted or degraded with a reason.
    COMPLICATION: needs vcgencmd access for throttle flags on a Pi (granted in
    commit 2f71d93). Blast radius: none.

B16. OUTBOUND HEALTH FEED                                      health_feed.py
    OFF by default (GATEFLAME_FEED_ENABLED). Batched, one POST per interval
    (15 min), fails silent. Health fields ONLY - domains, client IPs,
    hostnames, threat logs and DPI output are not imported into the module at
    all, so a future edit cannot accidentally wire one in.
    COMPLICATION: privacy posture must be documented for the customer before
    it is ever switched on. A feed outage must never touch protection - it
    doesn't. Blast radius: none.

B17. KIOSK CONSOLE                        src/components/kiosk/, install-kiosk.sh
    The on-device product surface. React/TS, ~372 KB bundle, hand-rolled SVG
    charts, no vendor motion/Recharts. LAN browsers without kiosk scope get a
    NotTheConsole screen rather than 401 errors on every action.
    COMPLICATION: kiosk authority must come from the SOCKET, not the URL path.
    Inferring scope from the URL made LAN browsers believe they had kiosk
    rights and then fail on every action. Fixed and pinned by tests. Trixie is
    Wayland - an Xwayland socket is not proof of X11. Blast radius: none.

B18. ANDROID COMPANION APP                                          Capacitor
    Remote control and status.
    COMPLICATION: cleartext policy could not match a node's IP, so no request
    left the phone (fixed cfccc48). Discovery order starts at gateflame.local,
    which under dual-homing can resolve to the address with no DNS behind it
    (see A6). Blast radius: none.


========================================================================================
PART 3 - CLASS C: NO EXTERNAL DEPENDENCY
========================================================================================

C1. ON-DEVICE DISPLAY - real on-device display, replaced the onboarding
    simulator. Purely local.
C2. LOCAL HISTORY - SQLite on the box.
C3. NODE IDENTITY / PROVISIONING - node ID, first-boot state.
C4. HEAL TIER of netclaim - changes only the box, invisible to other devices,
    instantly reversible, costs nothing. Always safe to run automatically.
C5. OFFER TIER of netclaim - additive Router Advertisement. Takes nothing away,
    impersonates nothing, cannot break a device that ignores it.


========================================================================================
PART 4 - WHAT ACTUALLY HAPPENS WHEN YOU UNPLUG THE BOX TODAY
========================================================================================

    T+0s     Box off. Router still points at it - router_handshake made that
             change permanent and only the box could undo it.
    T+0s     Every DNS query in the house goes to a dead address. Not refused -
             UNANSWERED. Clients wait for a full timeout on every lookup.
    T+0s     filter-AAAA mask is gone. Broken router IPv6 is live again.
    T+5-30s  Phones fail captive-portal validation. Wi-Fi marked "no internet".
             Handsets drop to mobile data and remember the network as bad.
    T+5min   The bypass rule does NOT fire. Nothing is running to fire it.
    T+hours  DHCP leases renew - and the router hands out the SAME dead
             resolver, because the router was never changed back.
    NEVER    No automatic recovery exists at any point on this timeline.

    A laptop shows one of these faults. A phone shows both at once. That is
    why the handsets looked catastrophic and a desktop looked merely broken.


========================================================================================
PART 5 - THE TRADE-OFF YOU CANNOT ENGINEER AROUND
========================================================================================

With ONE box on the network, these two cannot both be true:

    (i)  100% of queries are filtered, and
    (ii) the household keeps working automatically when the box dies.

Any automatic fallback is, by definition, a resolver that answers when we do
not - and a client that can reach it can reach it at other times too. That is
the exact objection already recorded in dns-watchdog.sh, and it is correct.

The four honest positions:

    OPTION 1 - STATUS QUO. 100% filtering. Box is a single point of failure.
        REJECTED by your own constraint: it is a 24/7 support line.

    OPTION 2 - ROUTER FORWARDS TO US, WITH ITS OWN FALLBACK UPSTREAM.
        Clients keep the ROUTER as their DNS. The router forwards to us.
        Box dies -> the router falls back on its own, instantly, with no rule
        and nothing to reset, because nothing was taken away from it.
        COST: a small leak rate. Most router resolvers learn the fastest
        upstream and use it, falling back only on failure - so the leak is
        small but not zero. Per-client attribution in Pi-hole is lost.
        VERDICT: this is the only option where "unplug it and nothing breaks"
        is structurally true rather than defended by a watchdog.

    OPTION 3 - HARDEN INSTEAD OF FAILING OVER. Keep 100% filtering, accept
        that a dead box is a dead network, and make that vanishingly rare:
        industrial SD/eMMC, brownout-tolerant PSU, read-only rootfs, plus a
        printed card in the box - "if the internet stops, unplug the white
        box and restart your router".
        VERDICT: still a support call, just a rarer one. Does not meet
        "no hassles".

    OPTION 4 - TWO DEVICES. The heavyweight 24/7 unit covers the small one.
        Solves it completely, does not apply to a household that bought one.

RECOMMENDATION
    Option 2, plus these four:
      1. DROP the CLAIM tier from the small device. Keep HEAL and OFFER.
         With CLAIM go firewall bounce (A7) and DPI (B13) - both are
         heavyweight-appliance features and neither can work side-car.
      2. Fix router IPv6 PERMANENTLY at install. Stop masking it (A4).
      3. Make gateflame-netcheck.sh run automatically and surface on the
         kiosk, not only when a human remembers to run it.
      4. Keep the watchdog and bypass. They correctly cover software failure
         while the box is alive - just stop expecting them to cover power-off.
         They never could.

NET EFFECT
    Class A count drops from SEVEN to ZERO.
    Every remaining function on the device becomes Class B or C.
    Unplugging the box costs the customer their filtering, and nothing else.


========================================================================================
OPEN ITEM
========================================================================================
    Not yet confirmed: whether the router currently hands clients the box
    directly (DHCP option 6) or forwards to it as an upstream. Check 4 of
    gateflame-netcheck.sh answers this in one run. It determines how much of
    Option 2 is a settings change versus a code change.

========================================================================================
END OF DOCUMENT - DOC-2026-08-002 v1.0
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Governance: Policy 986 AED | Anything is Possible with God.
========================================================================================
