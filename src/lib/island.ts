// Ada: aylık ormanın 3D sahnesi. Ortada 8×8 dikim ızgarası; toplam çalışma saati arttıkça ada genişler
// ve yeni biyomlar (çiçek, kaya, gölet, kamp ateşi) ile hayvanlar açılır. Konumlar ay adından
// tohumlanan sözde rastgele sayılarla üretilir: aynı ay her açılışta aynı görünür, veritabanında tutulmaz.
import { COLS, ROWS } from './forest';

export type BiomeId = 'ada' | 'cicek' | 'kaya' | 'tavsan' | 'gol' | 'civciv' | 'kamp' | 'tilki' | 'ari' | 'geyik';

export interface Biome {
  id: BiomeId;
  /** Açılması için gereken toplam çalışma saati */
  hours: number;
  name: string;
  icon: string;
  desc: string;
}

export const BIOMES: Biome[] = [
  { id: 'ada', hours: 0, name: 'Küçük ada', icon: '🏝️', desc: 'Çimenler ve çalılar' },
  { id: 'cicek', hours: 3, name: 'Çiçek tarlası', icon: '🌼', desc: 'Adanın kıyısında çiçekler açar' },
  { id: 'kaya', hours: 8, name: 'Kayalar ve mantarlar', icon: '🍄', desc: 'Ada büyür, kayalar ve mantarlar çıkar' },
  { id: 'tavsan', hours: 15, name: 'Tavşan', icon: '🐰', desc: 'Adana bir tavşan taşınır' },
  { id: 'gol', hours: 25, name: 'Gölet', icon: '🪷', desc: 'Nilüferli küçük bir gölet' },
  { id: 'civciv', hours: 35, name: 'Civciv', icon: '🐥', desc: 'Bir civciv gelir' },
  { id: 'kamp', hours: 50, name: 'Kamp ateşi', icon: '🔥', desc: 'Geceleri yanan bir kamp ateşi' },
  { id: 'tilki', hours: 70, name: 'Tilki', icon: '🦊', desc: 'Meraklı bir tilki' },
  { id: 'ari', hours: 100, name: 'Arı', icon: '🐝', desc: 'Çiçeklerin arasında uçan bir arı' },
  { id: 'geyik', hours: 140, name: 'Geyik', icon: '🦌', desc: 'Ormanın en büyük misafiri' },
];

export interface IslandProgress {
  unlocked: Set<BiomeId>;
  /** Açılan biyom sayısı (1 = yalnızca ada) */
  level: number;
  next: { biome: Biome; minutesLeft: number } | null;
  /** Adanın yarıçapı (ızgara birimi) */
  radius: number;
}

/** Izgarayı rahatça içine alan en küçük yarıçap; her yeni biyomda ada biraz genişler. */
const BASE_RADIUS = 7.2;
const GROW = 0.4;

export function islandProgress(totalMinutes: number): IslandProgress {
  const open = BIOMES.filter((b) => totalMinutes >= b.hours * 60);
  const nextBiome = BIOMES.find((b) => totalMinutes < b.hours * 60);
  return {
    unlocked: new Set(open.map((b) => b.id)),
    level: open.length,
    next: nextBiome ? { biome: nextBiome, minutesLeft: nextBiome.hours * 60 - totalMinutes } : null,
    radius: BASE_RADIUS + (open.length - 1) * GROW,
  };
}

/** Izgara hücresinin ada üzerindeki konumu (x, z); ızgara adanın ortasında. */
export function cellPosition(cell: number): [number, number] {
  const col = cell % COLS;
  const row = Math.floor(cell / COLS);
  return [col - (COLS - 1) / 2, row - (ROWS - 1) / 2];
}

/** Izgaranın kenarından biraz dışarısı: süsler ve hayvanlar ızgaraya girmesin */
export const GRID_HALF = COLS / 2 + 0.35;

/** Tohumlanmış sözde rastgele sayı üreteci (mulberry32) */
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

/** Izgaranın dışında, kıyıya taşmadan rastgele bir nokta */
export function ringPoint(rand: () => number, radius: number, avoid: { x: number; z: number; r: number }[] = []): [number, number] | null {
  for (let i = 0; i < 40; i++) {
    const ang = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (radius - 0.55);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (Math.abs(x) < GRID_HALF && Math.abs(z) < GRID_HALF) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
    return [x, z];
  }
  return null;
}

