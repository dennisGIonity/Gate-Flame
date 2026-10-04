// Unit tests for the FIRMWARE's pure-C headers: gf_json.h, gf_cache.h and the DNS-over-TCP /
// TTL / captive-answer parts of gf_dns.h. Compiled and run by server/tests/test_t1_firmware_c.py
// with -Wall -Werror, so the code that ships on the board is the code under test.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../../firmware/GF_T1_Node/gf_json.h"
#include "../../../firmware/GF_T1_Node/gf_cache.h"

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); } } while (0)

// ── helpers: build a query and an answer ────────────────────────────────────────────────
static size_t mkq(uint8_t *q, const char *name, uint16_t qtype, uint16_t id, int edns, int dobit) {
  size_t o = GF_DNS_HDR; memset(q, 0, 512);
  gf_wr16(q, id); q[2] = 0x01; gf_wr16(q + 4, 1);
  const char *s = name;
  while (*s) { const char *dot = strchr(s, '.'); size_t l = dot ? (size_t)(dot - s) : strlen(s);
    q[o++] = (uint8_t)l; memcpy(q + o, s, l); o += l; s += l; if (*s == '.') s++; }
  q[o++] = 0; gf_wr16(q + o, qtype); gf_wr16(q + o + 2, 1); o += 4;
  if (edns) {
    gf_wr16(q + 10, 1);
    q[o++] = 0; gf_wr16(q + o, GF_QTYPE_OPT); gf_wr16(q + o + 2, 1232);
    q[o + 4] = 0; q[o + 5] = 0; q[o + 6] = dobit ? 0x80 : 0; q[o + 7] = 0; gf_wr16(q + o + 8, 0); o += 10;
  }
  return o;
}

// An answer to `q` with one A record of the given TTL.
static size_t mka(uint8_t *a, const uint8_t *q, size_t qlen, const gf_dns_q *pq, uint32_t ttl, uint8_t rcode) {
  memcpy(a, q, pq->question_end);
  gf_wr16(a + 2, (uint16_t)(0x8180 | rcode));
  gf_wr16(a + 4, 1); gf_wr16(a + 6, rcode ? 0 : 1); gf_wr16(a + 8, 0); gf_wr16(a + 10, 0);
  (void)qlen;
  size_t o = pq->question_end;
  if (!rcode) {
    a[o] = 0xC0; a[o + 1] = 0x0C; gf_wr16(a + o + 2, GF_QTYPE_A); gf_wr16(a + o + 4, 1);
    gf_wr32be(a + o + 6, ttl); gf_wr16(a + o + 10, 4); a[o + 12] = 93; a[o + 13] = 184; a[o + 14] = 216; a[o + 15] = 34;
    o += 16;
  } else {                                   // NXDOMAIN carrying an SOA with MINIMUM = ttl in the authority section
    gf_wr16(a + 8, 1);
    a[o++] = 0xC0; a[o++] = 0x0C; gf_wr16(a + o, GF_QTYPE_SOA); gf_wr16(a + o + 2, 1);
    gf_wr32be(a + o + 4, 3600); gf_wr16(a + o + 8, 22);
    o += 10;
    a[o++] = 0; a[o++] = 0;                  // mname ".", rname "."
    gf_wr32be(a + o, 1); gf_wr32be(a + o + 4, 2); gf_wr32be(a + o + 8, 3); gf_wr32be(a + o + 12, 4); gf_wr32be(a + o + 16, ttl);
    o += 20;
  }
  return o;
}

