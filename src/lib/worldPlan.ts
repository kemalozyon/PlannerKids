// Tek bağlı dünya: alanlar (oda, kütüphane, bahçe, ay bahçeleri) kendi yerel karo ızgaralarıyla saklanır
// (user_spaces, save_space), burada yan yana tek bir dünyaya yerleşir. Saf ve deterministik: 3D sahne,
// gezinti ve testler aynı planı kullanır; hiçbir şey saklanmaz.
//
//   kütüphane | oda          ← arka duvarlar y = 0'da hizalı (library.h = room.h)
//   bahçe (evin önü)  ──yol──┬── 1. sıra ay bahçeleri (kapıları güneydeki yola açılır)
//                            ├── 2. sıra ay bahçeleri
//                            └── 2. yol
//
// Bir bölgeden ötekine yalnızca kapıdan geçilir: kapının `edge`'i komşu karoya bir bağlantı (link) açar.
// Duvar ve çit ayrı karo istemez; `canStep` aynı bölge içinde serbest, bölgeler arasında yalnızca bağlantıdan.
import { CFG } from './config';
import {
  blockedTiles,
  emptyLayout,
  fixedDefs,
  key,
  mapById,
  monthSpace,
  monthState,
  seasonMonths,
  type SpaceId,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
} from './world';

export type RegionId = SpaceId | 'trail';

export interface Region {
  id: RegionId;
  /** Dünyadaki sol üst köşe (karo) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Günü gelmemiş ay bahçesi: görünür ama girilmez */
  locked?: boolean;
}

export interface WorldPlan {
  ctx: WorldCtx;
  /** Bütün dikdörtgenler; yol birkaç parçadan oluşur (aynı kimlik) */
  regions: Region[];
  w: number;
  h: number;
  /** Ay bahçeleri sırasıyla (sezon ayları) */
  months: string[];
  /** Karo → bölge sırası + 1 (0: dünyanın dışı) */
  grid: Int16Array;
  /** Bölgeler arası geçilebilir kenarlar ("x,y>x,y", iki yön) */
  links: Set<string>;
}

/** Bir sırada kaç ay bahçesi */
const PER_ROW = 5;
/** Yolun genişliği */
const TRAIL = 2;
/** Bahçe kapısıyla ilk ay bahçesi arasındaki yol */
const LEAD = 3;

const edgeKey = (a: Tile, b: Tile) => `${a.x},${a.y}>${b.x},${b.y}`;
const DIR: Record<'n' | 's' | 'e' | 'w', Tile> = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } };

export function worldPlan(ctx: WorldCtx, months: string[] = seasonMonths()): WorldPlan {
  const map = mapById(ctx.map);
  const G = CFG.world.monthGarden;
  const H = map.room.h;
  const regions: Region[] = [
    { id: 'library', x: 0, y: 0, w: map.library.w, h: map.library.h },
    { id: 'room', x: map.library.w, y: 0, w: map.room.w, h: H },
    { id: 'garden', x: 0, y: H, w: map.garden.w, h: map.garden.h },
  ];
  const gate = map.garden.fixed.find((f) => f.kind === 'gate');
  const open = months.filter((m) => monthState(m, ctx.today) !== 'out');
  // Orman yolu bahçe kapısının hizasından doğuya
  const x0 = map.garden.w;
  const ta = H + (gate?.y ?? 0);
  const fx = x0 + LEAD;
  const pitch = G.w + 1;
  const rows = open.length > PER_ROW ? 2 : open.length ? 1 : 0;
  const len = fx + Math.min(open.length, PER_ROW) * pitch - x0;
  const tb = ta + TRAIL + G.h + 1;
  if (rows) {
    regions.push({ id: 'trail', x: x0, y: ta, w: len, h: TRAIL });
    if (rows > 1) {
      regions.push({ id: 'trail', x: x0, y: ta, w: TRAIL, h: tb + TRAIL - ta });
      regions.push({ id: 'trail', x: x0, y: tb, w: len, h: TRAIL });
    }
  }
  open.forEach((m, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    // Kapı (G.gate, bahçenin güney kenarı) altındaki yola açılır
    const y = row === 0 ? ta - G.h : ta + TRAIL;
    regions.push({ id: monthSpace(m), x: fx + col * pitch, y, w: G.w, h: G.h, locked: monthState(m, ctx.today) === 'locked' });
  });
  const w = Math.max(...regions.map((r) => r.x + r.w)) + 1;
  const h = Math.max(...regions.map((r) => r.y + r.h)) + 1;
  const grid = new Int16Array(w * h);
  regions.forEach((r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!grid[y * w + x]) grid[y * w + x] = i + 1;
  });
  const plan: WorldPlan = { ctx, regions, w, h, months: open, grid, links: new Set() };
  // Kapılar komşu bölgeye bağlanır
  for (const r of regions) {
    if (r.id === 'trail') continue;
    for (const f of fixedDefs(r.id, ctx)) {
      if ((f.kind !== 'door' && f.kind !== 'gate') || !f.edge) continue;
      const a = { x: r.x + f.x, y: r.y + f.y };
      const b = { x: a.x + DIR[f.edge].x, y: a.y + DIR[f.edge].y };
      const rb = regionAt(plan, b);
      if (!rb || rb.id === r.id) continue;
      plan.links.add(edgeKey(a, b));
      plan.links.add(edgeKey(b, a));
    }
  }
  return plan;
}

