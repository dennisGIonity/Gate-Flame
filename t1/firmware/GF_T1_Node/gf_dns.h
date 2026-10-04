// Gate^Flame T1 - minimal DNS wire handling. Shared by the firmware and the host test.
// (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
//
// Only what a filtering forwarder needs:
//   - read the first question of a query, and its EDNS flags (for the response cache key)
//   - synthesise a reply to it (blocked, SERVFAIL, or the setup hotspot's captive answer)
//   - walk the records of an upstream answer (minimum TTL; age TTLs when served from cache)
//   - frame messages for DNS over TCP (RFC 7766: a 2-byte big-endian length before each one)
// Allowed queries are forwarded to the upstream untouched except for the 16-bit ID, which
// the UDP forwarder rewrites and restores.
//
// Blocked replies follow Pi-hole's default NULL mode so a household sees the same
// behaviour on every tier: A -> 0.0.0.0, AAAA -> ::, anything else -> NOERROR with no
// answer. TTL 2 s, as Pi-hole uses, so an allow-list change bites within seconds.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define GF_DNS_HDR 12
#define GF_QTYPE_A 1
#define GF_QTYPE_SOA 6
#define GF_QTYPE_AAAA 28
#define GF_QTYPE_OPT 41
#define GF_RCODE_NOERROR 0
#define GF_RCODE_SERVFAIL 2
#define GF_RCODE_NXDOMAIN 3
#define GF_BLOCK_TTL 2

typedef struct {
  uint16_t id;
  uint16_t qtype;
  uint16_t qclass;
  size_t question_end;   // offset just past QTYPE/QCLASS of question 1
  size_t name_len;
  char name[256];        // dotted, as sent (case preserved), no trailing dot
  uint8_t rd, cd;        // header flags: recursion desired, checking disabled
  uint8_t edns, do_bit;  // an OPT record follows the question; its DNSSEC-OK bit
  uint16_t edns_size;    // requestor's UDP payload size (0 = no EDNS)
} gf_dns_q;

static inline uint16_t gf_rd16(const uint8_t *p) { return (uint16_t)((p[0] << 8) | p[1]); }
static inline uint32_t gf_rd32be(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}
static inline void gf_wr16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)(v >> 8); p[1] = (uint8_t)v; }
static inline void gf_wr32be(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24); p[1] = (uint8_t)(v >> 16); p[2] = (uint8_t)(v >> 8); p[3] = (uint8_t)v;
}

// Question 1 of a message. want_response 0 = must be a standard query, 1 = must be a response.
// 0 = parsed; negative = malformed or the wrong kind of message.
static inline int gf_dns_parse_msg(const uint8_t *pkt, size_t len, gf_dns_q *q, int want_response) {
  if (len < GF_DNS_HDR + 5) return -1;
  uint16_t flags = gf_rd16(pkt + 2);
  if (((flags & 0x8000) ? 1 : 0) != (want_response ? 1 : 0)) return -2;   // QR bit
  if ((flags >> 11) & 0xF) return -3;         // opcode must be QUERY
  if (gf_rd16(pkt + 4) < 1) return -4;        // QDCOUNT
  q->id = gf_rd16(pkt);
  q->rd = (pkt[2] & 0x01) ? 1 : 0;
  q->cd = (pkt[3] & 0x10) ? 1 : 0;
  size_t off = GF_DNS_HDR, out = 0;
  for (;;) {
    if (off >= len) return -5;
    uint8_t l = pkt[off++];
    if (l == 0) break;
    if (l & 0xC0) return -6;                  // no compression inside a question
    if (off + l > len || out + l + 1 > 255) return -7;
    if (out) q->name[out++] = '.';
    memcpy(q->name + out, pkt + off, l);
    out += l;
    off += l;
  }
  if (off + 4 > len) return -8;
  q->name[out] = 0;
  q->name_len = out;
  q->qtype = gf_rd16(pkt + off);
  q->qclass = gf_rd16(pkt + off + 2);
  q->question_end = off + 4;
  q->edns = 0;
  q->do_bit = 0;
  q->edns_size = 0;
  // EDNS (RFC 6891): a query carries at most one additional record, the OPT pseudo-RR, right
  // after the question. A malformed OPT is not a reason to drop the query - it is simply not
  // recognised, and the query is forwarded untouched as before.
  if (!want_response && gf_rd16(pkt + 4) == 1 && gf_rd16(pkt + 6) == 0 && gf_rd16(pkt + 8) == 0 &&
      gf_rd16(pkt + 10) >= 1) {
    size_t o = q->question_end;
    if (o + 11 <= len && pkt[o] == 0 && gf_rd16(pkt + o + 1) == GF_QTYPE_OPT) {
      q->edns = 1;
      q->edns_size = gf_rd16(pkt + o + 3);
      q->do_bit = (pkt[o + 7] & 0x80) ? 1 : 0;   // TTL field = ext-rcode, version, flags (DO = bit 15)
    }
  }
  return 0;
}

