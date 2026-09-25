// Host-side harness for the FIRMWARE's own headers. The Python tests compile and run
// this, so the device code and the server builder are proven to agree on real files.
//   host_test bloom <filter.bin> <domains.txt>   -> one 0/1/-1 per line
//   host_test dns <name> <qtype>                 -> hex of query and of block reply
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../../firmware/GF_T1_Node/gf_bloom.h"
#include "../../../firmware/GF_T1_Node/gf_dns.h"

// --- compact SHA-256 (FIPS 180-4), host only; the device uses mbedTLS ---
static const uint32_t K[64] = {
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define ROR(x,n) (((x)>>(n))|((x)<<(32-(n))))
static void blk(uint32_t h[8], const uint8_t *p) {
  uint32_t w[64], a,b,c,d,e,f,g,hh,t1,t2;
  for (int i=0;i<16;i++) w[i]=(uint32_t)p[4*i]<<24|(uint32_t)p[4*i+1]<<16|(uint32_t)p[4*i+2]<<8|p[4*i+3];
  for (int i=16;i<64;i++){uint32_t s0=ROR(w[i-15],7)^ROR(w[i-15],18)^(w[i-15]>>3),s1=ROR(w[i-2],17)^ROR(w[i-2],19)^(w[i-2]>>10);w[i]=w[i-16]+s0+w[i-7]+s1;}
  a=h[0];b=h[1];c=h[2];d=h[3];e=h[4];f=h[5];g=h[6];hh=h[7];
  for (int i=0;i<64;i++){t1=hh+(ROR(e,6)^ROR(e,11)^ROR(e,25))+((e&f)^(~e&g))+K[i]+w[i];t2=(ROR(a,2)^ROR(a,13)^ROR(a,22))+((a&b)^(a&c)^(b&c));hh=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}
  h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
}
static void sha256(const uint8_t *m, size_t n, uint8_t out[32]) {
  uint32_t h[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  uint8_t b[64]; size_t i=0;
  for (; i+64<=n; i+=64) blk(h, m+i);
  size_t r=n-i; memcpy(b,m+i,r); b[r++]=0x80;
  if (r>56){memset(b+r,0,64-r);blk(h,b);r=0;}
  memset(b+r,0,56-r); uint64_t bits=(uint64_t)n*8;
  for (int j=0;j<8;j++) b[63-j]=(uint8_t)(bits>>(8*j));
  blk(h,b);
  for (int j=0;j<8;j++){out[4*j]=h[j]>>24;out[4*j+1]=h[j]>>16;out[4*j+2]=h[j]>>8;out[4*j+3]=h[j];}
}

static int cmd_bloom(const char *fpath, const char *dpath) {
  FILE *f = fopen(fpath, "rb"); if (!f) return 2;
  fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
  uint8_t *buf = malloc(len); if (fread(buf, 1, len, f) != (size_t)len) return 3; fclose(f);
  gf_bloom_t b; int rc = gf_bloom_open(&b, buf, len);
  if (rc) { printf("open %d\n", rc); return 4; }
  FILE *d = fopen(dpath, "r"); char line[512];
  while (fgets(line, sizeof line, d)) {
    size_t n = strcspn(line, "\r\n"); line[n] = 0;
    printf("%d\n", gf_bloom_lookup(&b, sha256, line, n));
  }
  return 0;
}

static void hex(const uint8_t *p, size_t n) { for (size_t i=0;i<n;i++) printf("%02x", p[i]); printf("\n"); }

static int cmd_dns(const char *name, int qtype) {
  uint8_t q[512]; size_t o = GF_DNS_HDR;
  memset(q, 0, sizeof q); q[0]=0xAB; q[1]=0xCD; q[2]=0x01; /* RD */ q[5]=1; /* QDCOUNT */
  const char *s = name;
  while (*s) { const char *dot = strchr(s, '.'); size_t l = dot ? (size_t)(dot-s) : strlen(s);
    q[o++] = (uint8_t)l; memcpy(q+o, s, l); o += l; s += l; if (*s=='.') s++; }
  q[o++]=0; q[o++]=qtype>>8; q[o++]=qtype&0xff; q[o++]=0; q[o++]=1;
  hex(q, o);
  gf_dns_q pq; int rc = gf_dns_parse_query(q, o, &pq);
  printf("parse %d %s %u\n", rc, pq.name, pq.qtype);
  uint8_t r[600]; size_t rn = gf_dns_build_block(q, &pq, r, sizeof r); hex(r, rn);
  rn = gf_dns_build_servfail(q, &pq, r, sizeof r); hex(r, rn);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 4 && !strcmp(argv[1], "bloom")) return cmd_bloom(argv[2], argv[3]);
  if (argc == 4 && !strcmp(argv[1], "dns")) return cmd_dns(argv[2], atoi(argv[3]));
  fprintf(stderr, "usage: host_test bloom <f> <d> | dns <name> <qtype>\n");
  return 1;
}