static void test_json(void) {
  gf_json_obj o;
  const char *a = "{\"op\":\"set\",\"ssid\":\"Home Net\",\"pass\":\"p\\\"w\\\\x\",\"n\":12,\"on\":true,\"x\":null}";
  CHECK(gf_json_parse(a, strlen(a), &o) == 0);
  CHECK(o.n == 6);
  CHECK(!strcmp(gf_json_str(&o, "op"), "set"));
  CHECK(!strcmp(gf_json_str(&o, "ssid"), "Home Net"));
  CHECK(!strcmp(gf_json_str(&o, "pass"), "p\"w\\x"));
  CHECK(gf_json_find(&o, "n")->kind == GF_JSON_NUM && !strcmp(gf_json_find(&o, "n")->val, "12"));
  CHECK(gf_json_find(&o, "on")->kind == GF_JSON_BOOL);
  CHECK(gf_json_str(&o, "x") == NULL && gf_json_find(&o, "x")->kind == GF_JSON_NULL);
  CHECK(gf_json_str(&o, "absent") == NULL);
  CHECK(gf_json_str(&o, "n") == NULL);                                  // a number is not a string

  const char *u = "{\"s\":\"caf\\u00e9 \\ud83d\\ude00 \\u20ac\"}";      // é, 😀, €
  CHECK(gf_json_parse(u, strlen(u), &o) == 0);
  CHECK(!strcmp(gf_json_str(&o, "s"), "caf\xc3\xa9 \xf0\x9f\x98\x80 \xe2\x82\xac"));

  const char *bad[] = {
    "", "[]", "{", "{}x", "{\"a\"}", "{\"a\":}", "{\"a\":1,}", "{\"a\":[1]}", "{\"a\":{\"b\":1}}",
    "{\"a\":\"unterminated}", "{\"a\":\"\\q\"}", "{\"a\":\"\\ud83d\"}", "{\"a\":\"\\ude00\"}",
    "{\"a\":\"line\nbreak\"}", "{a:1}", "{\"a\":tru}", "{\"a\":1}{\"b\":2}", "{\"a\":\"\\u12\"}",
  };
  for (size_t i = 0; i < sizeof bad / sizeof *bad; i++) CHECK(gf_json_parse(bad[i], strlen(bad[i]), &o) < 0);
  CHECK(gf_json_parse("{}", 2, &o) == 0 && o.n == 0);
  CHECK(gf_json_parse("  { \"a\" : \"b\" }  ", 17, &o) == 0 && !strcmp(gf_json_str(&o, "a"), "b"));

  char big[300]; memset(big, 'x', sizeof big); big[299] = 0;
  char line[400]; snprintf(line, sizeof line, "{\"a\":\"%s\"}", big);
  CHECK(gf_json_parse(line, strlen(line), &o) == -3);                   // a value longer than a Wi-Fi password + slack
  char many[400] = "{"; for (int i = 0; i < 17; i++) { char t[24]; snprintf(t, sizeof t, "%s\"k%d\":1", i ? "," : "", i); strcat(many, t); } strcat(many, "}");
  CHECK(gf_json_parse(many, strlen(many), &o) == -4);

  char esc[64];
  CHECK(gf_json_escape("a\"b\\c\n\x01", esc, sizeof esc) > 0 && !strcmp(esc, "a\\\"b\\\\c\\n\\u0001"));
  CHECK(gf_json_escape("0123456789", esc, 5) == 0);                    // does not fit: refused, not truncated
  // Round trip: whatever is escaped parses back to the same bytes.
  const char *tricky = "pa\"ss\\w\tord\x1f""é";
  char wire[200], full[256];
  CHECK(gf_json_escape(tricky, wire, sizeof wire) > 0);
  snprintf(full, sizeof full, "{\"p\":\"%s\"}", wire);
  CHECK(gf_json_parse(full, strlen(full), &o) == 0 && !strcmp(gf_json_str(&o, "p"), tricky));
}

