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
// HOW IT FILTERS
//   A Bloom filter of the level's blocklists (~5.5 MB for 3.08 M domains at 0.1 % false
//   positives) lives in PSRAM. The T1 server builds and SIGNS it; this box verifies the
//   ECDSA P-256 signature against the public key compiled in (pubkey.h) before using it,
//   keeps a copy in FFat so a power cut does not need the server, and re-verifies that
//   copy on every boot. Blocked: A -> 0.0.0.0, AAAA -> ::, like Pi-hole on T3.
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
// ========================================================================================

#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <FFat.h>
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "mbedtls/sha256.h"
#include "mbedtls/pk.h"

#include "config.h"
#include "secrets.h"
#include "pubkey.h"
#include "gf_bloom.h"
#include "gf_dns.h"

// ── shared state (DNS loop on core 1, network task on core 0) ────────────────────────
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

// Written only by the DNS loop (core 1); the net task just reads them. Aligned 32-bit
// reads are atomic on the S3, so no lock and no volatile ++ needed.
static uint32_t cQueries = 0, cBlocked = 0, cForwarded = 0, cAllowed = 0, cTimeouts = 0, cBad = 0, cUnfiltered = 0;

static uint32_t lastCmdId = 0;
static bool lastCmdOk = false;
static char lastCmdMsg[96] = "";
static volatile bool forceUpdate = true;              // check once at boot
static volatile uint32_t identifyUntil = 0;

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

