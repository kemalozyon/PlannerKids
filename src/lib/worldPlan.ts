// Habbo gibi tek oda: her oda (oda, kütüphane, eklenen odalar, teraslar) kendi başına bir yerdir; seçilen oda
// (ya da Bahçem sayfasında bir ay bahçesi) tek bölgeli bir plan olarak (0,0)'da durur. Saf ve deterministik:
// 3D sahne, gezinti ve testler aynı planı kullanır; hiçbir şey saklanmaz. Odalar arasında kapılardan geçilir:
// kapının götürdüğü oda `doorTarget` ile bulunur (sayfa o odayı açar).
import {
  blockedTiles,
  emptyLayout,
  fixedDefs,
  inCells,
  isRoom,
  key,
  monthSpace,
  monthState,
  roomSpace,
  spaceCells,
  type RoomCells,
  type SpaceId,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
} from './world';
import type { FixedTile } from './config';

export type RegionId = SpaceId;

export interface Region {
  id: RegionId;
  /** Planın sol üst köşesi (karo); tek odada hep 0 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Günü gelmemiş ay bahçesi: görünür ama girilmez */
  locked?: boolean;
  /** Eklenen odanın şekli (kesikler bölgeye ait değil) */
  cells?: RoomCells;
}

export interface WorldPlan {
  ctx: WorldCtx;
  /** Tek bölge: seçilen oda ya da ay bahçesi */
  regions: Region[];
  w: number;
  h: number;
  /** Karo → bölge sırası + 1 (0: dışarısı, kesik karolar) */
  grid: Int16Array;
}

function planOf(ctx: WorldCtx, region: Region): WorldPlan {
  const { w, h } = region;
  const grid = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!region.cells || inCells(region.cells, x, y)) grid[y * w + x] = 1;
  return { ctx, regions: [region], w, h, grid };
}

/** Seçilen odanın planı: tek bölge (0,0)'da */
export function spacePlan(ctx: WorldCtx, space: SpaceId): WorldPlan {
  const c = spaceCells(space, ctx);
  return planOf(ctx, { id: space, x: 0, y: 0, w: c.w, h: c.h, ...(isRoom(space) ? { cells: c } : {}) });
}

/** Bahçem sayfasının bir ayı: 15×15 ağaç bahçesi */
export function gardenPlan(ctx: WorldCtx, month: string): WorldPlan {
  const p = spacePlan(ctx, monthSpace(month));
  if (monthState(month, ctx.today) === 'locked') p.regions[0].locked = true;
  return p;
}

/** Karonun bölgesi (dışarıdaysa null) */
export function regionAt(plan: WorldPlan, t: Tile): Region | null {
  if (t.x < 0 || t.y < 0 || t.x >= plan.w || t.y >= plan.h) return null;
  const i = plan.grid[t.y * plan.w + t.x];
  return i ? plan.regions[i - 1] : null;
}

/** Bir alanın dikdörtgeni */
export function regionOf(plan: WorldPlan, id: RegionId): Region | null {
  return plan.regions.find((r) => r.id === id) ?? null;
}

export const toLocal = (r: Region, t: Tile): Tile => ({ x: t.x - r.x, y: t.y - r.y });
export const toWorld = (r: Region, t: Tile): Tile => ({ x: t.x + r.x, y: t.y + r.y });

/** Komşu iki karo arasında geçilebilir mi: ikisi de odanın zemininde */
export function canStep(plan: WorldPlan, a: Tile, b: Tile): boolean {
  const ra = regionAt(plan, a);
  const rb = regionAt(plan, b);
  return !!ra && !!rb && !ra.locked && ra === rb;
}

/** Yürünemeyen karolar: odanın engelleri (eşya, raf…), kesikler ve kilitli bahçe */
export function worldBlocked(plan: WorldPlan, layouts: Partial<Record<SpaceId, SpaceLayout>>): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) if (!plan.grid[y * plan.w + x]) out.add(key(x, y));
  for (const r of plan.regions) {
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

/** Odaya girilen karo: kapının iç tarafı (Habbo gibi kapıdan girilir); kapı yoksa odanın ortası */
export function entryOf(plan: WorldPlan, id: RegionId, from?: SpaceId | null): Tile | null {
  const r = regionOf(plan, id);
  if (!r) return null;
  const doors = fixedDefs(r.id, plan.ctx).filter((f) => f.kind === 'door' && f.edge);
  const door = (from && doors.find((d) => doorTarget(r.id, d, plan.ctx) === from)) || doors.find((d) => d.edge === 'w') || doors[0];
  if (!door) return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
  const inward = { n: { x: 0, y: 1 }, s: { x: 0, y: -1 }, e: { x: -1, y: 0 }, w: { x: 1, y: 0 } }[door.edge!];
  const t = { x: r.x + door.x + inward.x, y: r.y + door.y + inward.y };
  return regionAt(plan, t) ? t : { x: r.x + door.x, y: r.y + door.y };
}

/**
 * Kapının götürdüğü oda. Evin sırası: kütüphane | oda | eklenen odalar (pos sırasıyla); batı kapısı bir öncekine,
 * doğu kapısı bir sonrakine açılır. Haritadaki kapıların `to`'su varsa o. Götürdüğü yer yoksa null.
 */
export function doorTarget(space: SpaceId, d: FixedTile, ctx: WorldCtx): SpaceId | null {
  if (d.to === 'room' || d.to === 'library') return d.to;
  if (d.to && isRoom(d.to)) return ctx.rooms.some((r) => roomSpace(r.id) === d.to) ? d.to : null;
  const order: SpaceId[] = ['library', 'room', ...ctx.rooms.map((r) => roomSpace(r.id))];
  const i = order.indexOf(space);
  if (i < 0) return null;
  const j = d.edge === 'w' ? i - 1 : d.edge === 'e' ? i + 1 : -1;
  return order[j] ?? null;
}
