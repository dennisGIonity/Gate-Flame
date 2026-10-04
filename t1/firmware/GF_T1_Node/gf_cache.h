// Gate^Flame T1 - DNS response cache. Pure C, shared with the host tests.
// (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
//
// WHAT IS CACHED: answers the upstream gave for ALLOWED names. Blocked names are synthesised
// locally and never reach here, and the filter verdict is taken BEFORE the cache is read, so:
//   - a name blocked tomorrow is blocked even if today's answer is still cached;
//   - an allow-list change needs no invalidation: a name that was blocked was never cached.
//
// WHAT IS NOT: truncated answers (TC), anything but NOERROR / NXDOMAIN, answers whose minimum
// TTL is 0, and answers larger than GF_CACHE_PKT (so a cached answer always fits the 512-byte
// UDP limit a client without EDNS is entitled to).
//
// SHAPE: a direct-mapped, 2-way table in caller-supplied memory (PSRAM on the board). A lookup
// is two slots, an insert replaces the older of the two. The key folds in the question AND the
// EDNS / DNSSEC-OK / checking-disabled bits, so a DO client is never served a non-DO answer.
#pragma once
#include "gf_dns.h"

#define GF_CACHE_PKT 512
#define GF_CACHE_MAX_TTL 3600u
#define GF_CACHE_MIN_TTL 1u

typedef struct {
  uint64_t key;          // 0 = empty
  uint32_t stored_ms;    // millis() when stored
  uint32_t ttl_s;        // TTL at store time
  uint16_t len;
  uint16_t qend;         // end of the question section inside pkt
  uint8_t pkt[GF_CACHE_PKT];
} gf_cache_entry;

typedef struct {
  gf_cache_entry *e;
  uint32_t n;            // number of entries, even
  uint32_t hits, misses, stores, skipped;
} gf_cache_t;

static inline void gf_cache_init(gf_cache_t *c, gf_cache_entry *mem, uint32_t n) {
  if (n & 1) n--;
  c->e = mem; c->n = n; c->hits = c->misses = c->stores = c->skipped = 0;
  memset(mem, 0, sizeof(gf_cache_entry) * n);
}

static inline uint64_t gf_cache_key(const gf_dns_q *q) {
  uint64_t h = 1469598103934665603ULL;                    // FNV-1a, 64-bit
  for (size_t i = 0; i < q->name_len; i++) {
    uint8_t c = (uint8_t)q->name[i];
    if (c >= 'A' && c <= 'Z') c = (uint8_t)(c + 32);      // DNS names are case-insensitive
    h = (h ^ c) * 1099511628211ULL;
  }
  uint8_t tail[6] = { (uint8_t)(q->qtype >> 8), (uint8_t)q->qtype, (uint8_t)(q->qclass >> 8), (uint8_t)q->qclass,
                      (uint8_t)((q->edns ? 1 : 0) | (q->do_bit ? 2 : 0) | (q->cd ? 4 : 0)), 0x5A };
  for (int i = 0; i < 6; i++) h = (h ^ tail[i]) * 1099511628211ULL;
  return h ? h : 1;
}

static inline gf_cache_entry *gf_cache__slot(gf_cache_t *c, uint64_t key, int way) {
  uint32_t i = (uint32_t)((key % (c->n / 2)) * 2) + (uint32_t)way;
  return &c->e[i];
}

// Store an upstream answer for `q`. Returns 1 if stored, 0 if it was not cacheable.
static inline int gf_cache_put(gf_cache_t *c, const gf_dns_q *q, const uint8_t *pkt, size_t len, uint32_t now_ms) {
  if (!c->n || len < GF_DNS_HDR || len > GF_CACHE_PKT) { c->skipped++; return 0; }
  uint16_t flags = gf_rd16(pkt + 2);
  uint8_t rcode = (uint8_t)(flags & 0xF);
  if (!(flags & 0x8000) || (flags & 0x0200) || (rcode != GF_RCODE_NOERROR && rcode != GF_RCODE_NXDOMAIN)) { c->skipped++; return 0; }
  long ttl = gf_dns_min_ttl(pkt, len, q->question_end);
  if (ttl == -2) ttl = 0;                                 // no records at all (empty NOERROR): not worth keeping
  if (ttl < (long)GF_CACHE_MIN_TTL) { c->skipped++; return 0; }
  if (ttl > (long)GF_CACHE_MAX_TTL) ttl = (long)GF_CACHE_MAX_TTL;
  uint64_t key = gf_cache_key(q);
  gf_cache_entry *a = gf_cache__slot(c, key, 0), *b = gf_cache__slot(c, key, 1), *t;
  if (a->key == key) t = a;
  else if (b->key == key) t = b;
  else if (!a->key) t = a;
  else if (!b->key) t = b;
  else t = ((int32_t)(a->stored_ms - b->stored_ms) <= 0) ? a : b;   // replace the older
  memcpy(t->pkt, pkt, len);
  t->len = (uint16_t)len; t->qend = (uint16_t)q->question_end; t->key = key;
  t->stored_ms = now_ms; t->ttl_s = (uint32_t)ttl;
  c->stores++;
  return 1;
}

// A fresh cached answer for `q` written to out (TTLs aged, ID set to q->id). Returns its length,
// or 0 on a miss / expiry. `cap` must be at least GF_CACHE_PKT.
// `query` is the asker's packet: the question section is copied from it so a resolver using
// 0x20 case randomisation sees its own capitalisation echoed back, which it requires.
static inline size_t gf_cache_get(gf_cache_t *c, const gf_dns_q *q, const uint8_t *query, uint32_t now_ms,
                                  uint8_t *out, size_t cap) {
  if (!c->n || cap < GF_CACHE_PKT) { c->misses++; return 0; }
  uint64_t key = gf_cache_key(q);
  for (int way = 0; way < 2; way++) {
    gf_cache_entry *t = gf_cache__slot(c, key, way);
    if (t->key != key) continue;
    uint32_t age_s = (now_ms - t->stored_ms) / 1000u;
    if (age_s >= t->ttl_s) { t->key = 0; continue; }       // expired: free the slot, count a miss
    if (t->qend != q->question_end) { t->key = 0; continue; }   // cannot happen for one key; never serve a mismatch
    memcpy(out, t->pkt, t->len);
    gf_wr16(out, q->id);
    memcpy(out + GF_DNS_HDR, query + GF_DNS_HDR, q->question_end - GF_DNS_HDR);
    if (gf_dns_age_ttls(out, t->len, t->qend, age_s) != 0) { t->key = 0; continue; }
    // The RD bit follows the ASKER, not whoever populated the entry.
    uint16_t fl = gf_rd16(out + 2);
    fl = (uint16_t)((fl & ~0x0100u) | (q->rd ? 0x0100u : 0));
    gf_wr16(out + 2, fl);
    c->hits++;
    return t->len;
  }
  c->misses++;
  return 0;
}