/** Karonun bölgesi (dünyanın dışındaysa null) */
export function regionAt(plan: WorldPlan, t: Tile): Region | null {
  if (t.x < 0 || t.y < 0 || t.x >= plan.w || t.y >= plan.h) return null;
  const i = plan.grid[t.y * plan.w + t.x];
  return i ? plan.regions[i - 1] : null;
}

/** Bir alanın dünyadaki dikdörtgeni */
export function regionOf(plan: WorldPlan, id: RegionId): Region | null {
  return plan.regions.find((r) => r.id === id) ?? null;
}

export const toLocal = (r: Region, t: Tile): Tile => ({ x: t.x - r.x, y: t.y - r.y });
export const toWorld = (r: Region, t: Tile): Tile => ({ x: t.x + r.x, y: t.y + r.y });

/** Komşu iki karo arasında geçilebilir mi: aynı bölgede serbest, bölgeler arası yalnızca kapıdan */
export function canStep(plan: WorldPlan, a: Tile, b: Tile): boolean {
  const ra = regionAt(plan, a);
  const rb = regionAt(plan, b);
  if (!ra || !rb || ra.locked || rb.locked) return false;
  if (ra.id === rb.id) return true;
  return plan.links.has(edgeKey(a, b));
}

/**
 * Dünyanın yürünemeyen karoları: her alanın kendi engelleri (eşya, su, ekim yeri…), kilitli ay bahçeleri ve
 * dünyanın dışı. Yol karoları yürünür.
 */
export function worldBlocked(plan: WorldPlan, layouts: Partial<Record<SpaceId, SpaceLayout>>): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) if (!plan.grid[y * plan.w + x]) out.add(key(x, y));
  for (const r of plan.regions) {
    if (r.id === 'trail') continue;
    if (r.locked) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.add(key(x, y));
      continue;
    }
    for (const k of blockedTiles(r.id, layouts[r.id] ?? emptyLayout(r.id), plan.ctx)) {
      const [x, y] = k.split(',').map(Number);
      out.add(key(x + r.x, y + r.y));
    }
  }
  return out;
}

/** Bir alana girilen karo (dünyada): kapının iç tarafı; ay bahçesinde kapının bir üstü */
export function entryOf(plan: WorldPlan, id: RegionId): Tile | null {
  const r = regionOf(plan, id);
  if (!r) return null;
  if (r.id === 'trail') return { x: r.x, y: r.y };
  const defs = fixedDefs(r.id, plan.ctx);
  const door = defs.find((f) => (f.kind === 'door' || f.kind === 'gate') && f.edge && (r.id !== 'garden' || f.to === 'room'));
  if (!door) return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
  const inward = { n: { x: 0, y: 1 }, s: { x: 0, y: -1 }, e: { x: -1, y: 0 }, w: { x: 1, y: 0 } }[door.edge!];
  return { x: r.x + door.x + inward.x, y: r.y + door.y + inward.y };
}
