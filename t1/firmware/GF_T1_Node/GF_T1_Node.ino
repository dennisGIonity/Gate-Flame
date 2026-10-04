// ========================================================================================
// GATE^FLAME T1 - ESP32-S3 DNS filter node  (Standard T1, docs/TIERING-PLAN.md)
// Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
// (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
// Governance: Policy 986 AED
// ========================================================================================
//
// WHAT IT IS
//   A side-car DNS filter, same authority model as Standard T3 (ADR-001): the ROUTER uses
//   this box as its upstream DNS; household devices are never pointed at it. If this box
//   loses power, the router falls back on its own. Nothing here is in the data path.
//
//   T1 CONNECTS AND REPORTS. Lists, the dashboard, alerts, the MCP tools, firmware updates
//   and support all live on the Ionity server. The box has no screen and no app of its own.
//
// HOW IT FILTERS
//   A Bloom filter of the level's blocklists (~5.5 MB for 3.08 M domains at 0.1 % false
//   positives) lives in PSRAM. The T1 server builds and SIGNS it; this box verifies the
//   ECDSA P-256 signature against the public key compiled in (pubkey.h) before using it,
//   keeps a copy in FFat so a power cut does not need the server, and re-verifies that
//   copy on every boot. Blocked: A -> 0.0.0.0, AAAA -> ::, like Pi-hole on T3.
//   Allowed answers are cached in PSRAM (gf_cache.h). UDP and TCP (RFC 7766) are both served.
//
// ONE IMAGE, PROVISIONED AFTERWARDS  (docs/T1-BLUEPRINT.md patterns 1-3)
//   No Wi-Fi password, server address or token is compiled in. They live in NVS and are
//   written after flashing, by whichever of these is to hand:
//     - serial, protocol "gf-t1-prov/1": one flat JSON object per line in, one line out
//       prefixed "GF-T1-PROV " (hello / get / set / scan / test / reboot / factory_reset);
//     - the setup hotspot "GateFlame-T1-XXXX" (WPA2; the password is on the label and in
//       `hello`), which opens by itself on a board that has no Wi-Fi settings, and offers
//       itself again if a provisioned board cannot join its network for 3 minutes.
//   The device id comes from the eFuse MAC. The per-device token is issued by the server at
//   enrolment (the enrolment token is typed in once and erased on success).
//
// SIGNED OTA, WITH ROLLBACK  (pattern 5)
//   The server offers a firmware image to a board only inside a staged rollout. The board
//   streams it into the idle app slot, checks SHA-256 AND the ECDSA signature BEFORE it
//   finalises the slot, reboots into it, and has OTA_VALIDATE_MS to reach the server, load
//   its filter and keep answering DNS. Otherwise - or on any crash - the bootloader returns
//   to the previous image by itself.
//
// STATUS - the same five values as the T3 box's protectionStatus
//   active    filtering
//   paused    owner paused it (not persisted: a reboot resumes protection)
//   bypass    no valid filter - forwarding UNFILTERED so the household stays online
//   degraded  upstream resolvers are not answering
//   applying  a new filter is being loaded (forwarding unfiltered for ~1-2 s)
//
// PRIVACY: telemetry carries COUNTERS only. No domain name ever leaves this box.
//
// Board: ESP32-S3 N16R8 (16 MB flash, 8 MB octal PSRAM). FQBN:
//   esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB
//   (two 3 MB app slots + otadata: that partition scheme is what makes OTA possible)
// ========================================================================================

#include <WiFi.h>
#include <WiFiUdp.h>
#include <WiFiServer.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <FFat.h>
#include <Update.h>
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "mbedtls/sha256.h"
#include "mbedtls/pk.h"

#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"            // lab convenience only: defaults while NVS is empty
#endif
#include "pubkey.h"
#include "gf_bloom.h"
#include "gf_dns.h"
#include "gf_json.h"
#include "gf_cache.h"

// ── shared state (DNS loop on core 1, network + TCP tasks on core 0) ─────────────────
static SemaphoreHandle_t filterMux;
static uint8_t *filterBuf = nullptr;      // whole file image in PSRAM
static size_t filterLen = 0;
static gf_bloom_t bloomF;
static volatile bool filterOk = false;
static uint64_t *allowKeys = nullptr;
static size_t allowCount = 0;
static uint32_t filterVersion = 0, allowVersion = 0;

static volatile uint32_t pausedUntil = 0;           // millis(); 0 = not paused
static volatile bool applying = false;
static volatile uint32_t lastUpstreamOk = 0, lastForwardAt = 0;
static char lastErr[96] = "";

static IPAddress up1, up2;
static String level = T1_DEFAULT_LEVEL;
static String serverUrl;
static String deviceId, bootId;
static Preferences prefs;

// Settings, from NVS (see loadSettings). Secrets are never printed, logged or echoed.
static String cfgSsid, cfgPass, cfgServer, cfgEnrol, cfgToken, cfgLabel, cfgSip, cfgSgw, cfgSsn;
static String apSsid, apPass;                        // the setup hotspot; apPass is derived from the id

// Written only by the DNS loop (core 1); the net task just reads them. Aligned 32-bit
// reads are atomic on the S3, so no lock and no volatile ++ needed.
static uint32_t cQueries = 0, cBlocked = 0, cForwarded = 0, cAllowed = 0, cTimeouts = 0, cBad = 0, cUnfiltered = 0;
static uint32_t cCacheHit = 0, cCaptive = 0;
// Written by the TCP task (core 0): atomic.
static uint32_t cTcpQ = 0, cTcpBlk = 0, cTcpFwd = 0, cTcpErr = 0;
#define BUMP(x) __atomic_add_fetch(&(x), 1, __ATOMIC_RELAXED)

static uint32_t lastCmdId = 0;
static bool lastCmdOk = false;
static char lastCmdMsg[96] = "";
static volatile bool forceUpdate = true;              // check once at boot
static volatile uint32_t identifyUntil = 0;
static volatile uint32_t loopBeat = 0;                // the DNS loop is alive: proof for OTA validation
static volatile bool provBusy = false;                // serial scan/test is using Wi-Fi: the net task waits
static volatile uint32_t rebootAt = 0;                // millis(); 0 = none

static gf_cache_t cache;                              // UDP answers only; touched by core 1 alone
static char lastEnrolWhy[64] = "";
static char lastOta[96] = "";
static String otaFailedVersion;
static uint32_t otaFailedAt = 0;
static bool tokenIsLegacy = false;

// A new image that has not yet proved itself must not be kept by accident: this override makes the
// Arduino core leave the image "pending verify" at boot, so the bootloader rolls back if we never
// call esp_ota_mark_app_valid_cancel_rollback() (see validateImage()). C linkage: it replaces a weak C symbol.
extern "C" bool verifyRollbackLater() { return true; }

// ── helpers ──────────────────────────────────────────────────────────────────────────
static void sha256Fn(const uint8_t *d, size_t n, uint8_t out[32]) { mbedtls_sha256(d, n, out, 0); }

static int hexVal(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
static size_t unhex(const String &h, uint8_t *out, size_t cap) {
  size_t n = h.length() / 2;
  if (n > cap) return 0;
  for (size_t i = 0; i < n; i++) {
    int a = hexVal(h[2 * i]), b = hexVal(h[2 * i + 1]);
    if (a < 0 || b < 0) return 0;
    out[i] = (uint8_t)(a << 4 | b);
  }
  return n;
}
static String tohex(const uint8_t *p, size_t n) {
  static const char *H = "0123456789abcdef";
  String s; s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s += H[p[i] >> 4]; s += H[p[i] & 15]; }
  return s;
}

// Verify an ECDSA P-256 DER signature (hex) over a SHA-256 digest with the compiled-in key.
static bool verifySig(const uint8_t digest[32], const String &sigHex) {
  uint8_t sig[80];
  size_t sl = unhex(sigHex, sig, sizeof sig);
  if (!sl) return false;
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  bool ok = mbedtls_pk_parse_public_key(&pk, (const unsigned char *)T1_PUBKEY_PEM, strlen(T1_PUBKEY_PEM) + 1) == 0
            && mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, digest, 32, sig, sl) == 0;
  mbedtls_pk_free(&pk);
  return ok;
}

static bool hashFile(const char *path, uint8_t out[32], size_t *len) {
  File f = FFat.open(path, "r");
  if (!f) return false;
  mbedtls_sha256_context c; mbedtls_sha256_init(&c); mbedtls_sha256_starts(&c, 0);
  static uint8_t buf[4096];
  size_t total = 0; int r;
  while ((r = f.read(buf, sizeof buf)) > 0) { mbedtls_sha256_update(&c, buf, r); total += r; }
  mbedtls_sha256_finish(&c, out); mbedtls_sha256_free(&c);
  f.close();
  *len = total;
  return true;
}

static String readSmall(const char *path) {
  File f = FFat.open(path, "r");
  if (!f) return "";
  String s = f.readString(); f.close(); s.trim();
  return s;
}
static void writeSmall(const char *path, const String &v) { File f = FFat.open(path, "w"); if (f) { f.print(v); f.close(); } }

static void setErr(const char *e) { strlcpy(lastErr, e, sizeof lastErr); Serial.printf("[t1] %s\n", e); }