// 0 = a standard query we can act on; negative = malformed or not a query.
static inline int gf_dns_parse_query(const uint8_t *pkt, size_t len, gf_dns_q *q) {
  return gf_dns_parse_msg(pkt, len, q, 0);
}

// Header + first question copied from the query, then optional answer. Returns length or 0.
static inline size_t gf_dns_reply_head(const uint8_t *query, const gf_dns_q *q, uint8_t *out,
                                       size_t cap, uint8_t rcode, uint16_t ancount) {
  if (q->question_end > cap) return 0;
  memcpy(out, query, q->question_end);
  uint16_t rd = gf_rd16(query + 2) & 0x0100;
  gf_wr16(out + 2, (uint16_t)(0x8000 | rd | 0x0080 | (rcode & 0xF)));  // QR, RD copied, RA
  gf_wr16(out + 4, 1);          // QDCOUNT (we only answer question 1)
  gf_wr16(out + 6, ancount);
  gf_wr16(out + 8, 0);
  gf_wr16(out + 10, 0);         // EDNS OPT deliberately dropped
  return q->question_end;
}

static inline size_t gf_dns_build_block(const uint8_t *query, const gf_dns_q *q, uint8_t *out, size_t cap) {
  int has = (q->qtype == GF_QTYPE_A || q->qtype == GF_QTYPE_AAAA) && q->qclass == 1;
  size_t n = gf_dns_reply_head(query, q, out, cap, GF_RCODE_NOERROR, has ? 1 : 0);
  if (!n || !has) return n;
  uint16_t rdlen = q->qtype == GF_QTYPE_A ? 4 : 16;
  if (n + 12 + rdlen > cap) return 0;
  uint8_t *p = out + n;
  p[0] = 0xC0; p[1] = 0x0C;     // pointer to the question name
  gf_wr16(p + 2, q->qtype);
  gf_wr16(p + 4, 1);            // IN
  p[6] = 0; p[7] = 0; gf_wr16(p + 8, GF_BLOCK_TTL);
  gf_wr16(p + 10, rdlen);
  memset(p + 12, 0, rdlen);     // 0.0.0.0 / ::
  return n + 12 + rdlen;
}

// SERVFAIL tells the router "ask your other upstream now" - the ADR-001 fallback path.
static inline size_t gf_dns_build_servfail(const uint8_t *query, const gf_dns_q *q, uint8_t *out, size_t cap) {
  return gf_dns_reply_head(query, q, out, cap, GF_RCODE_SERVFAIL, 0);
}

// The setup hotspot's captive answer: every A query -> `ip4`, everything else NOERROR with no
// answer. TTL 0 so a phone does not keep the fake address once setup is over.
static inline size_t gf_dns_build_a_answer(const uint8_t *query, const gf_dns_q *q, const uint8_t ip4[4],
                                           uint32_t ttl, uint8_t *out, size_t cap) {
  int has = q->qtype == GF_QTYPE_A && q->qclass == 1;
  size_t n = gf_dns_reply_head(query, q, out, cap, GF_RCODE_NOERROR, has ? 1 : 0);
  if (!n || !has) return n;
  if (n + 16 > cap) return 0;
  uint8_t *p = out + n;
  p[0] = 0xC0; p[1] = 0x0C;
  gf_wr16(p + 2, GF_QTYPE_A);
  gf_wr16(p + 4, 1);
  gf_wr32be(p + 6, ttl);
  gf_wr16(p + 10, 4);
  memcpy(p + 12, ip4, 4);
  return n + 16;
}

// ── resource-record walking (response cache) ────────────────────────────────────────────
// Skip a possibly compressed name at `off`. Returns the offset after it, or 0 if malformed.
static inline size_t gf_dns_skip_name(const uint8_t *p, size_t len, size_t off) {
  for (int labels = 0; labels < 128; labels++) {
    if (off >= len) return 0;
    uint8_t l = p[off];
    if (l == 0) return off + 1;
    if ((l & 0xC0) == 0xC0) return off + 2 <= len ? off + 2 : 0;   // pointer ends the name
    if (l & 0xC0) return 0;                                          // 0x40/0x80 label types
    off += 1 + (size_t)l;
  }
  return 0;
}

