// Gate^Flame T1 - a deliberately tiny JSON reader/writer for the provisioning line protocol.
// (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
//
// The serial provisioning protocol (gf-t1-prov/1) is one FLAT JSON object per line:
//     {"op":"set","ssid":"Home","pass":"p\"w","level":"low"}
// so this reads exactly that and nothing more: an object of string / number / true / false /
// null values. Nesting, arrays and anything malformed are refused rather than guessed at.
// Pure C, no heap, shared with the host tests (server/tests/c/host_unit.c).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define GF_JSON_MAX_PAIRS 16
#define GF_JSON_KEY_MAX 24
#define GF_JSON_VAL_MAX 130

enum { GF_JSON_STR = 0, GF_JSON_NUM = 1, GF_JSON_BOOL = 2, GF_JSON_NULL = 3 };

typedef struct {
  char key[GF_JSON_KEY_MAX];
  char val[GF_JSON_VAL_MAX];   // unescaped; "true"/"false" for booleans, the digits for numbers
  uint8_t kind;
} gf_json_kv;

typedef struct {
  gf_json_kv kv[GF_JSON_MAX_PAIRS];
  int n;
} gf_json_obj;

static inline int gf__hex(char c) {
  return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}
static inline const char *gf__ws(const char *p, const char *e) { while (p < e && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++; return p; }

static inline int gf__utf8(uint32_t cp, char *out, size_t cap, size_t at) {
  if (cp < 0x80) { if (at + 1 >= cap) return -1; out[at] = (char)cp; return 1; }
  if (cp < 0x800) { if (at + 2 >= cap) return -1; out[at] = (char)(0xC0 | (cp >> 6)); out[at + 1] = (char)(0x80 | (cp & 0x3F)); return 2; }
  if (cp < 0x10000) { if (at + 3 >= cap) return -1; out[at] = (char)(0xE0 | (cp >> 12)); out[at + 1] = (char)(0x80 | ((cp >> 6) & 0x3F)); out[at + 2] = (char)(0x80 | (cp & 0x3F)); return 3; }
  if (at + 4 >= cap) return -1;
  out[at] = (char)(0xF0 | (cp >> 18)); out[at + 1] = (char)(0x80 | ((cp >> 12) & 0x3F));
  out[at + 2] = (char)(0x80 | ((cp >> 6) & 0x3F)); out[at + 3] = (char)(0x80 | (cp & 0x3F));
  return 4;
}

// Read one JSON string starting AT the opening quote. Returns the pointer after the closing
// quote, or NULL on a malformed or oversized string. The result is NUL-terminated in out.
static inline const char *gf__str(const char *p, const char *e, char *out, size_t cap) {
  if (p >= e || *p != '"') return NULL;
  p++;
  size_t n = 0;
  while (p < e) {
    unsigned char c = (unsigned char)*p++;
    if (c == '"') { out[n] = 0; return p; }
    if (c < 0x20) return NULL;                           // raw control characters are not JSON
    if (c != '\\') { if (n + 1 >= cap) return NULL; out[n++] = (char)c; continue; }
    if (p >= e) return NULL;
    char x = *p++;
    uint32_t cp;
    switch (x) {
      case '"': cp = '"'; break;  case '\\': cp = '\\'; break; case '/': cp = '/'; break;
      case 'b': cp = 8; break;    case 'f': cp = 12; break;    case 'n': cp = 10; break;
      case 'r': cp = 13; break;   case 't': cp = 9; break;
      case 'u': {
        if (p + 4 > e) return NULL;
        cp = 0;
        for (int i = 0; i < 4; i++) { int h = gf__hex(p[i]); if (h < 0) return NULL; cp = (cp << 4) | (uint32_t)h; }
        p += 4;
        if (cp >= 0xD800 && cp < 0xDC00) {                // high surrogate: needs \uDC00..DFFF next
          if (p + 6 > e || p[0] != '\\' || p[1] != 'u') return NULL;
          uint32_t lo = 0;
          for (int i = 0; i < 4; i++) { int h = gf__hex(p[2 + i]); if (h < 0) return NULL; lo = (lo << 4) | (uint32_t)h; }
          if (lo < 0xDC00 || lo > 0xDFFF) return NULL;
          cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          p += 6;
        } else if (cp >= 0xDC00 && cp <= 0xDFFF) return NULL;
        break;
      }
      default: return NULL;
    }
    int w = gf__utf8(cp, out, cap, n);
    if (w < 0) return NULL;
    n += (size_t)w;
  }
  return NULL;                                            // no closing quote
}

// 0 = parsed. Negative: -1 not an object, -2 bad key, -3 bad value, -4 too many pairs, -5 trailing junk.
static inline int gf_json_parse(const char *s, size_t len, gf_json_obj *o) {
  const char *p = s, *e = s + len;
  o->n = 0;
  p = gf__ws(p, e);
  if (p >= e || *p != '{') return -1;
  p = gf__ws(p + 1, e);
  if (p < e && *p == '}') { p = gf__ws(p + 1, e); return p == e ? 0 : -5; }
  for (;;) {
    if (o->n >= GF_JSON_MAX_PAIRS) return -4;
    gf_json_kv *kv = &o->kv[o->n];
    p = gf__ws(p, e);
    p = gf__str(p, e, kv->key, sizeof kv->key);
    if (!p) return -2;
    p = gf__ws(p, e);
    if (p >= e || *p != ':') return -2;
    p = gf__ws(p + 1, e);
    if (p >= e) return -3;
    if (*p == '"') {
      kv->kind = GF_JSON_STR;
      p = gf__str(p, e, kv->val, sizeof kv->val);
      if (!p) return -3;
    } else if ((e - p) >= 4 && !strncmp(p, "true", 4)) { kv->kind = GF_JSON_BOOL; strcpy(kv->val, "true"); p += 4; }
    else if ((e - p) >= 5 && !strncmp(p, "false", 5)) { kv->kind = GF_JSON_BOOL; strcpy(kv->val, "false"); p += 5; }
    else if ((e - p) >= 4 && !strncmp(p, "null", 4)) { kv->kind = GF_JSON_NULL; kv->val[0] = 0; p += 4; }
    else if (*p == '-' || (*p >= '0' && *p <= '9')) {
      size_t n = 0;
      kv->kind = GF_JSON_NUM;
      while (p < e && ((*p >= '0' && *p <= '9') || *p == '-' || *p == '+' || *p == '.' || *p == 'e' || *p == 'E')) {
        if (n + 1 >= sizeof kv->val) return -3;
        kv->val[n++] = *p++;
      }
      kv->val[n] = 0;
    } else return -3;                                     // arrays, objects, anything else
    o->n++;
    p = gf__ws(p, e);
    if (p < e && *p == ',') { p++; continue; }
    if (p < e && *p == '}') { p = gf__ws(p + 1, e); return p == e ? 0 : -5; }
    return -3;
  }
}

static inline const gf_json_kv *gf_json_find(const gf_json_obj *o, const char *key) {
  for (int i = 0; i < o->n; i++) if (!strcmp(o->kv[i].key, key)) return &o->kv[i];
  return NULL;
}
// The string value of `key`, or NULL when absent / null / not a string.
static inline const char *gf_json_str(const gf_json_obj *o, const char *key) {
  const gf_json_kv *kv = gf_json_find(o, key);
  return kv && kv->kind == GF_JSON_STR ? kv->val : NULL;
}

// Escape `in` for embedding between the quotes of a JSON string. Returns the length written
// (NUL-terminated), or 0 if it would not fit.
static inline size_t gf_json_escape(const char *in, char *out, size_t cap) {
  size_t n = 0;
  static const char H[] = "0123456789abcdef";
  for (const unsigned char *p = (const unsigned char *)in; *p; p++) {
    if (*p == '"' || *p == '\\') { if (n + 3 > cap) return 0; out[n++] = '\\'; out[n++] = (char)*p; }
    else if (*p == '\n') { if (n + 3 > cap) return 0; out[n++] = '\\'; out[n++] = 'n'; }
    else if (*p == '\r') { if (n + 3 > cap) return 0; out[n++] = '\\'; out[n++] = 'r'; }
    else if (*p == '\t') { if (n + 3 > cap) return 0; out[n++] = '\\'; out[n++] = 't'; }
    else if (*p < 0x20) { if (n + 7 > cap) return 0; memcpy(out + n, "\\u00", 4); n += 4; out[n++] = H[*p >> 4]; out[n++] = H[*p & 15]; }
    else { if (n + 2 > cap) return 0; out[n++] = (char)*p; }
  }
  if (n + 1 > cap) return 0;
  out[n] = 0;
  return n;
}