// ── LED ──────────────────────────────────────────────────────────────────────────────
static void led(uint8_t r, uint8_t g, uint8_t b) {
#ifdef RGB_BUILTIN
  rgbLedWrite(RGB_BUILTIN, r, g, b);
#endif
}

static const char *statusStr() {
  if (applying) return "applying";
  if (pausedUntil && (int32_t)(pausedUntil - millis()) > 0) return "paused";
  if (!filterOk) return "bypass";
  // Degraded only if queries were sent AFTER the last answer and the silence is long -
  // a quiet house at 3 a.m. is not a failing upstream.
  if ((int32_t)(lastForwardAt - lastUpstreamOk) > 0 && millis() - lastUpstreamOk > DEGRADED_AFTER_MS) return "degraded";
  return "active";
}

// ── settings (NVS) ───────────────────────────────────────────────────────────────────
static bool validIp(const String &s) { IPAddress a; return s.length() > 0 && a.fromString(s); }
static bool validLevel(const String &s) { return s == "low" || s == "medium" || s == "high"; }
static bool printable(const String &s) { for (size_t i = 0; i < s.length(); i++) if ((uint8_t)s[i] < 0x20 || (uint8_t)s[i] == 0x7F) return false; return true; }
static bool validSsid(const String &s) { return s.length() >= 1 && s.length() <= 32; }
static bool validPass(const String &s) { return s.length() == 0 || (s.length() >= 8 && s.length() <= 63); }   // WPA2 passphrase, or an open network
static bool validServer(const String &s) { return s.length() == 0 || (s.startsWith("http://") && s.length() <= 96 && printable(s) && s.indexOf(' ') < 0); }
static bool validEnrol(const String &s) { return s.length() == 0 || (s.length() >= 8 && s.length() <= 64 && printable(s) && s.indexOf(' ') < 0); }
static bool validLabel(const String &s) { return s.length() <= 40 && printable(s); }

static void loadSettings() {
  cfgSsid = prefs.getString("ssid", "");   cfgPass = prefs.getString("pass", "");
  cfgServer = prefs.getString("server", ""); cfgEnrol = prefs.getString("enrol", "");
  cfgToken = prefs.getString("token", ""); cfgLabel = prefs.getString("label", "");
  cfgSip = prefs.getString("sip", "");     cfgSgw = prefs.getString("sgw", ""); cfgSsn = prefs.getString("ssn", "");
  level = prefs.getString("level", T1_DEFAULT_LEVEL);
  if (!validLevel(level)) level = T1_DEFAULT_LEVEL;
  // Lab convenience: values from an optional secrets.h apply ONLY while NVS has nothing.
#ifdef WIFI_SSID
  if (cfgSsid.isEmpty()) { cfgSsid = WIFI_SSID; cfgPass = WIFI_PASS; }
#endif
#ifdef T1_SERVER_FALLBACK
  if (cfgServer.isEmpty()) cfgServer = T1_SERVER_FALLBACK;
#endif
#ifdef T1_STATIC_IP
  if (cfgSip.isEmpty()) { cfgSip = T1_STATIC_IP; cfgSgw = T1_GATEWAY; cfgSsn = T1_SUBNET; }
#endif
#ifdef T1_DEVICE_TOKEN
  // The 0.1 shared fleet token: honoured only if the server was started with T1_LEGACY_TOKEN=1.
  if (cfgToken.isEmpty() && cfgEnrol.isEmpty()) { cfgToken = T1_DEVICE_TOKEN; tokenIsLegacy = true; }
#endif
}

static bool provisioned() { return cfgSsid.length() > 0; }
static bool enrolled() { return cfgToken.length() > 0; }

// ── HTTP to the T1 server ────────────────────────────────────────────────────────────
static bool httpBegin(HTTPClient &h, const String &path) {
  if (serverUrl.isEmpty() || !h.begin(serverUrl + path)) return false;
  h.addHeader("X-T1-Id", deviceId);
  if (cfgToken.length()) h.addHeader("X-T1-Token", cfgToken);
  h.setTimeout(15000);
  return true;
}

static void discoverServer() {
  // Fixed order, the same on every box: the address pinned in NVS, then mDNS (_gft1._tcp).
  // A lab build may also carry a compile-time fallback (secrets.h) - it arrives as the pinned one.
  if (cfgServer.length()) {
    serverUrl = cfgServer;
    Serial.printf("[t1] server pinned: %s\n", serverUrl.c_str());
    return;
  }
  int n = MDNS.queryService("gft1", "tcp");
  if (n > 0) {
    serverUrl = "http://" + MDNS.address(0).toString() + ":" + String(MDNS.port(0));
    Serial.printf("[t1] server via mDNS: %s\n", serverUrl.c_str());
  } else {
    serverUrl = "";
    setErr("no server: none pinned and mDNS found no _gft1._tcp");
  }
}

// ── enrolment: trade the enrolment token for a token of this board's own ─────────────
static bool ensureToken() {
  if (enrolled()) return true;
  if (cfgEnrol.isEmpty()) { strlcpy(lastEnrolWhy, "no_enrolment_token", sizeof lastEnrolWhy); setErr("not enrolled: no token and no enrolment token (provision one)"); return false; }
  if (serverUrl.isEmpty()) { strlcpy(lastEnrolWhy, "no_server", sizeof lastEnrolWhy); return false; }
  HTTPClient h;
  if (!h.begin(serverUrl + "/api/t1/v1/enrol")) return false;
  h.addHeader("X-T1-Enrol", cfgEnrol);
  h.addHeader("Content-Type", "application/json");
  h.setTimeout(15000);
  String body = "{\"id\":\"" + deviceId + "\"}";
  int code = h.POST((uint8_t *)body.c_str(), body.length());
  String resp = code > 0 ? h.getString() : "";
  h.end();
  if (code == 200) {
    gf_json_obj o;
    const char *t = gf_json_parse(resp.c_str(), resp.length(), &o) == 0 ? gf_json_str(&o, "token") : nullptr;
    if (!t || strlen(t) < 16) { strlcpy(lastEnrolWhy, "bad_reply", sizeof lastEnrolWhy); setErr("enrolment reply had no token"); return false; }
    cfgToken = t;
    prefs.putString("token", cfgToken);
    prefs.remove("enrol"); cfgEnrol = "";                // the enrolment token has done its one job
    strlcpy(lastEnrolWhy, "", sizeof lastEnrolWhy);
    lastErr[0] = 0;
    Serial.println("[t1] enrolled: this board has its own token");
    return true;
  }
  if (code == 409) { strlcpy(lastEnrolWhy, "already_enrolled_or_revoked", sizeof lastEnrolWhy); setErr("enrolment refused: the server already knows this board - ask the administrator to reset its token"); }
  else if (code == 401) { strlcpy(lastEnrolWhy, "enrolment_token_refused", sizeof lastEnrolWhy); setErr("enrolment token refused by the server"); }
  else if (code == 429) { strlcpy(lastEnrolWhy, "rate_limited", sizeof lastEnrolWhy); setErr("enrolment rate-limited; will retry"); }
  else if (code <= 0) { strlcpy(lastEnrolWhy, "server_unreachable", sizeof lastEnrolWhy); setErr("enrolment: server unreachable"); }
  else { snprintf(lastEnrolWhy, sizeof lastEnrolWhy, "http_%d", code); setErr("enrolment failed"); }
  return false;
}

// ── filter + allow-list loading (from FFat, re-verified every time) ──────────────────
static bool loadFilterFromFlash() {
  uint8_t dg[32]; size_t len = 0;
  if (!FFat.exists("/filter.bin")) { setErr("no filter on flash yet"); return false; }
  if (!hashFile("/filter.bin", dg, &len)) { setErr("cannot read /filter.bin"); return false; }
  if (!verifySig(dg, readSmall("/filter.sig"))) { setErr("filter signature INVALID - refusing it"); return false; }
  size_t freePs = heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM);
  bool haveBoth = freePs > len + 65536;                 // load beside the old one, then swap
  uint8_t *nb = nullptr;
  if (!haveBoth) {                                      // no room for two: drop the old one first
    applying = true;
    xSemaphoreTake(filterMux, portMAX_DELAY);
    filterOk = false; free(filterBuf); filterBuf = nullptr; filterLen = 0;
    xSemaphoreGive(filterMux);
    freePs = heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM);
  }
  if (freePs < len) {
    char e[96]; snprintf(e, sizeof e, "filter %u KB > free PSRAM %u KB", (unsigned)(len / 1024), (unsigned)(freePs / 1024));
    setErr(e); applying = false; return false;
  }
  nb = (uint8_t *)heap_caps_malloc(len, MALLOC_CAP_SPIRAM);
  if (!nb) { setErr("PSRAM allocation failed"); applying = false; return false; }
  File f = FFat.open("/filter.bin", "r");
  size_t got = f.read(nb, len); f.close();
  gf_bloom_t nbf;
  if (got != len || gf_bloom_open(&nbf, nb, len) != 0) { free(nb); setErr("filter file corrupt"); applying = false; return false; }
  applying = true;
  xSemaphoreTake(filterMux, portMAX_DELAY);
  uint8_t *old = filterBuf;
  filterBuf = nb; filterLen = len; bloomF = nbf; filterVersion = nbf.version; filterOk = true;
  xSemaphoreGive(filterMux);
  free(old);
  applying = false;
  lastErr[0] = 0;
  Serial.printf("[t1] filter %s v%u: %u domains, %u KB, k=%u\n", nbf.level, (unsigned)nbf.version,
                (unsigned)nbf.n, (unsigned)(len / 1024), nbf.k);
  return true;
}

