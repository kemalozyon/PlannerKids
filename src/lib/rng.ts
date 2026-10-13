/** Tohumlanmış sözde rastgele sayı üreteci (mulberry32): aynı tohum hep aynı diziyi verir */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