static void test_ttl_and_tcp(void) {
  uint8_t q[600], a[600]; gf_dns_q pq;
  size_t ql = mkq(q, "example.com", GF_QTYPE_A, 0x1234, 0, 0);
  CHECK(gf_dns_parse_query(q, ql, &pq) == 0);
  size_t al = mka(a, q, ql, &pq, 300, 0);
  CHECK(gf_dns_min_ttl(a, al, pq.question_end) == 300);
  CHECK(gf_dns_age_ttls(a, al, pq.question_end, 100) == 0);
  CHECK(gf_dns_min_ttl(a, al, pq.question_end) == 200);
  CHECK(gf_dns_age_ttls(a, al, pq.question_end, 5000) == 0);
  CHECK(gf_dns_min_ttl(a, al, pq.question_end) == 0);                   // never below zero
  CHECK(gf_dns_min_ttl(a, al - 3, pq.question_end) == -1);              // truncated record: malformed

  size_t nl = mka(a, q, ql, &pq, 77, 3);
  CHECK(gf_dns_min_ttl(a, nl, pq.question_end) == 77);                  // negative answer: SOA MINIMUM wins over its 3600 TTL

  gf_dns_q rq; CHECK(gf_dns_parse_msg(a, nl, &rq, 1) == 0 && gf_dns_parse_msg(a, nl, &rq, 0) < 0);

  // DNS over TCP framing, fed one byte at a time and in odd chunks.
  uint8_t msg[200], framed[210], rxbuf[300]; for (int i = 0; i < 100; i++) msg[i] = (uint8_t)i;
  size_t fl = gf_tcp_frame(framed, sizeof framed, msg, 100);
  CHECK(fl == 102 && framed[0] == 0 && framed[1] == 100 && !memcmp(framed + 2, msg, 100));
  gf_tcp_rx rx; gf_tcp_rx_init(&rx, rxbuf, sizeof rxbuf);
  size_t used; int rc = 0;
  for (size_t i = 0; i < fl; i++) { rc = gf_tcp_rx_feed(&rx, framed + i, 1, &used); CHECK(used == 1); if (i + 1 < fl) CHECK(rc == 0); }
  CHECK(rc == 1 && rx.need == 100 && !memcmp(rxbuf, msg, 100));
  // Two messages back to back in one read: the second must be left for the next call.
  uint8_t two[400]; memcpy(two, framed, fl); memcpy(two + fl, framed, fl);
  gf_tcp_rx_reset(&rx);
  rc = gf_tcp_rx_feed(&rx, two, 2 * fl, &used);
  CHECK(rc == 1 && used == fl);
  gf_tcp_rx_reset(&rx);
  rc = gf_tcp_rx_feed(&rx, two + used, 2 * fl - used, &used);
  CHECK(rc == 1 && used == fl);
  uint8_t zero[2] = {0, 0}; gf_tcp_rx_reset(&rx);
  CHECK(gf_tcp_rx_feed(&rx, zero, 2, &used) == -1);                      // length 0: close
  uint8_t huge[2] = {0xFF, 0xFF}; gf_tcp_rx_reset(&rx);
  CHECK(gf_tcp_rx_feed(&rx, huge, 2, &used) == -1);                      // larger than the buffer: close
  CHECK(gf_tcp_frame(framed, 10, msg, 100) == 0 && gf_tcp_frame(framed, 210, msg, 0) == 0);

  // The captive answer: every A query -> the portal address, TTL 0; other types -> NOERROR/no data.
  const uint8_t ip[4] = {192, 168, 4, 1}; uint8_t out[300];
  CHECK(gf_dns_parse_query(q, ql, &pq) == 0);
  size_t cl = gf_dns_build_a_answer(q, &pq, ip, 0, out, sizeof out);
  CHECK(cl == pq.question_end + 16 && !memcmp(out + cl - 4, ip, 4) && gf_rd32be(out + cl - 10) == 0);
  uint8_t q6[512]; size_t q6l = mkq(q6, "example.com", GF_QTYPE_AAAA, 7, 0, 0); gf_dns_q p6;
  CHECK(gf_dns_parse_query(q6, q6l, &p6) == 0);
  cl = gf_dns_build_a_answer(q6, &p6, ip, 0, out, sizeof out);
  CHECK(cl == p6.question_end && gf_rd16(out + 6) == 0 && (out[3] & 0xF) == 0);
}

static gf_cache_entry cmem[64];