static int cmpU64(const void *a, const void *b) {
  uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
  return x < y ? -1 : x > y ? 1 : 0;
}

static bool loadAllowFromFlash() {
  uint8_t dg[32]; size_t len = 0;
  if (!FFat.exists("/allow.txt")) return true;          // an empty allow-list is fine
  if (!hashFile("/allow.txt", dg, &len) || !verifySig(dg, readSmall("/allow.sig"))) { setErr("allow-list signature INVALID"); return false; }
  size_t cap = ALLOW_MAX, n = 0;
  uint64_t *keys = (uint64_t *)heap_caps_malloc(cap * sizeof(uint64_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!keys) { cap = 256; keys = (uint64_t *)malloc(cap * sizeof(uint64_t)); }
  if (!keys) { setErr("no memory for the allow-list"); return false; }
  File f = FFat.open("/allow.txt", "r");
  while (f.available() && n < cap) {
    String line = f.readStringUntil('\n'); line.trim();
    char norm[GF_DOMAIN_MAX + 1];
    int l = gf_normalise(line.c_str(), line.length(), norm);
    if (l <= 0) continue;
    uint64_t h1, h2; gf_domain_hash(sha256Fn, norm, l, &h1, &h2);
    keys[n++] = h1;
  }
  f.close();
  qsort(keys, n, sizeof(uint64_t), cmpU64);
  xSemaphoreTake(filterMux, portMAX_DELAY);
  uint64_t *old = allowKeys; allowKeys = keys; allowCount = n;
  xSemaphoreGive(filterMux);
  free(old);
  allowVersion = (uint32_t)readSmall("/allow.ver").toInt();
  Serial.printf("[t1] allow-list: %u entries\n", (unsigned)n);
  return true;
}

// Stream a file to FFat, hashing as it goes; keep it only if hash AND signature match.
static bool download(const String &path, const char *dst, size_t size, const String &sha, const String &sig) {
  HTTPClient h;
  if (!httpBegin(h, path)) return false;
  int code = h.GET();
  if (code != 200) { h.end(); char e[64]; snprintf(e, sizeof e, "download HTTP %d", code); setErr(e); return false; }
  WiFiClient *s = h.getStreamPtr();
  File f = FFat.open("/dl.tmp", "w");
  if (!f) { h.end(); setErr("FFat write failed"); return false; }
  mbedtls_sha256_context c; mbedtls_sha256_init(&c); mbedtls_sha256_starts(&c, 0);
  static uint8_t buf[4096];
  size_t got = 0; uint32_t idle = millis();
  while (got < size && millis() - idle < 20000) {
    size_t av = s->available();
    if (!av) { if (!h.connected()) break; delay(2); continue; }
    int r = s->read(buf, min(av, sizeof buf));
    if (r <= 0) continue;
    mbedtls_sha256_update(&c, buf, r);
    f.write(buf, r); got += r; idle = millis();
  }
  uint8_t dg[32]; mbedtls_sha256_finish(&c, dg); mbedtls_sha256_free(&c);
  f.close(); h.end();
  if (got != size) { FFat.remove("/dl.tmp"); setErr("download truncated"); return false; }
  if (tohex(dg, 32) != sha || !verifySig(dg, sig)) { FFat.remove("/dl.tmp"); setErr("downloaded file failed signature check"); return false; }
  String sigPath = String(dst); sigPath.replace(".bin", ".sig"); sigPath.replace(".txt", ".sig");
  FFat.remove(dst);
  if (!FFat.rename("/dl.tmp", dst)) { setErr("rename failed"); return false; }
  writeSmall(sigPath.c_str(), sig);
  return true;
}

// ── signed OTA ───────────────────────────────────────────────────────────────────────
// Streams the image into the IDLE app slot, hashing as it goes. The slot is finalised
// (Update.end) only after the SHA-256 matches the manifest and the ECDSA signature verifies
// against the compiled-in key - until then the running image is untouched and so is the boot
// choice. A power cut anywhere in here leaves the board on the old firmware.
static bool otaApply(const String &version, const String &path, size_t size, const String &sha, const String &sig) {
  if (!enrolled()) { strlcpy(lastOta, "refused: board is not enrolled", sizeof lastOta); return false; }
  if (applying) return false;
  if (size < OTA_MIN_BYTES) { strlcpy(lastOta, "refused: image size implausible", sizeof lastOta); return false; }
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  if (!next || size > next->size) { strlcpy(lastOta, "refused: no idle app slot large enough", sizeof lastOta); return false; }
  if (ESP.getFreeHeap() < OTA_MIN_HEAP) { strlcpy(lastOta, "deferred: low memory", sizeof lastOta); return false; }
  HTTPClient h;
  if (!httpBegin(h, path)) return false;
  int code = h.GET();
  if (code != 200) { h.end(); snprintf(lastOta, sizeof lastOta, "download HTTP %d", code); return false; }
  WiFiClient *s = h.getStreamPtr();
  if (!Update.begin(size, U_FLASH)) { h.end(); snprintf(lastOta, sizeof lastOta, "Update.begin failed (%u)", (unsigned)Update.getError()); return false; }
  mbedtls_sha256_context c; mbedtls_sha256_init(&c); mbedtls_sha256_starts(&c, 0);
  static uint8_t buf[4096];
  size_t got = 0; uint32_t idle = millis(); bool fail = false;
  while (got < size && millis() - idle < 20000) {
    size_t av = s->available();
    if (!av) { if (!h.connected()) break; delay(2); continue; }
    int r = s->read(buf, min(min(av, sizeof buf), size - got));
    if (r <= 0) continue;
    if (Update.write(buf, r) != (size_t)r) { fail = true; break; }
    mbedtls_sha256_update(&c, buf, r);
    got += r; idle = millis();
  }
  uint8_t dg[32]; mbedtls_sha256_finish(&c, dg); mbedtls_sha256_free(&c);
  h.end();
  if (fail) { Update.abort(); strlcpy(lastOta, "flash write failed", sizeof lastOta); return false; }
  if (got != size) { Update.abort(); strlcpy(lastOta, "download truncated", sizeof lastOta); return false; }
  if (tohex(dg, 32) != sha) { Update.abort(); strlcpy(lastOta, "REFUSED: SHA-256 does not match the manifest", sizeof lastOta); return false; }
  if (!verifySig(dg, sig)) { Update.abort(); strlcpy(lastOta, "REFUSED: firmware signature INVALID", sizeof lastOta); return false; }
  if (!Update.end(false) || !Update.isFinished()) { snprintf(lastOta, sizeof lastOta, "finalise failed (%u)", (unsigned)Update.getError()); return false; }
  prefs.putString("ota_from", FW_VERSION);
  prefs.putString("ota_to", version);
  snprintf(lastOta, sizeof lastOta, "installed %s; rebooting to prove it", version.c_str());
  Serial.printf("[t1] OTA: %s installed, rebooting\n", version.c_str());
  rebootAt = millis() + 2500; if (!rebootAt) rebootAt = 1;
  return true;
}

// A freshly installed image stays "pending verify" until it has proved itself: Wi-Fi up, the
// server answered with our own token, a filter is loaded and the DNS loop is turning. Then it is
// made permanent. If that has not happened by OTA_VALIDATE_MS, go back.
static bool imagePending() {
  const esp_partition_t *run = esp_ota_get_running_partition();
  esp_ota_img_states_t st;
  return run && esp_ota_get_state_partition(run, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY;
}

static void validateImage(bool serverAnswered) {
  static uint32_t beatThen = 0;
  if (!imagePending()) return;
  bool dnsAlive = loopBeat != beatThen;
  beatThen = loopBeat;
  if (serverAnswered && filterOk && dnsAlive && WiFi.status() == WL_CONNECTED) {
    esp_ota_mark_app_valid_cancel_rollback();
    String from = prefs.getString("ota_from", ""), to = prefs.getString("ota_to", "");
    snprintf(lastOta, sizeof lastOta, "%s -> %s: healthy, now permanent", from.c_str(), to.c_str());
    prefs.remove("ota_from"); prefs.remove("ota_to");
    Serial.printf("[t1] %s\n", lastOta);
    return;
  }
  if (millis() > OTA_VALIDATE_MS) {
    Serial.println("[t1] new image did not prove itself in time: rolling back");
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }
}

static bool checkForUpdate() {
  HTTPClient h;
  if (!httpBegin(h, "/api/t1/v1/manifest.txt?level=" + level + "&fw=" FW_VERSION)) return false;
  int code = h.GET();
  if (code != 200) { h.end(); char e[64]; snprintf(e, sizeof e, "manifest HTTP %d", code); setErr(e); return false; }
  String body = h.getString(); h.end();
  auto val = [&](const char *k) -> String {
    String key = String(k) + "="; int i = body.indexOf(key); if (i < 0) return "";
    if (i > 0 && body[i - 1] != '\n') return "";
    int e = body.indexOf('\n', i); return body.substring(i + key.length(), e < 0 ? body.length() : e);
  };
  bool ok = true;
  uint32_t fv = (uint32_t)val("filter_version").toInt();
  String curLevel = readSmall("/filter.lvl");
  if (fv && (fv != filterVersion || curLevel != level || !filterOk)) {
    Serial.printf("[t1] new filter v%u (%s)\n", (unsigned)fv, level.c_str());
    if (download(val("filter_url"), "/filter.bin", val("filter_size").toInt(), val("filter_sha256"), val("filter_sig"))) {
      writeSmall("/filter.lvl", level);
      ok = loadFilterFromFlash() && ok;
    } else ok = false;
  } else if (!fv) { setErr("server has no filter built for this level yet"); ok = false; }
  uint32_t av = (uint32_t)val("allow_version").toInt();
  if (av && av != allowVersion) {
    if (download(val("allow_url"), "/allow.txt", val("allow_size").toInt(), val("allow_sha256"), val("allow_sig"))) {
      writeSmall("/allow.ver", String(av));
      ok = loadAllowFromFlash() && ok;
    } else ok = false;
  }
  // Firmware: only inside a rollout the server has put this board in, and never twice in a row
  // for a version that just failed. The filter and allow-list above are always handled first.
  String fwv = val("fw_version");
  if (fwv.length() && fwv != FW_VERSION && !(fwv == otaFailedVersion && millis() - otaFailedAt < OTA_RETRY_MS)) {
    if (!otaApply(fwv, val("fw_url"), (size_t)val("fw_size").toInt(), val("fw_sha256"), val("fw_sig"))) {
      otaFailedVersion = fwv; otaFailedAt = millis(); ok = false;
      Serial.printf("[t1] OTA %s: %s\n", fwv.c_str(), lastOta);
    }
  }
  return ok;
}

static void runCommand(uint32_t id, const String &cmd, const String &arg) {
  lastCmdId = id; lastCmdOk = true;
  if (cmd == "pause") {
    uint32_t m = arg.toInt(); if (m < 1 || m > 1440) m = 30;
    pausedUntil = millis() + m * 60000UL; if (!pausedUntil) pausedUntil = 1;
    snprintf(lastCmdMsg, sizeof lastCmdMsg, "paused %u min", (unsigned)m);
  } else if (cmd == "resume") {
    pausedUntil = 0; strlcpy(lastCmdMsg, "resumed", sizeof lastCmdMsg);
  } else if (cmd == "update") {
    lastCmdOk = checkForUpdate();
    if (lastCmdOk) snprintf(lastCmdMsg, sizeof lastCmdMsg, "filter v%u", (unsigned)filterVersion);
    else snprintf(lastCmdMsg, sizeof lastCmdMsg, "update failed: %s", lastErr);
  } else if (cmd == "set_level") {
    if (validLevel(arg)) {
      level = arg; prefs.putString("level", level);
      lastCmdOk = checkForUpdate();
      snprintf(lastCmdMsg, sizeof lastCmdMsg, lastCmdOk ? "level %s" : "level %s, update failed", level.c_str());
    } else { lastCmdOk = false; strlcpy(lastCmdMsg, "bad level", sizeof lastCmdMsg); }
  } else if (cmd == "set_upstream") {
    int c = arg.indexOf(',');
    IPAddress a, b;
    if (a.fromString(c < 0 ? arg : arg.substring(0, c))) {
      up1 = a; prefs.putString("up1", up1.toString());
      if (c >= 0 && b.fromString(arg.substring(c + 1))) { up2 = b; prefs.putString("up2", up2.toString()); }
      snprintf(lastCmdMsg, sizeof lastCmdMsg, "upstream %s,%s", up1.toString().c_str(), up2.toString().c_str());
    } else { lastCmdOk = false; strlcpy(lastCmdMsg, "bad address", sizeof lastCmdMsg); }
  } else if (cmd == "identify") {
    identifyUntil = millis() + 10000; strlcpy(lastCmdMsg, "blinking 10 s", sizeof lastCmdMsg);
  } else if (cmd == "reboot") {
    strlcpy(lastCmdMsg, "rebooting", sizeof lastCmdMsg);
  } else {
    lastCmdOk = false; strlcpy(lastCmdMsg, "unknown command", sizeof lastCmdMsg);
  }
}

static bool sendTelemetry() {
  char js[1500];
  uint32_t pl = pausedUntil && (int32_t)(pausedUntil - millis()) > 0 ? (pausedUntil - millis()) / 1000 : 0;
  const char *st = statusStr();
  char err[200], ota[200];
  gf_json_escape(strcmp(st, "active") ? lastErr : "", err, sizeof err);
  gf_json_escape(lastOta, ota, sizeof ota);
  snprintf(js, sizeof js,
    "{\"id\":\"%s\",\"product\":\"" FW_PRODUCT "\",\"fw\":\"" FW_VERSION "\",\"boot\":\"%s\",\"ip\":\"%s\","
    "\"level\":\"%s\",\"status\":\"%s\",\"err\":\"%s\",\"filter_version\":%u,\"allow_version\":%u,"
    "\"uptime\":%u,\"rssi\":%d,\"heap_free\":%u,\"psram_total\":%u,\"psram_free\":%u,\"upstream\":\"%s,%s\","
    "\"q\":%u,\"blk\":%u,\"fwd\":%u,\"allow\":%u,\"to\":%u,\"bad\":%u,\"unfiltered\":%u,\"paused_left\":%u,"
    "\"chit\":%u,\"cmiss\":%u,\"tq\":%u,\"tblk\":%u,\"tfwd\":%u,\"terr\":%u,\"captive\":%u,"
    "\"pending_verify\":%d,\"ota\":\"%s\","
    "\"last_cmd_id\":%u,\"last_cmd_ok\":%d,\"last_cmd_msg\":\"%s\"}",
    deviceId.c_str(), bootId.c_str(), WiFi.localIP().toString().c_str(), level.c_str(), st, err,
    (unsigned)filterVersion, (unsigned)allowVersion,
    (unsigned)(millis() / 1000), WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getPsramSize(),
    (unsigned)ESP.getFreePsram(), up1.toString().c_str(), up2.toString().c_str(),
    (unsigned)cQueries, (unsigned)cBlocked, (unsigned)cForwarded, (unsigned)cAllowed, (unsigned)cTimeouts,
    (unsigned)cBad, (unsigned)cUnfiltered, (unsigned)pl,
    (unsigned)cCacheHit, (unsigned)cache.misses, (unsigned)cTcpQ, (unsigned)cTcpBlk, (unsigned)cTcpFwd, (unsigned)cTcpErr,
    (unsigned)cCaptive, imagePending() ? 1 : 0, ota,
    (unsigned)lastCmdId, lastCmdOk ? 1 : 0, lastCmdMsg);
  HTTPClient h;
  if (!httpBegin(h, "/api/t1/v1/telemetry")) return false;
  h.addHeader("Content-Type", "application/json");
  int code = h.POST((uint8_t *)js, strlen(js));
  if (code != 200) {
    h.end();
    if (code == 401) setErr("server refused this board's token (revoked? ask the administrator)");
    return false;
  }
  String body = h.getString(); h.end();
  // Response: "ok\n" then zero or more "cmd <id> <name> <arg>\n"
  int pos = 0; bool reboot = false;
  while (pos < (int)body.length()) {
    int e = body.indexOf('\n', pos); if (e < 0) e = body.length();
    String line = body.substring(pos, e); pos = e + 1;
    if (!line.startsWith("cmd ")) continue;
    int a = line.indexOf(' ', 4), b = a < 0 ? -1 : line.indexOf(' ', a + 1);
    if (a < 0) continue;
    uint32_t id = line.substring(4, a).toInt();
    String name = b < 0 ? line.substring(a + 1) : line.substring(a + 1, b);
    String arg = b < 0 ? "" : line.substring(b + 1); if (arg == "-") arg = "";
    runCommand(id, name, arg);
    if (name == "reboot") reboot = true;
  }
  if (reboot) { sendTelemetry(); delay(300); ESP.restart(); }
  return true;
}

// Core 0: everything that may block for seconds - HTTP, flash writes, filter loads.
static void netTask(void *) {
  uint32_t lastTel = 0, lastCheck = 0, lastEnrol = 0; int fails = 0;
  for (;;) {
    if (provBusy) { vTaskDelay(pdMS_TO_TICKS(250)); continue; }       // a serial scan/test owns Wi-Fi
    if (WiFi.status() == WL_CONNECTED && provisioned()) {
      if (serverUrl.isEmpty()) discoverServer();
      bool haveToken = enrolled();
      if (!haveToken && (!lastEnrol || millis() - lastEnrol > 60000)) {   // at most once a minute
        lastEnrol = millis();
        haveToken = ensureToken();
      }
      if (haveToken && !serverUrl.isEmpty()) {
        if (forceUpdate || millis() - lastCheck > UPDATE_CHECK_MS) {
          forceUpdate = false; lastCheck = millis(); checkForUpdate();
        }
        if (!lastTel || millis() - lastTel > TELEMETRY_MS) {
          lastTel = millis();
          bool ok = sendTelemetry();
          validateImage(ok);
          if (ok) fails = 0;
          else if (++fails >= REDISCOVER_AFTER) { fails = 0; discoverServer(); }
        }
      } else if (!lastTel || millis() - lastTel > TELEMETRY_MS) {
        lastTel = millis();
        validateImage(false);                                          // still counts toward the roll-back deadline
      }
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// ── DNS: verdict + TCP (core 0) ──────────────────────────────────────────────────────
// 1 = block, 0 = forward. Same rules as the UDP path; the TCP task may wait a moment for the
// lock (it is not the latency-critical loop), and says so in the counters when it cannot filter.
static int tcpVerdict(const gf_dns_q &q) {
  bool paused = pausedUntil && (int32_t)(pausedUntil - millis()) > 0;
  if (paused || !filterOk) return 0;
  int verdict = 0;
  if (xSemaphoreTake(filterMux, pdMS_TO_TICKS(40)) == pdTRUE) {
    if (filterOk) {
      char norm[GF_DOMAIN_MAX + 1];
      int l = gf_normalise(q.name, q.name_len, norm);
      if (l > 0) {
        uint64_t h1, h2; gf_domain_hash(sha256Fn, norm, l, &h1, &h2);
        if (gf_bloom_has_hash(&bloomF, h1, h2) && !(allowKeys && gf_allow_has(allowKeys, allowCount, h1))) verdict = 1;
      }
    }
    xSemaphoreGive(filterMux);
  }
  return verdict;
}

static bool tcpWriteFramed(WiFiClient &c, const uint8_t *msg, size_t n) {
  static uint8_t fr[1500 + 2];
  size_t fl = gf_tcp_frame(fr, sizeof fr, msg, n);
  return fl && c.write(fr, fl) == fl;
}

// One framed answer from `ip`:53 over TCP, into out. Returns its length, or 0.
static size_t tcpForward(const IPAddress &ip, const uint8_t *q, size_t n, uint8_t *out, size_t cap) {
  WiFiClient up;
  if (!up.connect(ip, 53, TCP_UPSTREAM_MS)) return 0;
  up.setTimeout(TCP_UPSTREAM_MS / 1000 + 1);
  if (!tcpWriteFramed(up, q, n)) { up.stop(); return 0; }
  gf_tcp_rx rx; gf_tcp_rx_init(&rx, out, (uint16_t)min(cap, (size_t)0xFFFF));
  uint8_t chunk[256]; uint32_t t0 = millis();
  while (millis() - t0 < TCP_UPSTREAM_MS) {
    int av = up.available();
    if (av <= 0) { if (!up.connected()) break; delay(3); continue; }
    int r = up.read(chunk, min(av, (int)sizeof chunk));
    if (r <= 0) break;
    size_t used; int rc = gf_tcp_rx_feed(&rx, chunk, r, &used);
    if (rc < 0) break;
    if (rc == 1) { up.stop(); return rx.need; }
  }
  up.stop();
  return 0;
}

static void tcpAnswer(WiFiClient &c, const uint8_t *msg, size_t n) {
  static uint8_t out[1500];
  gf_dns_q q;
  if (gf_dns_parse_query(msg, n, &q) != 0) { BUMP(cTcpErr); return; }
  BUMP(cTcpQ);
  if (tcpVerdict(q) == 1) {
    size_t r = gf_dns_build_block(msg, &q, out, sizeof out);
    if (r && tcpWriteFramed(c, out, r)) BUMP(cTcpBlk);
    return;
  }
  size_t r = tcpForward(up1, msg, n, out, sizeof out);
  if (!r && up2 != IPAddress((uint32_t)0)) r = tcpForward(up2, msg, n, out, sizeof out);
  if (r) { BUMP(cTcpFwd); lastUpstreamOk = millis(); tcpWriteFramed(c, out, r); }
  else {
    BUMP(cTcpErr);
    size_t sf = gf_dns_build_servfail(msg, &q, out, sizeof out);   // "ask your other upstream" - ADR-001's fallback path
    if (sf) tcpWriteFramed(c, out, sf);
  }
}

static void tcpServe(WiFiClient &c) {
  static uint8_t rxb[1500];
  gf_tcp_rx rx; gf_tcp_rx_init(&rx, rxb, sizeof rxb);
  uint32_t t0 = millis(); int served = 0;
  uint8_t chunk[256];
  while (c.connected() && millis() - t0 < TCP_SESSION_MS && served < TCP_MAX_QUERIES) {
    int av = c.available();
    if (av <= 0) { vTaskDelay(pdMS_TO_TICKS(4)); continue; }
    int r = c.read(chunk, min(av, (int)sizeof chunk));
    if (r <= 0) break;
    size_t off = 0;
    while (off < (size_t)r) {
      size_t used; int rc = gf_tcp_rx_feed(&rx, chunk + off, (size_t)r - off, &used);
      off += used;
      if (rc < 0) { BUMP(cTcpErr); return; }
      if (rc == 1) { tcpAnswer(c, rxb, rx.need); gf_tcp_rx_reset(&rx); served++; }
    }
  }
}

static WiFiServer dnsTcp(DNS_PORT);

static void tcpTask(void *) {
  dnsTcp.begin();
  dnsTcp.setNoDelay(true);
  for (;;) {
    WiFiClient c = dnsTcp.accept();
    if (c) { tcpServe(c); c.stop(); }
    else vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ── DNS forwarder (core 1, the Arduino loop) ─────────────────────────────────────────
struct Pending { bool used, resent; uint16_t newId, origId; IPAddress cli; uint16_t port; uint32_t t0; uint16_t len; uint8_t *q; };
static Pending pend[PENDING_SLOTS];
static WiFiUDP dnsUdp, upUdp;
static uint8_t pkt[1500], out[600];

static void sendTo(WiFiUDP &u, const IPAddress &ip, uint16_t port, const uint8_t *b, size_t n) {
  u.beginPacket(ip, port); u.write(b, n); u.endPacket();
}

static uint16_t freshId() {
  for (;;) {
    uint16_t id = esp_random() & 0xFFFF; bool clash = false;
    for (auto &p : pend) if (p.used && p.newId == id) { clash = true; break; }
    if (!clash) return id;
  }
}

static void forward(const uint8_t *q, size_t n, const IPAddress &cli, uint16_t port, const gf_dns_q &pq) {
  if (n > 512) { size_t r = gf_dns_build_servfail(q, &pq, out, sizeof out); if (r) sendTo(dnsUdp, cli, port, out, r); return; }
  Pending *slot = nullptr; Pending *oldest = &pend[0];
  for (auto &p : pend) { if (!p.used) { slot = &p; break; } if ((int32_t)(p.t0 - oldest->t0) < 0) oldest = &p; }
  if (!slot) { slot = oldest; cTimeouts++; }        // table full: evict the oldest query
  if (!slot->q) return;
  memcpy(slot->q, q, n);
  slot->len = n; slot->origId = pq.id; slot->newId = freshId(); slot->cli = cli; slot->port = port;
  slot->t0 = millis(); slot->resent = false; slot->used = true;
  gf_wr16(slot->q, slot->newId);
  sendTo(upUdp, up1, 53, slot->q, n);
  cForwarded++;
  lastForwardAt = millis();
}

// ── setup hotspot: captive DNS + a small web form ────────────────────────────────────
static WebServer http(80);
static bool portalOn = false, portalHandlers = false;
static uint32_t portalUntil = 0;                      // millis(); 0 = stays up until provisioned

static bool fromHotspot(const IPAddress &ip) {
  if (!portalOn) return false;
  IPAddress ap = WiFi.softAPIP();
  return ip[0] == ap[0] && ip[1] == ap[1] && ip[2] == ap[2];
}

static String htmlEsc(const String &s) {
  String o; o.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char ch = s[i];
    if (ch == '&') o += "&amp;"; else if (ch == '<') o += "&lt;"; else if (ch == '>') o += "&gt;"; else if (ch == '"') o += "&quot;"; else o += ch;
  }
  return o;
}

static const char PORTAL_HTML[] PROGMEM =
  "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
  "<title>Gate^Flame T1 setup</title><style>body{font:16px system-ui,sans-serif;background:#0b0d12;color:#e6edf3;margin:0;padding:18px}"
  "main{max-width:26rem;margin:auto}h1{font-size:1.3rem}label{display:block;margin-top:14px;color:#9fb0c3;font-size:.85rem}"
  "input,select{width:100%;box-sizing:border-box;padding:11px;margin-top:4px;border-radius:8px;border:1px solid #2a3442;background:#111a28;color:#e6edf3;font-size:1rem}"
  "button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:10px;background:#006fd3;color:#fff;font-size:1rem;font-weight:600}"
  "small{color:#7b8aa0}</style></head><body><main><h1>Gate^Flame T1 setup</h1>"
  "<p><small>Board <b id=bid></b>. This box joins your home Wi-Fi (2.4 GHz networks only) and reports to your Gate^Flame server.</small></p>"
  "<form method=post action=/save>"
  "<label>Wi-Fi network</label><select id=ssid name=ssid><option value=''>scanning...</option></select>"
  "<label>or type its name</label><input name=ssid2 autocomplete=off>"
  "<label>Wi-Fi password (blank for an open network)</label><input name=pass type=password autocomplete=off>"
  "<label>Server address (blank to find it automatically)</label><input name=server placeholder='http://192.168.1.10:8095' autocomplete=off>"
  "<label>Enrolment token (from your administrator)</label><input name=enrol autocomplete=off>"
  "<label>Filter level</label><select name=level><option>low</option><option>medium</option><option>high</option></select>"
  "<button>Save and restart</button></form></main>"
  "<script>var s=document.getElementById('ssid');function poll(){fetch('/scan').then(r=>r.json()).then(j=>{"
  "document.getElementById('bid').textContent=j.id||'';"
  "if(!j.done){setTimeout(poll,1800);return}s.innerHTML='';var o=document.createElement('option');o.value='';o.textContent='choose...';s.appendChild(o);"
  "j.networks.forEach(function(n){var e=document.createElement('option');e.value=n.ssid;e.textContent=n.ssid+(n.secure?'  (secured)':'  (open)');s.appendChild(e)})})"
  ".catch(function(){setTimeout(poll,3000)})}poll()</script></body></html>";

// Validate-then-apply, shared by the hotspot and the serial protocol. Returns "" on success or the
// name of the first field that is not acceptable. Nothing is written unless every field passes.
struct ProvIn { const char *key; const String *val; };

static void applySetting(const String &k, const String &v) {
  if (k == "ssid") { cfgSsid = v; prefs.putString("ssid", v); }
  else if (k == "pass") { cfgPass = v; prefs.putString("pass", v); }
  else if (k == "server") { cfgServer = v; prefs.putString("server", v); serverUrl = ""; }
  else if (k == "enrol") { cfgEnrol = v; prefs.putString("enrol", v); }
  else if (k == "level") { level = v; prefs.putString("level", v); forceUpdate = true; }
  else if (k == "label") { cfgLabel = v; prefs.putString("label", v); }
  else if (k == "sip") { cfgSip = v; prefs.putString("sip", v); }
  else if (k == "sgw") { cfgSgw = v; prefs.putString("sgw", v); }
  else if (k == "ssn") { cfgSsn = v; prefs.putString("ssn", v); }
  else if (k == "up1") { up1.fromString(v); prefs.putString("up1", v); }
  else if (k == "up2") { up2.fromString(v); prefs.putString("up2", v); }
}

static bool settingOk(const String &k, const String &v) {
  if (k == "ssid") return validSsid(v);
  if (k == "pass") return validPass(v);
  if (k == "server") return validServer(v);
  if (k == "enrol") return validEnrol(v);
  if (k == "level") return validLevel(v);
  if (k == "label") return validLabel(v);
  if (k == "sip" || k == "sgw" || k == "ssn" || k == "up1" || k == "up2") return v.length() == 0 ? (k != "up1") : validIp(v);
  return false;
}

static void portalStop() {
  if (!portalOn) return;
  http.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalOn = false;
  Serial.println("[t1] setup hotspot off");
}

static void portalStart(bool indefinite) {
  if (portalOn) return;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apSsid.c_str(), apPass.c_str());
  if (!portalHandlers) {
    portalHandlers = true;
    http.on("/", HTTP_GET, []() { http.send_P(200, "text/html", PORTAL_HTML); });
    http.on("/scan", HTTP_GET, []() {
      int n = WiFi.scanComplete();
      if (n == WIFI_SCAN_FAILED) { WiFi.scanNetworks(true); http.send(200, "application/json", "{\"done\":false,\"id\":\"" + deviceId + "\"}"); return; }
      if (n == WIFI_SCAN_RUNNING) { http.send(200, "application/json", "{\"done\":false,\"id\":\"" + deviceId + "\"}"); return; }
      String j = "{\"done\":true,\"id\":\"" + deviceId + "\",\"networks\":[";
      bool first = true;
      for (int i = 0; i < n && i < 24; i++) {
        String s = WiFi.SSID(i);
        if (s.isEmpty()) continue;
        char esc[140]; if (!gf_json_escape(s.c_str(), esc, sizeof esc)) continue;
        j += String(first ? "" : ",") + "{\"ssid\":\"" + esc + "\",\"rssi\":" + String(WiFi.RSSI(i)) + ",\"secure\":" + (WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? "true" : "false") + "}";
        first = false;
      }
      WiFi.scanDelete();
      http.send(200, "application/json", j + "]}");
    });
    http.on("/save", HTTP_POST, []() {
      String ssid = http.arg("ssid2"); ssid.trim();
      if (ssid.isEmpty()) ssid = http.arg("ssid");
      const char *keys[] = {"ssid", "pass", "server", "enrol", "level"};
      String vals[5] = { ssid, http.arg("pass"), http.arg("server"), http.arg("enrol"), http.arg("level") };
      vals[2].trim(); vals[3].trim();
      for (int i = 0; i < 5; i++) {
        if (!settingOk(keys[i], vals[i])) {
          http.send(400, "text/html", "<meta name=viewport content='width=device-width'><body style='font:16px sans-serif;padding:18px'><p><b>Not saved.</b> The field <b>" +
                    String(keys[i]) + "</b> is not acceptable (Wi-Fi password: 8 to 63 characters, or blank for an open network). Go back and fix it.</p>");
          return;
        }
      }
      for (int i = 0; i < 5; i++) if (!(i == 3 && vals[i].isEmpty())) applySetting(keys[i], vals[i]);   // a blank enrolment field keeps the one already stored
      http.send(200, "text/html", "<meta name=viewport content='width=device-width'><body style='font:16px sans-serif;padding:18px'><p><b>Saved.</b> The box is restarting and will join <b>" +
                htmlEsc(ssid) + "</b>. You can close this page.</p>");
      rebootAt = millis() + 2500; if (!rebootAt) rebootAt = 1;
    });
    auto bounce = []() { http.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true); http.send(302, "text/plain", ""); };
    http.on("/generate_204", HTTP_ANY, bounce);          // Android
    http.on("/hotspot-detect.html", HTTP_ANY, bounce);   // iOS / macOS
    http.on("/connecttest.txt", HTTP_ANY, bounce);       // Windows
    http.on("/ncsi.txt", HTTP_ANY, bounce);
    http.onNotFound(bounce);
  }
  http.begin();
  WiFi.scanNetworks(true);
  portalOn = true;
  portalUntil = indefinite ? 0 : millis() + PORTAL_WINDOW_MS;
  Serial.printf("[t1] setup hotspot: \"%s\"  password %s  -> http://%s/\n", apSsid.c_str(), apPass.c_str(), WiFi.softAPIP().toString().c_str());
}

// ── serial provisioning: gf-t1-prov/1 ────────────────────────────────────────────────
static void provReply(const String &json) { Serial.print("GF-T1-PROV "); Serial.println(json); }
static String jq(const String &s) {
  char *b = (char *)malloc(s.length() * 6 + 8);
  if (!b) return "\"\"";
  String r = gf_json_escape(s.c_str(), b, s.length() * 6 + 8) || s.isEmpty() ? String("\"") + b + "\"" : String("\"\"");
  free(b);
  return r;
}
static String provErr(const char *code, const String &detail = "") {
  return String("{\"ok\":false,\"error\":\"") + code + "\"" + (detail.length() ? ",\"detail\":" + jq(detail) : "") + "}";
}

static String provHello() {
  String j = "{\"ok\":true,\"proto\":\"gf-t1-prov/1\",\"id\":" + jq(deviceId) + ",\"product\":\"" FW_PRODUCT "\",\"fw\":\"" FW_VERSION "\",\"chip\":\"ESP32-S3\"";
  j += String(",\"psram\":") + (psramFound() ? "true" : "false");
  j += String(",\"provisioned\":") + (provisioned() ? "true" : "false");
  j += String(",\"enrolled\":") + (enrolled() ? "true" : "false");
  j += String(",\"has_enrol_token\":") + (cfgEnrol.length() ? "true" : "false");
  j += ",\"ssid\":" + jq(cfgSsid) + String(",\"has_pass\":") + (cfgPass.length() ? "true" : "false");
  j += ",\"server\":" + jq(cfgServer) + ",\"level\":" + jq(level) + ",\"label\":" + jq(cfgLabel);
  j += ",\"wifi\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",\"ip\":" + jq(WiFi.localIP().toString());
  j += ",\"status\":\"" + String(statusStr()) + "\",\"filter_version\":" + String((unsigned)filterVersion);
  j += ",\"ap_ssid\":" + jq(apSsid) + ",\"ap_pass\":" + jq(apPass);
  j += ",\"last_err\":" + jq(lastErr) + ",\"enrol_why\":" + jq(lastEnrolWhy) + "}";
  return j;
}

static String provScan() {
  provBusy = true;
  int n = WiFi.scanNetworks();
  String j = "{\"ok\":true,\"note\":\"2.4 GHz networks only: this chip cannot see 5 GHz\",\"networks\":[";
  bool first = true;
  for (int i = 0; i < n && i < 30; i++) {
    String s = WiFi.SSID(i);
    if (s.isEmpty()) continue;
    j += String(first ? "" : ",") + "{\"ssid\":" + jq(s) + ",\"rssi\":" + String(WiFi.RSSI(i)) + ",\"ch\":" + String(WiFi.channel(i)) +
         ",\"secure\":" + (WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? "true" : "false") + "}";
    first = false;
  }
  WiFi.scanDelete();
  provBusy = false;
  return j + "]}";
}

// Join Wi-Fi, reach the server, enrol if needed, authenticate, and verify a signed file - and say
// exactly which stage failed. This is "never claim success without a read-back" at the bench.
static String provTest() {
  if (!provisioned()) return provErr("not_provisioned", "no Wi-Fi network set yet");
  provBusy = true;
  String r;
  WiFi.disconnect(false, false);
  delay(200);
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
  uint32_t t0 = millis(); wl_status_t st = WL_IDLE_STATUS;
  while (millis() - t0 < 20000) {
    st = WiFi.status();
    if (st == WL_CONNECTED || st == WL_CONNECT_FAILED) break;
    if (st == WL_NO_SSID_AVAIL && millis() - t0 > 8000) break;
    delay(250);
  }
  if (st != WL_CONNECTED) {
    const char *why = st == WL_NO_SSID_AVAIL ? "ssid_not_found" : st == WL_CONNECT_FAILED ? "wrong_password" : "timeout";
    r = String("{\"ok\":false,\"stage\":\"wifi\",\"reason\":\"") + why + "\"" +
        (st == WL_NO_SSID_AVAIL ? ",\"hint\":\"the board can only see 2.4 GHz networks\"" : "") + "}";
    provBusy = false;
    return r;
  }
  String ip = WiFi.localIP().toString(); int rssi = WiFi.RSSI();
  serverUrl = ""; discoverServer();
  if (serverUrl.isEmpty()) { provBusy = false; return "{\"ok\":false,\"stage\":\"server\",\"reason\":\"no_server\",\"hint\":\"set a server address, or run the T1 server on this network\"}"; }
  {
    HTTPClient h; h.begin(serverUrl + "/api/t1/v1/health"); h.setTimeout(8000);
    int code = h.GET(); String body = code == 200 ? h.getString() : ""; h.end();
    if (code != 200 || body.indexOf("gateflame-t1") < 0) {
      provBusy = false;
      return String("{\"ok\":false,\"stage\":\"server\",\"reason\":\"") + (code <= 0 ? "unreachable" : "not_a_t1_server") + "\",\"http\":" + String(code) + "}";
    }
  }
  if (!enrolled() && !ensureToken()) { provBusy = false; return "{\"ok\":false,\"stage\":\"enrol\",\"reason\":" + jq(lastEnrolWhy) + "}"; }
  String sha, sig; size_t size = 0;
  {
    HTTPClient h; if (!httpBegin(h, "/api/t1/v1/manifest.txt?level=" + level + "&fw=" FW_VERSION)) { provBusy = false; return provErr("auth", "manifest request could not start"); }
    int code = h.GET(); String body = code == 200 ? h.getString() : ""; h.end();
    if (code != 200) { provBusy = false; return String("{\"ok\":false,\"stage\":\"auth\",\"reason\":\"") + (code == 401 ? "token_refused" : "manifest_failed") + "\",\"http\":" + String(code) + "}"; }
    auto val = [&](const char *k) -> String { String key = String(k) + "="; int i = body.indexOf(key); if (i < 0 || (i > 0 && body[i - 1] != '\n')) return ""; int e = body.indexOf('\n', i); return body.substring(i + key.length(), e < 0 ? body.length() : e); };
    sha = val("allow_sha256"); sig = val("allow_sig"); size = (size_t)val("allow_size").toInt();
  }
  {
    HTTPClient h; if (!httpBegin(h, "/api/t1/v1/allow.txt")) { provBusy = false; return provErr("signature", "download could not start"); }
    int code = h.GET();
    if (code != 200) { h.end(); provBusy = false; return String("{\"ok\":false,\"stage\":\"signature\",\"reason\":\"download_failed\",\"http\":") + String(code) + "}"; }
    String body = h.getString(); h.end();
    uint8_t dg[32]; mbedtls_sha256((const uint8_t *)body.c_str(), body.length(), dg, 0);
    if (body.length() != size || tohex(dg, 32) != sha || !verifySig(dg, sig)) {
      provBusy = false;
      return "{\"ok\":false,\"stage\":\"signature\",\"reason\":\"signature_invalid\",\"hint\":\"this firmware's compiled-in key is not the key this server signs with\"}";
    }
  }
  provBusy = false;
  forceUpdate = true;
  return "{\"ok\":true,\"stages\":[\"wifi\",\"server\",\"enrol\",\"auth\",\"signature\"],\"ip\":" + jq(ip) + ",\"rssi\":" + String(rssi) + ",\"server\":" + jq(serverUrl) + "}";
}

static String provSet(const gf_json_obj &o) {
  static const char *known[] = {"ssid", "pass", "server", "enrol", "level", "label", "sip", "sgw", "ssn", "up1", "up2"};
  for (int i = 0; i < o.n; i++) {
    if (!strcmp(o.kv[i].key, "op")) continue;
    bool ok = false;
    for (auto k : known) if (!strcmp(k, o.kv[i].key)) ok = true;
    if (!ok) return provErr("unknown_field", o.kv[i].key);
    if (o.kv[i].kind != GF_JSON_STR) return provErr("bad_value", String(o.kv[i].key) + " must be a string");
    if (!settingOk(o.kv[i].key, String(o.kv[i].val))) return provErr("bad_value", o.kv[i].key);
  }
  String changed = "[";
  bool first = true;
  for (int i = 0; i < o.n; i++) {
    if (!strcmp(o.kv[i].key, "op")) continue;
    applySetting(o.kv[i].key, String(o.kv[i].val));
    changed += String(first ? "" : ",") + "\"" + o.kv[i].key + "\"";   // names only: a secret is never echoed
    first = false;
  }
  return "{\"ok\":true,\"changed\":" + changed + "],\"provisioned\":" + (provisioned() ? "true" : "false") + "}";
}

static void provLine(const char *line, size_t len) {
  gf_json_obj o;
  int rc = gf_json_parse(line, len, &o);
  if (rc != 0) { provReply(provErr("bad_json", String("parse error ") + rc)); return; }
  const char *op = gf_json_str(&o, "op");
  if (!op) { provReply(provErr("no_op")); return; }
  String s(op);
  if (s == "hello" || s == "get") provReply(provHello());
  else if (s == "set") provReply(provSet(o));
  else if (s == "scan") provReply(provScan());
  else if (s == "test") provReply(provTest());
  else if (s == "reboot") { provReply("{\"ok\":true,\"rebooting\":true}"); rebootAt = millis() + 600; if (!rebootAt) rebootAt = 1; }
  else if (s == "factory_reset") {
    prefs.clear();
    provReply("{\"ok\":true,\"factory_reset\":true,\"note\":\"settings and token erased; the signed filter on flash is kept\"}");
    rebootAt = millis() + 600; if (!rebootAt) rebootAt = 1;
  } else provReply(provErr("unknown_op", s));
}

static void handleSerial() {
  static char buf[640]; static size_t n = 0; static bool overflow = false;
  while (Serial.available()) {
    int c = Serial.read();
    if (c < 0) break;
    if (c == '\r') continue;
    if (c == '\n') {
      if (!overflow && n && buf[0] == '{') provLine(buf, n);
      else if (overflow) provReply(provErr("line_too_long"));
      n = 0; overflow = false;
      continue;
    }
    if (n < sizeof buf - 1) buf[n++] = (char)c; else overflow = true;
  }
}

// ── UDP: client side and upstream side ───────────────────────────────────────────────
static void handleClient() {
  int n = dnsUdp.parsePacket();
  if (n <= 0) return;
  IPAddress cli = dnsUdp.remoteIP(); uint16_t port = dnsUdp.remotePort();
  n = dnsUdp.read(pkt, sizeof pkt);
  gf_dns_q q;
  if (n <= 0 || gf_dns_parse_query(pkt, n, &q) != 0) { cBad++; return; }
  if (fromHotspot(cli)) {                            // a phone on the setup hotspot: everything resolves to the form
    uint8_t ap[4]; IPAddress a = WiFi.softAPIP(); ap[0] = a[0]; ap[1] = a[1]; ap[2] = a[2]; ap[3] = a[3];
    size_t r = gf_dns_build_a_answer(pkt, &q, ap, 0, out, sizeof out);
    if (r) { sendTo(dnsUdp, cli, port, out, r); cCaptive++; }
    return;
  }
  cQueries++;
  bool paused = pausedUntil && (int32_t)(pausedUntil - millis()) > 0;
  if (pausedUntil && !paused) pausedUntil = 0;
  int verdict = 0;                                   // 1 block, 0 forward
  if (!paused && filterOk && xSemaphoreTake(filterMux, 0) == pdTRUE) {
    if (filterOk) {
      char norm[GF_DOMAIN_MAX + 1];
      int l = gf_normalise(q.name, q.name_len, norm);
      if (l > 0) {
        uint64_t h1, h2; gf_domain_hash(sha256Fn, norm, l, &h1, &h2);
        if (gf_bloom_has_hash(&bloomF, h1, h2)) {
          if (allowKeys && gf_allow_has(allowKeys, allowCount, h1)) cAllowed++; else verdict = 1;
        }
      }
    }
    xSemaphoreGive(filterMux);
  } else if (!paused) {
    cUnfiltered++;                                   // bypass / applying: say so in the counters
  }
  if (verdict == 1) {
    size_t r = gf_dns_build_block(pkt, &q, out, sizeof out);
    if (r) { sendTo(dnsUdp, cli, port, out, r); cBlocked++; }
    return;
  }
  // The verdict above is taken BEFORE the cache is read, so a name that is blocked now is blocked
  // whatever an earlier answer says; and only ALLOWED answers are ever stored.
  if (cache.n) {
    uint8_t cached[GF_CACHE_PKT];
    size_t cl = gf_cache_get(&cache, &q, pkt, millis(), cached, sizeof cached);
    if (cl) { sendTo(dnsUdp, cli, port, cached, cl); cCacheHit++; return; }
  }
  forward(pkt, n, cli, port, q);
}

static void handleUpstream() {
  int n = upUdp.parsePacket();
  if (n <= 0) return;
  IPAddress from = upUdp.remoteIP();
  n = upUdp.read(pkt, sizeof pkt);
  if (n < GF_DNS_HDR || (from != up1 && from != up2)) return;   // only our resolvers
  uint16_t id = gf_rd16(pkt);
  for (auto &p : pend) {
    if (p.used && p.newId == id) {
      if (cache.n) {                                              // p.q is the query we forwarded: re-read its question for the key
        gf_dns_q pq;
        if (gf_dns_parse_query(p.q, p.len, &pq) == 0) gf_cache_put(&cache, &pq, pkt, n, millis());
      }
      gf_wr16(pkt, p.origId);
      sendTo(dnsUdp, p.cli, p.port, pkt, n);
      p.used = false; lastUpstreamOk = millis();
      return;
    }
  }
}

static void sweep() {
  uint32_t now = millis();
  for (auto &p : pend) {
    if (!p.used) continue;
    uint32_t age = now - p.t0;
    if (!p.resent && age > UPSTREAM_RESEND_MS && up2 != IPAddress((uint32_t)0)) { sendTo(upUdp, up2, 53, p.q, p.len); p.resent = true; }
    else if (age > UPSTREAM_GIVEUP_MS) {
      gf_dns_q q;
      gf_wr16(p.q, p.origId);
      if (gf_dns_parse_query(p.q, p.len, &q) == 0) { size_t r = gf_dns_build_servfail(p.q, &q, out, sizeof out); if (r) sendTo(dnsUdp, p.cli, p.port, out, r); }
      p.used = false; cTimeouts++;
    }
  }
}

// ── setup / loop ─────────────────────────────────────────────────────────────────────
static void deriveHotspot(const uint8_t digest[32]) {
  apSsid = "GateFlame-T1-" + deviceId.substring(deviceId.length() - 4);
  apPass = tohex(digest, 4);                                       // 8 hex characters: printed on the label, shown by `hello`
}

void setup() {
  Serial.begin(115200);
  delay(300);
  led(0, 0, 20);
  uint64_t mac = ESP.getEfuseMac();
  char id[24]; snprintf(id, sizeof id, "gft1-%012llx", (unsigned long long)(mac & 0xFFFFFFFFFFFFULL));
  deviceId = id;
  char b[12]; snprintf(b, sizeof b, "%08lx", (unsigned long)esp_random()); bootId = b;
  { String seed = "gft1-ap:" + deviceId; uint8_t dg[32]; mbedtls_sha256((const uint8_t *)seed.c_str(), seed.length(), dg, 0); deriveHotspot(dg); }
  Serial.printf("\n[t1] Gate^Flame T1 %s  %s  PSRAM %u KB\n", FW_VERSION, id, (unsigned)(ESP.getPsramSize() / 1024));
  pinMode(0, INPUT_PULLUP);                                       // BOOT button: held 10 s while running = factory reset

  filterMux = xSemaphoreCreateMutex();
  bool ps = psramFound();
  for (auto &p : pend) { p.used = false; p.q = (uint8_t *)(ps ? heap_caps_malloc(512, MALLOC_CAP_SPIRAM) : malloc(512)); }
  {                                                               // response cache: PSRAM only; absent it, no cache (never starve the filter)
    gf_cache_entry *cm = ps ? (gf_cache_entry *)heap_caps_malloc(sizeof(gf_cache_entry) * CACHE_ENTRIES, MALLOC_CAP_SPIRAM) : nullptr;
    if (cm) gf_cache_init(&cache, cm, CACHE_ENTRIES); else memset(&cache, 0, sizeof cache);
  }

  prefs.begin("gft1", false);
  loadSettings();
  if (!up1.fromString(prefs.getString("up1", DEFAULT_UPSTREAM_1))) up1.fromString(DEFAULT_UPSTREAM_1);
  if (!up2.fromString(prefs.getString("up2", DEFAULT_UPSTREAM_2))) up2.fromString(DEFAULT_UPSTREAM_2);

  if (!FFat.begin(true)) setErr("FFat mount failed - check the partition scheme (app3M_fat9M_16MB)");
  else {
    if (!ps) setErr("no PSRAM found - this build needs an ESP32-S3 with PSRAM (N16R8)");
    else loadFilterFromFlash();                      // protection resumes from flash, server or not
    loadAllowFromFlash();
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                              // modem sleep adds 100+ ms to DNS answers
  WiFi.setHostname(id);
  if (cfgSip.length() && validIp(cfgSip) && validIp(cfgSgw) && validIp(cfgSsn)) {
    IPAddress sip, gw, sn; sip.fromString(cfgSip); gw.fromString(cfgSgw); sn.fromString(cfgSsn);
    WiFi.config(sip, gw, sn, gw);
  }
  WiFi.setAutoReconnect(true);
  if (provisioned()) {
    WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); handleSerial(); }
    Serial.printf("[t1] Wi-Fi %s  ip %s\n", WiFi.status() == WL_CONNECTED ? "up" : "DOWN (retrying)", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[t1] no Wi-Fi settings yet: provisioning (serial gf-t1-prov/1, or the setup hotspot)");
    setErr("not provisioned: no Wi-Fi network set");
    portalStart(true);
  }
  MDNS.begin(id);
  dnsUdp.begin(DNS_PORT);
  upUdp.begin(40000 + (esp_random() % 20000));
  lastUpstreamOk = millis();
  xTaskCreatePinnedToCore(netTask, "t1net", NET_TASK_STACK, nullptr, 1, nullptr, 0);
  xTaskCreatePinnedToCore(tcpTask, "t1tcp", TCP_TASK_STACK, nullptr, 1, nullptr, 0);
  Serial.println("[t1] ready. hello? send {\"op\":\"hello\"} on this port.");
}

void loop() {
  for (int i = 0; i < 8; i++) { handleClient(); handleUpstream(); }
  loopBeat = loopBeat + 1;
  static uint32_t lastSweep = 0, lastLed = 0, lastSlow = 0, bootHeldAt = 0, notConnectedSince = 0;
  uint32_t now = millis();
  if (now - lastSweep > 100) { sweep(); lastSweep = now; }
  if (portalOn) http.handleClient();
  handleSerial();

  if (now - lastSlow > 500) {
    lastSlow = now;
    // BOOT held while running: factory reset. (Held at power-up it would enter the ROM bootloader.)
    if (digitalRead(0) == LOW) {
      if (!bootHeldAt) bootHeldAt = now ? now : 1;
      else if (now - bootHeldAt > RESET_HOLD_MS) {
        Serial.println("[t1] BOOT held: factory reset");
        for (int i = 0; i < 6; i++) { led(40, 0, 40); delay(120); led(0, 0, 0); delay(120); }
        prefs.clear(); delay(200); ESP.restart();
      }
    } else bootHeldAt = 0;
    // A provisioned board that cannot join its network offers the hotspot, so a wrong password is fixable in the field.
    if (WiFi.status() == WL_CONNECTED) notConnectedSince = 0;
    else if (provisioned()) {
      if (!notConnectedSince) notConnectedSince = now ? now : 1;
      else if (!portalOn && now - notConnectedSince > PORTAL_FALLBACK_MS) { Serial.println("[t1] cannot join Wi-Fi: opening the setup hotspot"); portalStart(false); }
    }
    if (portalOn && portalUntil && (int32_t)(now - portalUntil) > 0) portalStop();
    if (rebootAt && (int32_t)(now - rebootAt) > 0) { Serial.flush(); delay(100); ESP.restart(); }
  }

  if (now - lastLed > 250) {
    lastLed = now;
    if ((int32_t)(identifyUntil - now) > 0) { bool on = (now / 250) & 1; led(on ? 40 : 0, on ? 40 : 0, on ? 40 : 0); }
    else if (portalOn) { bool on = (now / 500) & 1; led(0, on ? 25 : 0, on ? 25 : 0); }
    else if (WiFi.status() != WL_CONNECTED) led(0, 0, 25);
    else {
      const char *s = statusStr();
      if (!strcmp(s, "active")) led(0, 20, 0);
      else if (!strcmp(s, "paused") || !strcmp(s, "applying")) led(25, 12, 0);
      else led(30, 0, 0);
    }
  }
  delay(1);
}