// Visit every resource record after the question.
//   mode 0: return the minimum TTL of the records that carry one (OPT excluded; in a negative
//           answer the SOA also caps at its MINIMUM field, RFC 2308). -1 malformed, -2 none.
//   mode 1: subtract `elapsed` seconds from every TTL in place, never below 0. 0 or -1.
static inline long gf_dns_walk_ttls(uint8_t *p, size_t len, size_t question_end, int mode, uint32_t elapsed) {
  if (len < GF_DNS_HDR || question_end > len) return -1;
  uint32_t an = gf_rd16(p + 6), ns = gf_rd16(p + 8), ar = gf_rd16(p + 10);
  uint32_t total = an + ns + ar;
  size_t off = question_end;
  long best = -2;
  for (uint32_t i = 0; i < total; i++) {
    off = gf_dns_skip_name(p, len, off);
    if (!off || off + 10 > len) return -1;
    uint16_t type = gf_rd16(p + off);
    uint32_t ttl = gf_rd32be(p + off + 4);
    uint16_t rdlen = gf_rd16(p + off + 8);
    size_t rdata = off + 10;
    if (rdata + rdlen > len) return -1;
    if (type != GF_QTYPE_OPT) {                      // OPT's "TTL" is ext-rcode + flags
      if (ttl & 0x80000000u) ttl = 0;                // RFC 2181 section 8
      if (mode == 0) {
        uint32_t t = ttl;
        if (type == GF_QTYPE_SOA && an == 0 && rdlen >= 22) {
          uint32_t minimum = gf_rd32be(p + rdata + rdlen - 4);
          if (minimum < t) t = minimum;
        }
        if (best < 0 || (long)t < best) best = (long)t;
      } else {
        gf_wr32be(p + off + 4, ttl > elapsed ? ttl - elapsed : 0);
      }
    }
    off = rdata + rdlen;
  }
  return mode == 0 ? best : 0;
}

static inline long gf_dns_min_ttl(const uint8_t *p, size_t len, size_t question_end) {
  return gf_dns_walk_ttls((uint8_t *)p, len, question_end, 0, 0);   // mode 0 never writes
}

static inline int gf_dns_age_ttls(uint8_t *p, size_t len, size_t question_end, uint32_t elapsed) {
  return (int)gf_dns_walk_ttls(p, len, question_end, 1, elapsed);
}

// ── DNS over TCP framing (RFC 7766 section 8) ────────────────────────────────────────────
typedef struct {
  uint8_t *buf;
  uint16_t cap;
  uint16_t need;       // length of the message being received (0 = length not read yet)
  uint16_t got;
  uint8_t hdr[2];
  uint8_t hdr_got;
} gf_tcp_rx;

static inline void gf_tcp_rx_init(gf_tcp_rx *r, uint8_t *buf, uint16_t cap) {
  r->buf = buf; r->cap = cap; r->need = 0; r->got = 0; r->hdr_got = 0;
}
static inline void gf_tcp_rx_reset(gf_tcp_rx *r) { r->need = 0; r->got = 0; r->hdr_got = 0; }

// Feed received bytes. Returns 1 when a whole message is in r->buf (length r->need) - call
// gf_tcp_rx_reset() before feeding the rest -, 0 when more bytes are needed, -1 when the
// length is 0 or larger than the buffer (close the connection). *used = bytes consumed.
static inline int gf_tcp_rx_feed(gf_tcp_rx *r, const uint8_t *p, size_t n, size_t *used) {
  size_t i = 0;
  while (r->hdr_got < 2 && i < n) r->hdr[r->hdr_got++] = p[i++];
  if (r->hdr_got < 2) { *used = i; return 0; }
  if (!r->need) {
    r->need = gf_rd16(r->hdr);
    if (r->need == 0 || r->need > r->cap) { *used = i; return -1; }
  }
  size_t take = (size_t)(r->need - r->got);
  if (take > n - i) take = n - i;
  memcpy(r->buf + r->got, p + i, take);
  r->got = (uint16_t)(r->got + take);
  i += take;
  *used = i;
  return r->got == r->need ? 1 : 0;
}

// Length prefix + message into `out` (may be the same memory as msg + 2). Returns n + 2 or 0.
static inline size_t gf_tcp_frame(uint8_t *out, size_t cap, const uint8_t *msg, size_t n) {
  if (n == 0 || n > 0xFFFF || n + 2 > cap) return 0;
  memmove(out + 2, msg, n);
  gf_wr16(out, (uint16_t)n);
  return n + 2;
}
