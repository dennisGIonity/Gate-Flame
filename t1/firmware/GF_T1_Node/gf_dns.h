// Gate^Flame T1 - minimal DNS wire handling. Shared by the firmware and the host test.
// (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
//
// Only what a filtering forwarder needs: read the first question of a query, and
// synthesise a reply to it. Allowed queries are forwarded to the upstream untouched
// except for the 16-bit ID, which the forwarder rewrites and restores.
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
#define GF_QTYPE_AAAA 28
#define GF_RCODE_NOERROR 0
#define GF_RCODE_SERVFAIL 2
#define GF_BLOCK_TTL 2

typedef struct {
  uint16_t id;
  uint16_t qtype;
  uint16_t qclass;
  size_t question_end;   // offset just past QTYPE/QCLASS of question 1
  size_t name_len;
  char name[256];        // dotted, as sent (case preserved), no trailing dot
} gf_dns_q;

static inline uint16_t gf_rd16(const uint8_t *p) { return (uint16_t)((p[0] << 8) | p[1]); }
static inline void gf_wr16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)(v >> 8); p[1] = (uint8_t)v; }

// 0 = a standard query we can act on; negative = malformed or not a query.
static inline int gf_dns_parse_query(const uint8_t *pkt, size_t len, gf_dns_q *q) {
  if (len < GF_DNS_HDR + 5) return -1;
  uint16_t flags = gf_rd16(pkt + 2);
  if (flags & 0x8000) return -2;              // QR=1: a response, not a query
  if ((flags >> 11) & 0xF) return -3;         // opcode must be QUERY
  if (gf_rd16(pkt + 4) < 1) return -4;        // QDCOUNT
  q->id = gf_rd16(pkt);
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
  return 0;
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
