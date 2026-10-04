// Gate^Flame T1 node - compile-time settings. Secrets are NOT here: the Wi-Fi network, the
// server address and the tokens live in NVS, written after flashing (gf-t1-prov/1 over serial,
// or the setup hotspot). pubkey.h is generated and is the only thing that makes a board ours.
// secrets.h is OPTIONAL and for lab convenience only: if present, its values are the defaults
// used while NVS is empty (see GF_T1_Node.ino, loadSettings()).
#pragma once

#define FW_VERSION          "0.2.0"
#define FW_PRODUCT          "GateFlame-T1"

#define DNS_PORT            53
#define PENDING_SLOTS       96       // in-flight upstream queries
#define UPSTREAM_RESEND_MS  1200     // no answer from upstream 1 -> ask upstream 2
#define UPSTREAM_GIVEUP_MS  3000     // then SERVFAIL, so the router uses its own upstream
#define DEGRADED_AFTER_MS   15000    // upstream silent this long while queries wait -> degraded

#define TELEMETRY_MS        30000
#define UPDATE_CHECK_MS     (6UL * 3600UL * 1000UL)
#define REDISCOVER_AFTER    5        // failed reports before looking for the server again

// Default upstream resolvers. NEVER the router: the router forwards to us, so
// forwarding back to it would loop. Quad9 also blocks malware on its side.
#define DEFAULT_UPSTREAM_1  "9.9.9.9"
#define DEFAULT_UPSTREAM_2  "149.112.112.112"

#define ALLOW_MAX           4096
#define NET_TASK_STACK      16384

#ifndef T1_DEFAULT_LEVEL
#define T1_DEFAULT_LEVEL    "low"
#endif

// ── response cache (PSRAM) ───────────────────────────────────────────────────────────
#define CACHE_ENTRIES       1024     // ~550 KB; 2-way, see gf_cache.h

// ── DNS over TCP (RFC 7766) ──────────────────────────────────────────────────────────
#define TCP_TASK_STACK      8192
#define TCP_SESSION_MS      8000     // one client may hold the single TCP worker this long
#define TCP_MAX_QUERIES     8        // ... and send this many queries
#define TCP_UPSTREAM_MS     2500

// ── setup hotspot ────────────────────────────────────────────────────────────────────
#define PORTAL_FALLBACK_MS  (3UL * 60UL * 1000UL)    // provisioned, but no Wi-Fi this long -> offer the hotspot
#define PORTAL_WINDOW_MS    (10UL * 60UL * 1000UL)   // ... for this long
#define RESET_HOLD_MS       10000                    // BOOT held this long while running = factory reset

// ── signed OTA ───────────────────────────────────────────────────────────────────────
#define OTA_VALIDATE_MS     (10UL * 60UL * 1000UL)   // a new image must prove itself within this, or roll back
#define OTA_RETRY_MS        (60UL * 60UL * 1000UL)   // after a failed update, wait this long before retrying
#define OTA_MIN_BYTES       65536
#define OTA_MIN_HEAP        60000
