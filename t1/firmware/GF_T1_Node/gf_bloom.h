// Gate^Flame T1 - Bloom filter lookup. Shared by the ESP32 firmware and the host test
// (t1/server/tests/c/), so the device and the server builder can never disagree.
// (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
//
// FILE FORMAT (little-endian), written by t1/server/t1server/bloom.py:
//   0  char[8]  magic "GFT1BLM\0"
//   8  u16      format version (1)
//  10  u8       k (hash count)
//  11  u8       reserved (0)
//  12  u32      m (bits)
//  16  u32      n (domains inserted)
//  20  u32      list version (unix seconds of the build)
//  24  char[8]  level ("low", "medium", "high"), NUL padded
//  32  u8[(m+7)/8] bit array, bit i = byte[i>>3] & (1 << (i&7))
//
// HASH: SHA-256 over the normalised domain (lower case, no trailing dot).
//   h1 = u64 LE of digest[0..8), h2 = u64 LE of digest[8..16) | 1
//   probe i (0..k-1) = (h1 + i*h2) mod 2^64 mod m
// Matching is EXACT - the same as Pi-hole gravity on the T3 box, so one list set
// means the same thing on every tier. No parent-domain matching.
//
// The caller supplies SHA-256 through gf_sha256_fn: mbedTLS (hardware SHA) on the
// ESP32, a portable implementation in the host test.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define GF_BLOOM_MAGIC "GFT1BLM"
#define GF_BLOOM_HEADER 32
#define GF_BLOOM_FORMAT 1
#define GF_DOMAIN_MAX 253

typedef void (*gf_sha256_fn)(const uint8_t *data, size_t len, uint8_t out[32]);

typedef struct {
  const uint8_t *bits;   // points INTO the loaded file, after the header
  uint32_t m;
  uint32_t n;
  uint32_t version;
  uint8_t k;
  char level[9];
} gf_bloom_t;

static inline uint32_t gf_rd32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static inline uint64_t gf_rd64(const uint8_t *p) {
  return (uint64_t)gf_rd32(p) | ((uint64_t)gf_rd32(p + 4) << 32);
}

// Validate a whole file image and fill `out`. Returns 0 or a negative error code.
static inline int gf_bloom_open(gf_bloom_t *out, const uint8_t *buf, size_t len) {
  if (len < GF_BLOOM_HEADER) return -1;
  if (memcmp(buf, GF_BLOOM_MAGIC, 8) != 0) return -2;          // includes the NUL
  if ((buf[8] | (buf[9] << 8)) != GF_BLOOM_FORMAT) return -3;
  uint8_t k = buf[10];
  uint32_t m = gf_rd32(buf + 12);
  if (k == 0 || k > 32 || m == 0) return -4;
  if (len != (size_t)GF_BLOOM_HEADER + ((size_t)m + 7) / 8) return -5;
  out->bits = buf + GF_BLOOM_HEADER;
  out->k = k;
  out->m = m;
  out->n = gf_rd32(buf + 16);
  out->version = gf_rd32(buf + 20);
  memcpy(out->level, buf + 24, 8);
  out->level[8] = 0;
  return 0;
}

// Lower-case, strip one trailing dot. Returns length, or -1 if not a plausible name.
static inline int gf_normalise(const char *in, size_t len, char *out /* >= 254 */) {
  if (len > 0 && in[len - 1] == '.') len--;
  if (len == 0 || len > GF_DOMAIN_MAX) return -1;
  for (size_t i = 0; i < len; i++) {
    char c = in[i];
    if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
    out[i] = c;
  }
  out[len] = 0;
  return (int)len;
}

// The two 64-bit halves every lookup (and the allow-list) is keyed on.
static inline void gf_domain_hash(gf_sha256_fn sha, const char *norm, size_t len,
                                  uint64_t *h1, uint64_t *h2) {
  uint8_t d[32];
  sha((const uint8_t *)norm, len, d);
  *h1 = gf_rd64(d);
  *h2 = gf_rd64(d + 8) | 1ULL;
}

static inline int gf_bloom_has_hash(const gf_bloom_t *b, uint64_t h1, uint64_t h2) {
  for (uint32_t i = 0; i < b->k; i++) {
    uint64_t idx = (h1 + (uint64_t)i * h2) % (uint64_t)b->m;
    if (!(b->bits[idx >> 3] & (1u << (idx & 7)))) return 0;
  }
  return 1;
}

// 1 = in the filter (blocked unless allow-listed), 0 = not, -1 = unusable name.
static inline int gf_bloom_lookup(const gf_bloom_t *b, gf_sha256_fn sha, const char *name, size_t len) {
  char norm[GF_DOMAIN_MAX + 1];
  int n = gf_normalise(name, len, norm);
  if (n < 0) return -1;
  uint64_t h1, h2;
  gf_domain_hash(sha, norm, (size_t)n, &h1, &h2);
  return gf_bloom_has_hash(b, h1, h2);
}

// Allow-list: a SORTED array of h1 values. Binary search.
static inline int gf_allow_has(const uint64_t *keys, size_t count, uint64_t h1) {
  size_t lo = 0, hi = count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (keys[mid] == h1) return 1;
    if (keys[mid] < h1) lo = mid + 1; else hi = mid;
  }
  return 0;
}