static void test_cache(void) {
  gf_cache_t c; gf_cache_init(&c, cmem, 64);
  uint8_t q[600], a[600], got[GF_CACHE_PKT]; gf_dns_q pq;
  size_t ql = mkq(q, "Example.COM", GF_QTYPE_A, 0x1111, 0, 0);
  CHECK(gf_dns_parse_query(q, ql, &pq) == 0);
  size_t al = mka(a, q, ql, &pq, 300, 0);

  CHECK(gf_cache_get(&c, &pq, q, 1000, got, sizeof got) == 0 && c.misses == 1);
  CHECK(gf_cache_put(&c, &pq, a, al, 1000) == 1);

  // A different asker: different ID, different capitalisation, RD off.
  uint8_t q2[600]; gf_dns_q p2;
  size_t q2l = mkq(q2, "eXaMpLe.cOm", GF_QTYPE_A, 0xBEEF, 0, 0); q2[2] = 0;
  CHECK(gf_dns_parse_query(q2, q2l, &p2) == 0);
  size_t gl = gf_cache_get(&c, &p2, q2, 1000 + 42 * 1000, got, sizeof got);
  CHECK(gl == al);
  CHECK(gf_rd16(got) == 0xBEEF);                                         // the asker's ID
  CHECK(!memcmp(got + GF_DNS_HDR, q2 + GF_DNS_HDR, p2.question_end - GF_DNS_HDR));   // 0x20: its own capitalisation back
  CHECK((got[2] & 0x01) == 0);                                           // RD follows the asker
  CHECK(gf_dns_min_ttl(got, gl, p2.question_end) == 300 - 42);          // TTL aged by the 42 s it sat
  CHECK(c.hits == 1);

  CHECK(gf_cache_get(&c, &p2, q2, 1000 + 300 * 1000, got, sizeof got) == 0);          // expired exactly at TTL
  CHECK(gf_cache_get(&c, &p2, q2, 1000 + 1, got, sizeof got) == 0);                    // and the slot was freed

  // EDNS / DO bit are part of the key: a DO client is never served a non-DO answer.
  gf_cache_init(&c, cmem, 64);
  gf_cache_put(&c, &pq, a, al, 0);
  uint8_t qd[600]; gf_dns_q pd; size_t qdl = mkq(qd, "example.com", GF_QTYPE_A, 9, 1, 1);
  CHECK(gf_dns_parse_query(qd, qdl, &pd) == 0 && pd.do_bit == 1);
  CHECK(gf_cache_get(&c, &pd, qd, 10, got, sizeof got) == 0);
  CHECK(gf_cache_get(&c, &pq, q, 10, got, sizeof got) > 0);
  // ... and a different type is a different entry.
  uint8_t q6[512]; gf_dns_q p6; size_t q6l = mkq(q6, "example.com", GF_QTYPE_AAAA, 9, 0, 0);
  CHECK(gf_dns_parse_query(q6, q6l, &p6) == 0 && gf_cache_get(&c, &p6, q6, 10, got, sizeof got) == 0);

  // What is NOT cached.
  gf_cache_init(&c, cmem, 64);
  size_t zl = mka(a, q, ql, &pq, 0, 0);
  CHECK(gf_cache_put(&c, &pq, a, zl, 0) == 0);                           // TTL 0
  al = mka(a, q, ql, &pq, 300, 0); a[3] = (uint8_t)((a[3] & 0xF0) | GF_RCODE_SERVFAIL);
  CHECK(gf_cache_put(&c, &pq, a, al, 0) == 0);                           // SERVFAIL
  al = mka(a, q, ql, &pq, 300, 0); a[2] |= 0x02;
  CHECK(gf_cache_put(&c, &pq, a, al, 0) == 0);                           // truncated (TC)
  al = mka(a, q, ql, &pq, 300, 0); a[2] &= (uint8_t)~0x80;
  CHECK(gf_cache_put(&c, &pq, a, al, 0) == 0);                           // not a response
  uint8_t big[700]; al = mka(big, q, ql, &pq, 300, 0);
  CHECK(gf_cache_put(&c, &pq, big, GF_CACHE_PKT + 1, 0) == 0);           // would not fit 512
  CHECK(c.stores == 0);

  // NXDOMAIN is cached for the SOA MINIMUM, not the SOA record's own TTL.
  al = mka(a, q, ql, &pq, 60, 3);
  CHECK(gf_cache_put(&c, &pq, a, al, 0) == 1);
  gl = gf_cache_get(&c, &pq, q, 59 * 1000, got, sizeof got);
  CHECK(gl == al && (got[3] & 0xF) == GF_RCODE_NXDOMAIN);
  CHECK(gf_cache_get(&c, &pq, q, 60 * 1000, got, sizeof got) == 0);

  // TTL is capped at an hour.
  gf_cache_init(&c, cmem, 64);
  al = mka(a, q, ql, &pq, 86400, 0);
  CHECK(gf_cache_put(&c, &pq, a, al, 0) == 1);
  CHECK(gf_cache_get(&c, &pq, q, 3599 * 1000, got, sizeof got) > 0);
  CHECK(gf_cache_get(&c, &pq, q, 3600 * 1000, got, sizeof got) == 0);

  // Millisecond clock wrap (49 days): an entry stored just before the wrap is still aged correctly.
  gf_cache_init(&c, cmem, 64);
  al = mka(a, q, ql, &pq, 300, 0);
  CHECK(gf_cache_put(&c, &pq, a, al, 0xFFFFFC18u) == 1);                 // 1000 ms before the wrap
  gl = gf_cache_get(&c, &pq, q, 4000, got, sizeof got);                  // 5 s later, after the wrap
  CHECK(gl == al && gf_dns_min_ttl(got, gl, pq.question_end) == 295);

  // Two names landing in the same set both survive; a third evicts the OLDER one.
  gf_cache_init(&c, cmem, 2);                                            // ONE set of two ways: everything collides
  gf_dns_q pa, pb, pc; uint8_t qa[512], qb[512], qc[512], aa[600], ab[600], ac[600];
  size_t qal = mkq(qa, "a.example", GF_QTYPE_A, 1, 0, 0), qbl = mkq(qb, "b.example", GF_QTYPE_A, 2, 0, 0), qcl = mkq(qc, "c.example", GF_QTYPE_A, 3, 0, 0);
  gf_dns_parse_query(qa, qal, &pa); gf_dns_parse_query(qb, qbl, &pb); gf_dns_parse_query(qc, qcl, &pc);
  size_t aal = mka(aa, qa, qal, &pa, 300, 0), abl = mka(ab, qb, qbl, &pb, 300, 0), acl = mka(ac, qc, qcl, &pc, 300, 0);
  gf_cache_put(&c, &pa, aa, aal, 100); gf_cache_put(&c, &pb, ab, abl, 200);
  CHECK(gf_cache_get(&c, &pa, qa, 300, got, sizeof got) > 0 && gf_cache_get(&c, &pb, qb, 300, got, sizeof got) > 0);
  gf_cache_put(&c, &pc, ac, acl, 400);
  CHECK(gf_cache_get(&c, &pa, qa, 500, got, sizeof got) == 0);           // oldest (a) gone
  CHECK(gf_cache_get(&c, &pb, qb, 500, got, sizeof got) > 0 && gf_cache_get(&c, &pc, qc, 500, got, sizeof got) > 0);
  // Putting the same name again replaces in place, it does not take a second slot.
  gf_cache_put(&c, &pb, ab, abl, 600); gf_cache_put(&c, &pb, ab, abl, 700);
  CHECK(gf_cache_get(&c, &pc, qc, 800, got, sizeof got) > 0);

  // A zero-size cache is a safe no-op.
  gf_cache_t z; gf_cache_init(&z, cmem, 0);
  CHECK(gf_cache_put(&z, &pq, a, al, 0) == 0 && gf_cache_get(&z, &pq, q, 0, got, sizeof got) == 0);
}

int main(void) {
  test_json();
  test_ttl_and_tcp();
  test_cache();
  printf("%d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