// ── HTTP to the T1 server ────────────────────────────────────────────────────────────
static bool httpBegin(HTTPClient &h, const String &path) {
  if (!h.begin(serverUrl + path)) return false;
  h.addHeader("X-T1-Token", T1_DEVICE_TOKEN);
  h.setTimeout(15000);
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

static bool checkForUpdate() {
  HTTPClient h;
  if (!httpBegin(h, "/api/t1/v1/manifest.txt?level=" + level)) return false;
  int code = h.GET();
  if (code != 200) { h.end(); char e[64]; snprintf(e, sizeof e, "manifest HTTP %d", code); setErr(e); return false; }
  String body = h.getString(); h.end();
  auto val = [&](const char *k) -> String {
    String key = String(k) + "="; int i = body.indexOf(key); if (i < 0) return "";
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
  return ok;
}

static void discoverServer() {
  int n = MDNS.queryService("gft1", "tcp");
  if (n > 0) {
    serverUrl = "http://" + MDNS.address(0).toString() + ":" + String(MDNS.port(0));
    Serial.printf("[t1] server via mDNS: %s\n", serverUrl.c_str());
  } else {
    serverUrl = prefs.getString("server", T1_SERVER_FALLBACK);
    Serial.printf("[t1] mDNS found nothing; using %s\n", serverUrl.c_str());
  }
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
    if (arg == "low" || arg == "medium" || arg == "high") {
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
  char js[900];
  uint32_t pl = pausedUntil && (int32_t)(pausedUntil - millis()) > 0 ? (pausedUntil - millis()) / 1000 : 0;
  const char *st = statusStr();
  snprintf(js, sizeof js,
    "{\"id\":\"%s\",\"product\":\"" FW_PRODUCT "\",\"fw\":\"" FW_VERSION "\",\"boot\":\"%s\",\"ip\":\"%s\","
    "\"level\":\"%s\",\"status\":\"%s\",\"err\":\"%s\",\"filter_version\":%u,\"allow_version\":%u,"
    "\"uptime\":%u,\"rssi\":%d,\"heap_free\":%u,\"psram_total\":%u,\"psram_free\":%u,\"upstream\":\"%s,%s\","
    "\"q\":%u,\"blk\":%u,\"fwd\":%u,\"allow\":%u,\"to\":%u,\"bad\":%u,\"unfiltered\":%u,\"paused_left\":%u,"
    "\"last_cmd_id\":%u,\"last_cmd_ok\":%d,\"last_cmd_msg\":\"%s\"}",
    deviceId.c_str(), bootId.c_str(), WiFi.localIP().toString().c_str(), level.c_str(), st,
    strcmp(st, "active") ? lastErr : "", (unsigned)filterVersion, (unsigned)allowVersion,
    (unsigned)(millis() / 1000), WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getPsramSize(),
    (unsigned)ESP.getFreePsram(), up1.toString().c_str(), up2.toString().c_str(),
    (unsigned)cQueries, (unsigned)cBlocked, (unsigned)cForwarded, (unsigned)cAllowed, (unsigned)cTimeouts,
    (unsigned)cBad, (unsigned)cUnfiltered, (unsigned)pl, (unsigned)lastCmdId, lastCmdOk ? 1 : 0, lastCmdMsg);
  HTTPClient h;
  if (!httpBegin(h, "/api/t1/v1/telemetry")) return false;
  h.addHeader("Content-Type", "application/json");
  int code = h.POST((uint8_t *)js, strlen(js));
  if (code != 200) { h.end(); return false; }
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
  uint32_t lastTel = 0, lastCheck = 0; int fails = 0;
  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      if (serverUrl.isEmpty()) discoverServer();
      if (forceUpdate || millis() - lastCheck > UPDATE_CHECK_MS) {
        forceUpdate = false; lastCheck = millis(); checkForUpdate();
      }
      if (!lastTel || millis() - lastTel > TELEMETRY_MS) {
        lastTel = millis();
        if (sendTelemetry()) fails = 0;
        else if (++fails >= REDISCOVER_AFTER) { fails = 0; discoverServer(); }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(250));
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

static void handleClient() {
  int n = dnsUdp.parsePacket();
  if (n <= 0) return;
  IPAddress cli = dnsUdp.remoteIP(); uint16_t port = dnsUdp.remotePort();
  n = dnsUdp.read(pkt, sizeof pkt);
  gf_dns_q q;
  if (n <= 0 || gf_dns_parse_query(pkt, n, &q) != 0) { cBad++; return; }
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
void setup() {
  Serial.begin(115200);
  delay(300);
  led(0, 0, 20);
  uint64_t mac = ESP.getEfuseMac();
  char id[24]; snprintf(id, sizeof id, "gft1-%012llx", (unsigned long long)(mac & 0xFFFFFFFFFFFFULL));
  deviceId = id;
  char b[12]; snprintf(b, sizeof b, "%08lx", (unsigned long)esp_random()); bootId = b;
  Serial.printf("\n[t1] Gate^Flame T1 %s  %s  PSRAM %u KB\n", FW_VERSION, id, (unsigned)(ESP.getPsramSize() / 1024));

  filterMux = xSemaphoreCreateMutex();
  bool ps = psramFound();
  for (auto &p : pend) { p.used = false; p.q = (uint8_t *)(ps ? heap_caps_malloc(512, MALLOC_CAP_SPIRAM) : malloc(512)); }

  prefs.begin("gft1", false);
  level = prefs.getString("level", T1_DEFAULT_LEVEL);
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
#ifdef T1_STATIC_IP
  IPAddress sip, gw, sn; sip.fromString(T1_STATIC_IP); gw.fromString(T1_GATEWAY); sn.fromString(T1_SUBNET);
  WiFi.config(sip, gw, sn, gw);
#endif
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  Serial.printf("[t1] Wi-Fi %s  ip %s\n", WiFi.status() == WL_CONNECTED ? "up" : "DOWN (retrying)", WiFi.localIP().toString().c_str());
  MDNS.begin(id);
  dnsUdp.begin(DNS_PORT);
  upUdp.begin(40000 + (esp_random() % 20000));
  lastUpstreamOk = millis();
  xTaskCreatePinnedToCore(netTask, "t1net", NET_TASK_STACK, nullptr, 1, nullptr, 0);
}

void loop() {
  for (int i = 0; i < 8; i++) { handleClient(); handleUpstream(); }
  static uint32_t lastSweep = 0, lastLed = 0;
  uint32_t now = millis();
  if (now - lastSweep > 100) { sweep(); lastSweep = now; }
  if (now - lastLed > 250) {
    lastLed = now;
    if ((int32_t)(identifyUntil - now) > 0) { bool on = (now / 250) & 1; led(on ? 40 : 0, on ? 40 : 0, on ? 40 : 0); }
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