export type DecorKind = 'grass' | 'bush' | 'flowerYellow' | 'flowerPurple' | 'flowerRed' | 'rock' | 'stone' | 'mushroomRed' | 'mushroomTan' | 'log' | 'stump';

export interface Decor {
  kind: DecorKind;
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export interface IslandLayout {
  decor: Decor[];
  /** Gölet (açıldıysa) */
  pond: { x: number; z: number; r: number } | null;
  campfire: { x: number; z: number } | null;
}

/** Ayın adasının süsleri: hangi biyomlar açıksa onların süsleri, aya göre sabit konumlarda. */
export function islandLayout(month: string, p: IslandProgress): IslandLayout {
  const rand = rng(`ada:${month}`);
  const R = p.radius;
  const avoid: { x: number; z: number; r: number }[] = [];
  // Gölet ve kamp ateşi önce yerleşir, süsler onlardan kaçar
  let pond: IslandLayout['pond'] = null;
  if (p.unlocked.has('gol')) {
    const ang = rand() * Math.PI * 2;
    const r = R - 1.7;
    pond = { x: Math.cos(ang) * r, z: Math.sin(ang) * r, r: 1.15 };
    avoid.push({ ...pond, r: pond.r + 0.35 });
  }
  let campfire: IslandLayout['campfire'] = null;
  if (p.unlocked.has('kamp')) {
    const pt = ringPoint(rand, R - 0.6, avoid);
    if (pt) {
      campfire = { x: pt[0], z: pt[1] };
      avoid.push({ x: pt[0], z: pt[1], r: 1.1 });
    }
  }
  const decor: Decor[] = [];
  const add = (kind: DecorKind, n: number, scale: [number, number]) => {
    for (let i = 0; i < n; i++) {
      const pt = ringPoint(rand, R, avoid);
      if (!pt) return;
      decor.push({ kind, x: pt[0], z: pt[1], rot: rand() * Math.PI * 2, scale: scale[0] + rand() * (scale[1] - scale[0]) });
      avoid.push({ x: pt[0], z: pt[1], r: 0.35 });
    }
  };
  add('grass', 16, [1.2, 1.8]);
  add('bush', 5, [1.4, 2]);
  add('stump', 1, [1.6, 1.6]);
  if (p.unlocked.has('cicek')) {
    add('flowerYellow', 6, [2.2, 2.8]);
    add('flowerPurple', 5, [2.2, 2.8]);
    add('flowerRed', 5, [2.2, 2.8]);
  }
  if (p.unlocked.has('kaya')) {
    add('rock', 3, [1, 1.4]);
    add('stone', 2, [0.8, 1.1]);
    add('mushroomRed', 3, [1.6, 2.2]);
    add('mushroomTan', 2, [1.6, 2.2]);
    add('log', 1, [1.4, 1.4]);
  }
  return { decor, pond, campfire };
}

/** Solgun fidanların yeri: kimliğinden tohumlanır, gölete/kamp ateşine düşmez */
export function wiltSpots<T extends { item: { id: string } }>(wilts: T[], layout: IslandLayout, radius: number): { w: T; x: number; z: number }[] {
  const avoid = [...(layout.pond ? [{ ...layout.pond, r: layout.pond.r + 0.4 }] : []), ...(layout.campfire ? [{ ...layout.campfire, r: 1 }] : [])];
  return wilts.map((w) => {
    const pt = ringPoint(rng(`solgun:${w.item.id}`), radius, avoid) ?? [radius - 1, 0];
    avoid.push({ x: pt[0], z: pt[1], r: 0.5 });
    return { w, x: pt[0], z: pt[1] };
  });
}

/** Günün saatine göre ışık. 6–10 sabah, 10–17 gündüz, 17–20 akşam, 20–6 gece. */
export type DayPhase = 'sabah' | 'gunduz' | 'aksam' | 'gece';

export function dayPhase(hour: number): DayPhase {
  if (hour >= 6 && hour < 10) return 'sabah';
  if (hour >= 10 && hour < 17) return 'gunduz';
  if (hour >= 17 && hour < 20) return 'aksam';
  return 'gece';
}
