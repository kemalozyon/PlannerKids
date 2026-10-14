// Dünya: ev (oda, kütüphane, evin bahçesi) ve aylık ağaç bahçeleri aynı karo ızgarasını ve aynı yerleştirme
// kurallarını kullanır. Buradaki saf fonksiyonlar SQL'deki save_space doğrulamasının aynısıdır
// (0015_world_v2.sql); demo API, 3D sahne ve testler bunları kullanır. Sayılar src/config/economy.json → world.
//
// Koordinatlar: x sağa, y öne (kameraya doğru) artar; karo (x, y) 3D'de (x + 0.5, 0, y + 0.5) merkezlidir.
// Duvar eşyaları arka duvarda y = -1 (x boyunca) ya da sol duvarda x = -1 (y boyunca) durur.
// Alanlar tek bir bağlı dünyada yan yana durur (worldPlan.ts): kütüphane | oda, önünde bahçe, doğuda orman yolu
// ve ay bahçeleri. Arazi toplam saatle yerinde büyür (aşama, saklanmaz). Her gün bir ağaç: çalışılan her gün o
// ayın bahçesinde kendi yerine (takvim düzeni) bir ağaç dikilir.
import { has, itemById, poseOf, type Item } from './catalog';
import {
  CFG,
  type FixedTile,
  type HomeSpace,
  type MapDef,
  type MonthSpace,
  type RoomCells,
  type RoomKind,
  type RoomId,
  type RoomShape,
  type RoomSize,
  type SpaceId,
  type SpeciesDef,
  type StageDef,
} from './config';
import { rng } from './rng';
import type { Abandoned, StudyLog, UserRoom } from './types';

export type { SpaceId, HomeSpace, MonthSpace, RoomId, RoomKind, RoomShape, RoomSize, RoomCells, UserRoom };
const W = CFG.world;

export interface Tile {
  x: number;
  y: number;
}

/**
 * Yerleştirilmiş bir eşya (örnek): tanımı items.json'da (`item`), burada yeri, yönü ve kendi durumu. Durum alanları
 * yalnızca eşyanın ilgili davranışı varsa bulunur (stateProblem); yoksa tanımın varsayılanı geçerlidir.
 */
export interface PlacedItem {
  item: string;
  x: number;
  y: number;
  rot: number;
  /** TOGGLE: açık mı (yoksa ışık açık, TV/ateş/hareket kapalı) */
  on?: boolean;
  /** OPEN_CLOSE / GATE: açık mı (yoksa kapak kapalı, bahçe kapısı açık) */
  open?: boolean;
  /** CHANGE_COLOR: palette sırası */
  color?: number;
  /** STORAGE: içine konan eşyalar (envanterden sayılır) */
  stored?: string[];
  /** INTERACT_PET: mama konan gün (YYYY-MM-DD) */
  fed?: string;
}

/** Bir alanın durumu (Postgres'te user_spaces.layout jsonb) */
export interface SpaceLayout {
  floor?: string | null;
  wall?: string | null;
  items: PlacedItem[];
}

/** Alan kurallarını etkileyen durum */
export interface WorldCtx {
  /** Kullanıcının yaşadığı harita */
  map: string;
  /** Bugün (YYYY-MM-DD): aylık bahçelerin kilidi */
  today: string;
  /** Çocuğun eklediği odalar, sırasıyla (user_rooms) */
  rooms: UserRoom[];
}

export const key = (x: number, y: number) => `${x},${y}`;

// ---------- Haritalar ----------
export const MAPS: MapDef[] = W.maps;
export const mapById = (id: string): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];
export const mapIndex = (id: string) => Math.max(0, MAPS.findIndex((m) => m.id === id));

/** Toplam (güvenilir) dakikayla açılmış en son aşama: arazinin bugünkü hâli (sunucuda world_ctx.map) */
export function mapFor(totalMinutes: number): MapDef {
  return MAPS.filter((m) => totalMinutes >= m.hours * 60).at(-1) ?? MAPS[0];
}

/** Arazinin aşamaları: bugünkü, açılanlar ve sıradaki */
export function mapsOf(totalMinutes: number) {
  return {
    current: mapFor(totalMinutes),
    unlocked: MAPS.filter((m) => totalMinutes >= m.hours * 60),
    next: MAPS.find((m) => totalMinutes < m.hours * 60) ?? null,
  };
}

// ---------- Eklenen odalar ----------
// Kilit yok: çocuk istediği kadar (en çok maxRooms) oda ekler; türünü (adı, simgesi, varsayılan kaplaması), şeklini
// (Habbo modelleri gibi şablon) ve boyutunu seçer. Odalar odanın doğusunda sırayla durur (worldPlan.ts).
export const ROOM_KINDS: RoomKind[] = W.rooms;
export const ROOM_SHAPES: RoomShape[] = W.roomShapes;
export const ROOM_SIZES: { id: RoomSize; name: string }[] = [
  { id: 's', name: 'Küçük' },
  { id: 'm', name: 'Orta' },
  { id: 'l', name: 'Büyük' },
];
/** Oda kimliği: küçük harf ve rakam (sunucuda aynı kural) */
export const isRoom = (s: string): s is RoomId => /^r:[a-z0-9]{1,12}$/.test(s);
export const roomSpace = (id: string): RoomId => `r:${id}`;
export const roomOf = (space: string, ctx: Pick<WorldCtx, 'rooms'>): UserRoom | undefined => ctx.rooms.find((r) => `r:${r.id}` === space);
export const kindById = (id: string): RoomKind => ROOM_KINDS.find((k) => k.id === id) ?? ROOM_KINDS.at(-1)!;
export const shapeById = (id: string): RoomShape | undefined => ROOM_SHAPES.find((s) => s.id === id);
/** Şablonun bir boyuttaki ölçüsü ve kesikleri (bilinmeyen şablon: küçük kare) */
export const cellsOf = (shape: string, size: RoomSize): RoomCells => shapeById(shape)?.sizes[size] ?? ROOM_SHAPES[0].sizes.s;
/** Odanın zemini mi (kesik değil, alanın içinde) */
export function inCells(c: RoomCells, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
  return !(c.cut ?? []).some(([cx, cy, cw, ch]) => x >= cx && x < cx + cw && y >= cy && y < cy + ch);
}
/** Odanın sabitleri: batı/doğu kapısı (zincir), arka duvarda pencere, kesikler (boşluk) */
export function roomFixed(c: RoomCells): FixedTile[] {
  return [
    { kind: 'door', x: 0, y: 5, edge: 'w' },
    { kind: 'door', x: c.w - 1, y: 5, edge: 'e' },
    { kind: 'window', x: Math.max(1, Math.floor(c.w / 2) - 1), y: -1, w: 2 },
    ...(c.cut ?? []).map(([x, y, w, h]): FixedTile => ({ kind: 'void', x, y, w, h })),
  ];
}
/** Zemini dikdörtgenlere böler (satır satır, aynı aralıklı satırlar birleşir): 3D zemin ve dış duvarlar */
export function cellRects(c: RoomCells): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let open: [number, number, number, number][] = [];
  for (let y = 0; y < c.h; y++) {
    const runs: [number, number][] = [];
    for (let x = 0; x < c.w; x++) {
      if (!inCells(c, x, y)) continue;
      const last = runs.at(-1);
      if (last && last[0] + last[1] === x) last[1]++;
      else runs.push([x, 1]);
    }
    const next: [number, number, number, number][] = [];
    for (const [x, w] of runs) {
      const same = open.find((r) => r[0] === x && r[2] === w);
      if (same) {
        same[3]++;
        next.push(same);
      } else next.push([x, y, w, 1]);
    }
    for (const r of open) if (!next.includes(r)) out.push(r);
    open = next;
  }
  return [...out, ...open];
}
/** Oda bilgisi geçerli mi (sunucuda add_room/update_room ile aynı) */
export function roomInputProblem(r: { kind: string; shape: string; size: string; name: string }): string | null {
  if (!ROOM_KINDS.some((k) => k.id === r.kind)) return 'Oda türü yok';
  if (!shapeById(r.shape)) return 'Oda şekli yok';
  if (!ROOM_SIZES.some((z) => z.id === r.size)) return 'Oda boyu yok';
  const n = (r.name ?? '').trim();
  if (n.length < 1 || n.length > 24) return 'Odanın adı 1–24 harf olmalı';
  return null;
}
/** Alanın zemin ölçüsü ve kesikleri (oda değilse dikdörtgen) */
export function spaceCells(space: SpaceId, ctx: WorldCtx): RoomCells {
  const r = isRoom(space) ? roomOf(space, ctx) : undefined;
  if (r) return cellsOf(r.shape, r.size);
  return spaceSize(space, ctx);
}

// ---------- Alanlar ----------
export const isMonthSpace = (s: string): s is MonthSpace => /^m:\d{4}-\d{2}$/.test(s);
export const monthSpace = (month: string): MonthSpace => `m:${month}`;
export const isHome = (s: string): s is HomeSpace => s === 'room' || s === 'library' || s === 'garden' || isRoom(s);
/** Evin içi: oda, kütüphane ve eklenen odalar */
export const isIndoor = (s: string) => s === 'room' || s === 'library' || isRoom(s);
export const isOutdoor = (s: SpaceId) => s === 'garden' || isMonthSpace(s);

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Sezonun ayları: Eylül 2026 – Haziran 2027 (her ay bir bahçe) */
export function seasonMonths(): string[] {
  const out: string[] = [];
  for (let m = W.season.from; m <= W.season.to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export type MonthState = 'open' | 'locked' | 'out';
/** Ay bahçesi açık mı: sezon dışı yok, günü gelmeyen ay kilitli */
export function monthState(month: string, today: string): MonthState {
  if (month < W.season.from || month > W.season.to) return 'out';
  return month > today.slice(0, 7) ? 'locked' : 'open';
}

export const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

/** Bir günün ekim yeri: sütun haftanın günü (Pzt…Paz), satır ayın haftası */
export function plotOf(month: string, day: number): Tile {
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const i = lead + day - 1;
  const g = W.monthGarden;
  return { x: g.x0 + g.step * (i % 7), y: g.y0 + g.step * Math.floor(i / 7) };
}

export function spaceSize(space: SpaceId, ctx: WorldCtx): { w: number; h: number } {
  if (isMonthSpace(space)) return { w: W.monthGarden.w, h: W.monthGarden.h };
  if (isRoom(space)) {
    const r = roomOf(space, ctx);
    return r ? { w: cellsOf(r.shape, r.size).w, h: cellsOf(r.shape, r.size).h } : { w: 0, h: 0 };
  }
  const s = mapById(ctx.map)[space];
  return { w: s.w, h: s.h };
}

/** Alanın sabit tanımları (kapı, ev, raf, pencere…; ay bahçesinde ekim yerleri ve kapı) */
export function fixedDefs(space: SpaceId, ctx: WorldCtx): FixedTile[] {
  if (isMonthSpace(space)) {
    const month = space.slice(2);
    const plots: FixedTile[] = Array.from({ length: daysIn(month) }, (_, i) => ({ kind: 'plot', ...plotOf(month, i + 1), day: i + 1 }));
    return [...plots, { kind: 'gate', ...W.monthGarden.gate, edge: 's', to: 'garden' }];
  }
  if (isRoom(space)) {
    const r = roomOf(space, ctx);
    return r ? roomFixed(cellsOf(r.shape, r.size)) : [];
  }
  return mapById(ctx.map)[space].fixed;
}

/** Zemindeki sabit karolar, karo karo (duvardaki pencereler hariç) */
export function fixedTiles(space: SpaceId, ctx: WorldCtx): Map<string, FixedTile> {
  const { w, h } = spaceSize(space, ctx);
  const out = new Map<string, FixedTile>();
  for (const f of fixedDefs(space, ctx)) {
    if (f.x < 0 || f.y < 0) continue;
    for (let y = f.y; y < Math.min(h, f.y + (f.h ?? 1)); y++) {
      for (let x = f.x; x < Math.min(w, f.x + (f.w ?? 1)); x++) out.set(key(x, y), f);
    }
  }
  return out;
}

/** Duvarda eşya asılamayan yerler: pencere, kapı ve gömme rafların üstü */
export function wallBlocked(space: SpaceId, ctx: WorldCtx): Set<string> {
  const out = new Set<string>();
  if (!isIndoor(space)) return out;
  for (const f of fixedDefs(space, ctx)) {
    const fw = f.w ?? 1;
    const fh = f.h ?? 1;
    if (f.kind === 'window') {
      if (f.y === -1) for (let x = f.x; x < f.x + fw; x++) out.add(key(x, -1));
      else for (let y = f.y; y < f.y + fh; y++) out.add(key(-1, y));
    } else if (f.kind === 'door' || f.kind === 'shelf') {
      if (f.y === 0) for (let x = f.x; x < f.x + fw; x++) out.add(key(x, -1));
      if (f.x === 0 && f.kind === 'door') for (let y = f.y; y < f.y + fh; y++) out.add(key(-1, y));
    }
  }
  return out;
}

/** Yürünemeyen sabit karolar (kapı, bahçe kapısı ve köprü yürünür) */
const solid = (f: FixedTile) => f.kind !== 'door' && f.kind !== 'gate' && f.kind !== 'bridge';

// ---------- Eşyalar ----------
/** Dönüşe göre ayak izi ölçüsü (90° ve 270°'de en ve boy yer değiştirir) */
export function footSize(item: Pick<Item, 'w' | 'h'>, rot: number): [number, number] {
  const w = item.w ?? 1;
  const h = item.h ?? 1;
  return rot % 180 === 0 ? [w, h] : [h, w];
}

export function footprint(item: Pick<Item, 'w' | 'h'>, x: number, y: number, rot: number): Tile[] {
  const [w, h] = footSize(item, rot);
  const out: Tile[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

/** Duvar eşyasının yönü: arka duvarda öne (0), sol duvarda sağa (270) bakar */
export const wallRot = (x: number, y: number) => (y === -1 && x >= 0 ? 0 : 270);

/** Duvar eşyasının duvardaki yerleri (eni kadar) */
export function wallSlots(item: Pick<Item, 'w'>, x: number, y: number): Tile[] {
  const n = item.w ?? 1;
  return Array.from({ length: n }, (_, i) => (y === -1 ? { x: x + i, y: -1 } : { x: -1, y: y + i }));
}

/** Bir eşyanın kapladığı yerler (duvar eşyasında duvardaki yerleri) */
export const tilesOf = (item: Item, p: PlacedItem): Tile[] => (item.placement === 'wall' ? wallSlots(item, p.x, p.y) : footprint(item, p.x, p.y, p.rot));

/** Bu alana konabilir mi: duvar eşyası içeride, iç/dış mekân eşyası kendi yerinde */
export const fitsSpace = (item: Item, space: SpaceId) => {
  if (item.placement === 'wall') return isIndoor(space);
  if (item.placement === 'both') return true;
  return isOutdoor(space) ? item.placement === 'outdoor' : item.placement === 'indoor';
};

/**
 * Katmanlar: zemin (halı, yol: üstünden yürünür, mobilya üstüne konabilir), eşya, üst (masanın üstündeki
 * küçük eşya), duvar. Küçük eşya ya bütünüyle yüzeyin üstünde ya bütünüyle yerdedir.
 */
type Layer = 'zemin' | 'esya' | 'ust' | 'duvar';

/** Üstüne küçük eşya konabilen eşyaların karoları */
function surfaceTiles(items: PlacedItem[], skip = -1): Set<string> {
  const out = new Set<string>();
  items.forEach((p, i) => {
    const it = itemById(p.item);
    if (i !== skip && it && has(it, 'STACKABLE') && it.placement !== 'wall') footprint(it, p.x, p.y, p.rot).forEach((t) => out.add(key(t.x, t.y)));
  });
  return out;
}

function layerOf(it: Item, tiles: Tile[], surfaces: Set<string>): Layer | null {
  if (it.placement === 'wall') return 'duvar';
  if (has(it, 'WALK_THROUGH')) return 'zemin';
  if (!has(it, 'ON_SURFACE')) return 'esya';
  const on = tiles.filter((t) => surfaces.has(key(t.x, t.y))).length;
  return on === 0 ? 'esya' : on === tiles.length ? 'ust' : null;
}

/** Bir eşyadan kaç tane yerleştirilebilir (economy.ts → ownedCount; sunucuda world_owned) */
export type OwnedCount = (item: Item) => number;

export interface Problem {
  message: string;
  /** Sorunlu eşyanın sırası */
  index?: number;
}

type Taken = Record<Layer, Set<string>>;
const emptyTaken = (): Taken => ({ zemin: new Set(), esya: new Set(), ust: new Set(), duvar: new Set() });

/** Tek eşyanın kuralları: tür, alan, dönüş, sınır, sabit karo, katman ve çakışma. Sorun yoksa kapladığı yerler. */
function placeProblem(space: SpaceId, ctx: WorldCtx, p: PlacedItem, taken: Taken, surfaces: Set<string>): string | { layer: Layer; tiles: Tile[] } {
  const it = itemById(p.item);
  if (!it || !it.placement) return 'Bu eşya yerleştirilemez';
  const bad = stateProblem(it, p);
  if (bad) return bad;
  if (!fitsSpace(it, space)) return it.placement === 'wall' ? 'Duvar süsü yalnızca odalara asılır' : isOutdoor(space) ? 'Bu eşya içeride durur' : 'Bu eşya dışarıda durur';
  if (![p.x, p.y, p.rot].every(Number.isInteger)) return 'Yerleşim geçersiz';
  const { w, h } = spaceSize(space, ctx);
  if (it.placement === 'wall') {
    if ((p.x === -1) === (p.y === -1) || p.rot !== wallRot(p.x, p.y)) return 'Duvar süsü yalnızca duvara asılır';
    const tiles = wallSlots(it, p.x, p.y);
    const blocked = wallBlocked(space, ctx);
    for (const t of tiles) {
      if (t.x >= w || t.y >= h || t.x < -1 || t.y < -1) return 'Duvarın dışına taşıyor';
      if (blocked.has(key(t.x, t.y))) return 'Duvarın bu kısmı boş değil';
      if (taken.duvar.has(key(t.x, t.y))) return 'Duvarın bu kısmı dolu';
    }
    return { layer: 'duvar', tiles };
  }
  if (!(it.rotations ?? [0]).includes(p.rot)) return 'Bu eşya böyle döndürülemez';
  const tiles = footprint(it, p.x, p.y, p.rot);
  const fixed = fixedTiles(space, ctx);
  for (const t of tiles) {
    if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= h) return 'Alanın dışına taşıyor';
    if (fixed.has(key(t.x, t.y))) return 'Bu karo boş değil';
  }
  const layer = layerOf(it, tiles, surfaces);
  if (!layer) return 'Yarısı yüzeyin dışında kalıyor';
  for (const t of tiles) if (taken[layer].has(key(t.x, t.y))) return 'Bu karo dolu';
  return { layer, tiles };
}

// ---------- Eşyanın kendi durumu ----------
const PLACED_KEYS = new Set(['item', 'x', 'y', 'rot', 'on', 'open', 'color', 'stored', 'fed']);

/** İçine konabilir mi: yerleştirilebilen, kendisi depo olmayan eşya (kaplama, kıyafet, canlı konmaz) */
export const storable = (s: Item | undefined): s is Item => !!s && !!s.placement && !has(s, 'STORAGE');

/** Durum alanları eşyanın davranışına uyuyor mu (save_space ile aynı) */
export function stateProblem(it: Item, p: PlacedItem): string | null {
  for (const k of Object.keys(p)) if (!PLACED_KEYS.has(k)) return 'Yerleşim geçersiz';
  if (p.on !== undefined && (typeof p.on !== 'boolean' || !has(it, 'TOGGLE'))) return 'Bu eşya açılıp kapanmaz';
  if (p.open !== undefined && (typeof p.open !== 'boolean' || !(has(it, 'OPEN_CLOSE') || has(it, 'GATE')))) return 'Bu eşya açılmaz';
  if (p.color !== undefined && (!has(it, 'CHANGE_COLOR') || !Number.isInteger(p.color) || p.color < 0 || p.color >= (it.palette?.length ?? 0))) return 'Bu renk yok';
  if (p.fed !== undefined && (!has(it, 'INTERACT_PET') || typeof p.fed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.fed))) return 'Yerleşim geçersiz';
  if (p.stored !== undefined) {
    if (!has(it, 'STORAGE') || !Array.isArray(p.stored)) return 'Bu eşyanın içine bir şey konmaz';
    if (p.stored.length > (it.capacity ?? 0)) return `${it.name} doldu`;
    if (!p.stored.every((id) => typeof id === 'string' && storable(itemById(id)))) return 'Bu eşya içine konmaz';
  }
  return null;
}

/** Yerleşimdeki eşya adetleri: yerleştirilenler ve depolara konanlar (envanterden düşülür) */
export function itemCounts(layout: SpaceLayout | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string) => out.set(id, (out.get(id) ?? 0) + 1);
  for (const p of layout?.items ?? []) {
    add(p.item);
    if (Array.isArray(p.stored)) p.stored.forEach(add);
  }
  return out;
}

function monthProblem(space: SpaceId, ctx: WorldCtx): string | null {
  if (isRoom(space)) return roomOf(space, ctx) ? null : 'Bu oda yok';
  if (!isMonthSpace(space)) return null;
  const st = monthState(space.slice(2), ctx.today);
  return st === 'out' ? 'Bu ayın bahçesi yok' : st === 'locked' ? 'Bu ayın bahçesi henüz açılmadı' : null;
}

/**
 * Yerleşim geçerli mi? (save_space ile aynı kurallar)
 * @param usedElsewhere eşyanın diğer alanlarda kullanılan adedi
 */
export function layoutProblem(
  space: SpaceId,
  layout: SpaceLayout,
  ctx: WorldCtx,
  ownedCount: OwnedCount,
  usedElsewhere: (id: string) => number = () => 0,
): Problem | null {
  const month = monthProblem(space, ctx);
  if (month) return { message: month };
  if (!Array.isArray(layout.items) || layout.items.length > 200) return { message: 'Yerleşim geçersiz' };
  for (const [slot, cat] of [['floor', 'zemin'], ['wall', 'duvar']] as const) {
    const id = layout[slot];
    if (id == null) continue;
    const it = itemById(id);
    if (!isIndoor(space) || !it || it.category !== cat || ownedCount(it) < 1) return { message: 'Bu kaplama sende yok' };
  }
  const surfaces = surfaceTiles(layout.items);
  const taken = emptyTaken();
  for (const [index, p] of layout.items.entries()) {
    const r = placeProblem(space, ctx, p, taken, surfaces);
    if (typeof r === 'string') return { message: r, index };
    r.tiles.forEach((t) => taken[r.layer].add(key(t.x, t.y)));
  }
  for (const [id, n] of itemCounts(layout)) {
    if (n + usedElsewhere(id) > ownedCount(itemById(id)!)) {
      return { message: `${itemById(id)!.name} envanterinde yok`, index: layout.items.findIndex((p) => p.item === id || !!p.stored?.includes(id)) };
    }
  }
  return null;
}

/** Bir eşya bu yere konabilir mi (yerleştirme modunda yeşil/kırmızı önizleme); ignore: taşınan eşyanın sırası */
export function canPlaceAt(space: SpaceId, layout: SpaceLayout, ctx: WorldCtx, p: PlacedItem, ignore = -1): boolean {
  if (monthProblem(space, ctx)) return false;
  const others = layout.items.filter((_, i) => i !== ignore);
  const surfaces = surfaceTiles(others);
  const taken = emptyTaken();
  for (const q of others) {
    const it = itemById(q.item);
    if (!it) continue;
    const tiles = tilesOf(it, q);
    const layer = layerOf(it, tiles, surfaces);
    if (layer) tiles.forEach((t) => taken[layer].add(key(t.x, t.y)));
  }
  return typeof placeProblem(space, ctx, p, taken, surfaces) !== 'string';
}

/** Bir yüzeyin (masa, sehpa) üstünde duran küçük eşyaların sırası: yüzey kaldırılınca envantere dönerler */
export function onTopOf(layout: SpaceLayout, index: number): number[] {
  const base = layout.items[index];
  const it = base && itemById(base.item);
  if (!it || !has(it, 'STACKABLE')) return [];
  const mine = new Set(footprint(it, base.x, base.y, base.rot).map((t) => key(t.x, t.y)));
  const rest = surfaceTiles(layout.items, index);
  return layout.items.flatMap((p, i) => {
    const s = itemById(p.item);
    if (i === index || !s || !has(s, 'ON_SURFACE')) return [];
    const tiles = footprint(s, p.x, p.y, p.rot);
    // Bu yüzeyin üstündeyse (başka bir yüzey tek başına taşımıyorsa) onunla gider
    return tiles.some((t) => mine.has(key(t.x, t.y))) && !tiles.every((t) => rest.has(key(t.x, t.y))) ? [i] : [];
  });
}

/** Eşyayı yerleşimden çıkar (envantere döner); üstündeki küçük eşyalar da onunla döner */
export function removeItemAt(layout: SpaceLayout, index: number): SpaceLayout {
  const tops = onTopOf(layout, index);
  return { ...layout, items: layout.items.filter((_, i) => i !== index && !tops.includes(i)) };
}

/** Eşyanın sıradaki yönü (items.json → rotations) */
export function nextRot(item: Pick<Item, 'rotations'>, rot: number): number {
  const r = item.rotations ?? [0];
  return r[(r.indexOf(rot) + 1) % r.length];
}

/** Eşyayı yerinde döndür; döndürünce sığmıyorsa null */
export function rotateItemAt(space: SpaceId, layout: SpaceLayout, index: number, ctx: WorldCtx): SpaceLayout | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it || it.placement === 'wall') return null;
  const q = { ...p, rot: nextRot(it, p.rot) };
  // Üstündekiler sınamada yok sayılır (yüzeyleri olmadan yerde sayılırlardı); döndükten sonra yerlerinde kalırlar
  return canPlaceAt(space, removeItemAt(layout, index), ctx, q) ? { ...layout, items: layout.items.map((x, i) => (i === index ? q : x)) } : null;
}

/** Eşyayı aynı alanda başka bir karoya taşı (üstündekiler envantere döner); konamıyorsa null */
export function moveItemTo(space: SpaceId, layout: SpaceLayout, index: number, to: Tile, rot: number, ctx: WorldCtx): SpaceLayout | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it) return null;
  const base = removeItemAt(layout, index);
  // Durumu (açık, renk, içindekiler) onunla gider
  const q: PlacedItem = { ...p, x: to.x, y: to.y, rot: it.placement === 'wall' ? wallRot(to.x, to.y) : rot };
  return canPlaceAt(space, base, ctx, q) ? { ...base, items: [...base.items, q] } : null;
}

/** Küçük eşyanın yüksekliği: bir yüzeyin üstündeyse o yüzeyin sırası */
export function supportOf(layout: SpaceLayout, p: PlacedItem, ignore = -1): number | null {
  const it = itemById(p.item);
  if (!it || !has(it, 'ON_SURFACE')) return null;
  const tiles = footprint(it, p.x, p.y, p.rot);
  for (const [i, q] of layout.items.entries()) {
    const s = itemById(q.item);
    if (i === ignore || !s || !has(s, 'STACKABLE')) continue;
    const under = new Set(footprint(s, q.x, q.y, q.rot).map((t) => key(t.x, t.y)));
    if (tiles.some((t) => under.has(key(t.x, t.y)))) return i;
  }
  return null;
}

/**
 * Kurala uymayan eşyaları ayıklar (harita değişti, kural değişti, eşya artık yok): geçerliler sırayla kalır,
 * kalanlar envantere döner. Ekranda eski bir yerleşim açılırken ve kaydetmeden önce kullanılır.
 */
export function sanitizeLayout(
  space: SpaceId,
  layout: SpaceLayout,
  ctx: WorldCtx,
  ownedCount: OwnedCount,
  usedElsewhere: (id: string) => number = () => 0,
): { layout: SpaceLayout; dropped: number } {
  const items = Array.isArray(layout.items) ? layout.items : [];
  const surfaces = surfaceTiles(items);
  const taken = emptyTaken();
  const used = new Map<string, number>();
  const keep: PlacedItem[] = [];
  const take = (id: string, it: Item) => {
    const n = (used.get(id) ?? 0) + 1;
    if (n + usedElsewhere(id) > ownedCount(it)) return false;
    used.set(id, n);
    return true;
  };
  for (const raw of items) {
    const it = itemById(raw?.item);
    if (!it) continue;
    // Uymayan durum alanları atılır, eşya kalır; içindekilerden sahip olunmayanlar envantere döner
    const p = cleanState(it, raw);
    const r = placeProblem(space, ctx, p, taken, surfaces);
    if (typeof r === 'string' || !take(p.item, it)) continue;
    if (p.stored) p.stored = p.stored.filter((id) => take(id, itemById(id)!));
    r.tiles.forEach((t) => taken[r.layer].add(key(t.x, t.y)));
    keep.push(p);
  }
  const cover = (id: string | null | undefined, cat: 'zemin' | 'duvar') => {
    const it = id ? itemById(id) : undefined;
    return isIndoor(space) && it && it.category === cat && ownedCount(it) > 0 ? id : undefined;
  };
  const out: SpaceLayout = { items: keep };
  if (isIndoor(space)) {
    // Eklenen odalarda kaplama seçilmemişse odanın kendi görünüşü kalır (defaultCover; sahip olmak gerekmez)
    const floor = cover(layout.floor, 'zemin') ?? (isRoom(space) ? undefined : 'zemin:ahsap');
    const wall = cover(layout.wall, 'duvar') ?? (isRoom(space) ? undefined : 'duvar:krem');
    if (floor) out.floor = floor;
    if (wall) out.wall = wall;
  }
  return { layout: out, dropped: items.length - keep.length };
}

/** Yalnızca eşyanın davranışına uyan durum alanlarını bırakır */
function cleanState(it: Item, p: PlacedItem): PlacedItem {
  const out: PlacedItem = { item: p.item, x: p.x, y: p.y, rot: p.rot };
  for (const k of ['on', 'open', 'color', 'fed'] as const) {
    if (p[k] === undefined) continue;
    const q = { ...out, [k]: p[k] };
    if (!stateProblem(it, q)) Object.assign(out, { [k]: p[k] });
  }
  if (has(it, 'STORAGE') && Array.isArray(p.stored)) {
    const s = p.stored.filter((id) => typeof id === 'string' && storable(itemById(id))).slice(0, it.capacity ?? 0);
    if (s.length) out.stored = s;
  }
  return out;
}

// ---------- Eşyayı kullanmak: otur, yat, sallan, aç-kapa ----------
export type Pose = 'sit' | 'lie' | 'swing';

/** Eşyanın önü: dönüşe göre (0° güney/kameraya doğru, 90° batı, 180° kuzey, 270° doğu) */
const FRONT: Record<number, Tile> = { 0: { x: 0, y: 1 }, 90: { x: -1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: 1, y: 0 } };

/**
 * Oturma/yatma noktası (alanın yerel koordinatında, karo merkezi değil 3D konum): ayak izinin ortası, yükseklik
 * eşyanın `seat`'i. Yüz eşyanın önüne döner (3D'de rotation.y = −rot). Yatakta karakter boyunca uzanır: başı
 * yatağın başında (eşyanın arkası), bu yüzden orta nokta biraz öne kayar.
 */
export function seatOf(item: Item, p: PlacedItem): { kind: Pose; x: number; z: number; y: number; face: number } | null {
  const kind = poseOf(item);
  if (!kind) return null;
  const [w, h] = footSize(item, p.rot);
  const face = p.rot ? (-p.rot * Math.PI) / 180 : 0;
  const f = FRONT[p.rot] ?? FRONT[0];
  const shift = kind === 'lie' ? 0.55 : kind === 'sit' ? -0.05 : 0;
  return { kind, x: p.x + w / 2 + f.x * shift, z: p.y + h / 2 + f.y * shift, y: item.seat ?? (kind === 'lie' ? 0.5 : 0.45), face };
}

/**
 * Eşyanın yanına gelinecek boş karo: önce önü (ortadaki karodan başlayarak), sonra yanları ve arkası.
 * Yatağa yandan, sandalyeye önden yaklaşılır. Boş yer yoksa null.
 */
export function approachTile(item: Item, p: PlacedItem, w: number, h: number, blocked: Set<string>): Tile | null {
  if (item.placement === 'wall') return null;
  const [fw, fh] = footSize(item, p.rot);
  const f = FRONT[p.rot] ?? FRONT[0];
  const free = (t: Tile) => t.x >= 0 && t.y >= 0 && t.x < w && t.y < h && !blocked.has(key(t.x, t.y));
  const side = (d: Tile): Tile[] => {
    const out: Tile[] = [];
    if (d.y) for (let i = 0; i < fw; i++) out.push({ x: p.x + i, y: d.y > 0 ? p.y + fh : p.y - 1 });
    else for (let i = 0; i < fh; i++) out.push({ x: d.x > 0 ? p.x + fw : p.x - 1, y: p.y + i });
    // Ortadakiler önce
    const mid = (out.length - 1) / 2;
    return out.map((t, i) => ({ t, d: Math.abs(i - mid) })).sort((a, b) => a.d - b.d).map((x) => x.t);
  };
  const back = { x: -f.x, y: -f.y };
  const left = { x: f.y, y: -f.x };
  const right = { x: -f.y, y: f.x };
  const order = has(item, 'LAY') ? [left, right, f, back] : [f, left, right, back];
  for (const d of order) for (const t of side(d)) if (free(t)) return t;
  return null;
}

/** Eşyanın yerdeki kimliği: alan + eşya + yer (oturulan eşya, TV kanalı, yakınlık) */
export const powerKey = (space: SpaceId, p: PlacedItem) => `${space}|${p.item}@${p.x},${p.y}`;

/** Açık mı: durum yoksa ışık açık (bugünkü görünüş), TV/ateş/hareket kapalı */
export const isOn = (item: Item, p: PlacedItem): boolean => has(item, 'TOGGLE') && (p.on ?? item.fx === 'light');
/** Kapağı/kapısı açık mı: durum yoksa kapak kapalı, bahçe kapısı açık (eskiden hep geçilirdi) */
export const isOpen = (item: Item, p: PlacedItem): boolean => (has(item, 'OPEN_CLOSE') || has(item, 'GATE')) && (p.open ?? has(item, 'GATE'));
/** Seçili renk (CHANGE_COLOR); yoksa undefined */
export const colorOf = (item: Item, p: PlacedItem): string | undefined => (has(item, 'CHANGE_COLOR') ? item.palette?.[p.color ?? 0] : undefined);

/** Eşyanın eylemleri (seçenek çubuğundaki "Kullan" düğmeleri) */
export type ActionId = 'sit' | 'lie' | 'swing' | 'stand' | 'toggle' | 'open' | 'color' | 'storage' | 'dispense' | 'sound' | 'feed' | 'books';
export interface ItemAction {
  id: ActionId;
  label: string;
}

export const DISPENSE_LABEL: Record<string, string> = {
  kahve: '☕ Kahve al',
  dondurma: '🍦 Dondurma al',
  'meyve-suyu': '🧃 Meyve suyu al',
  'patlamis-misir': '🍿 Mısır al',
  kurabiye: '🍪 Kurabiye al',
  su: '💧 Su al',
};

/** Davranışlardan eylem düğmeleri; dünya görünümü ve gezinti aynı listeyi gösterir */
export function itemActions(item: Item, p: PlacedItem, o: { posed: boolean; today: string }): ItemAction[] {
  const out: ItemAction[] = [];
  const pose = poseOf(item);
  if (pose) out.push(o.posed ? { id: 'stand', label: '🧍 Kalk' } : { id: pose, label: pose === 'sit' ? '🪑 Otur' : pose === 'lie' ? '🛏️ Yat' : '🎠 Sallan' });
  if (has(item, 'TOGGLE')) {
    const on = isOn(item, p);
    const label =
      item.fx === 'fire' ? (on ? '🔥 Söndür' : '🔥 Yak') : item.fx === 'tv' ? (on ? '📺 Kapat' : '📺 Aç') : item.fx === 'anim' ? (on ? '⏹️ Durdur' : '▶️ Çalıştır') : on ? '💡 Kapat' : '💡 Aç';
    out.push({ id: 'toggle', label });
  }
  if (has(item, 'GATE')) out.push({ id: 'open', label: isOpen(item, p) ? '🚧 Kapıyı kapat' : '🚪 Kapıyı aç' });
  else if (has(item, 'OPEN_CLOSE')) out.push({ id: 'open', label: isOpen(item, p) ? '🔒 Kapağı kapat' : '🔓 Kapağı aç' });
  if (has(item, 'CHANGE_COLOR') && (item.palette?.length ?? 0) > 1) out.push({ id: 'color', label: '🎨 Renk' });
  if (has(item, 'STORAGE')) out.push({ id: 'storage', label: `📦 İçi ${p.stored?.length ?? 0}/${item.capacity ?? 0}` });
  if (has(item, 'DISPENSE')) out.push({ id: 'dispense', label: DISPENSE_LABEL[item.dispense ?? ''] ?? '🎁 Al' });
  if (has(item, 'PLAY_SOUND')) out.push({ id: 'sound', label: '🎵 Çal' });
  if (has(item, 'INTERACT_PET') && p.fed !== o.today) out.push({ id: 'feed', label: '🥣 Mama koy' });
  if (has(item, 'BOOKS')) out.push({ id: 'books', label: '📚 Rafları aç' });
  return out;
}

/** Durumu değiştiren eylemin sonucu (aç-kapa, kapak, renk, mama); durum değiştirmeyen eylemde null */
export function applyAction(item: Item, p: PlacedItem, id: ActionId, today: string): PlacedItem | null {
  if (id === 'toggle' && has(item, 'TOGGLE')) return { ...p, on: !isOn(item, p) };
  if (id === 'open' && (has(item, 'OPEN_CLOSE') || has(item, 'GATE'))) return { ...p, open: !isOpen(item, p) };
  if (id === 'color' && item.palette?.length) return { ...p, color: ((p.color ?? 0) + 1) % item.palette.length };
  if (id === 'feed' && has(item, 'INTERACT_PET')) return { ...p, fed: today };
  return null;
}

/** Depoya bir eşya koy (kapasite ve tür kontrolü; sahiplik çağıranda); olmazsa null */
export function storeAt(layout: SpaceLayout, index: number, id: string): SpaceLayout | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it || !has(it, 'STORAGE') || !storable(itemById(id)) || (p.stored?.length ?? 0) >= (it.capacity ?? 0)) return null;
  return { ...layout, items: layout.items.map((q, i) => (i === index ? { ...q, stored: [...(q.stored ?? []), id] } : q)) };
}

/** Depodan k. eşyayı çıkar (envantere döner) */
export function takeOutAt(layout: SpaceLayout, index: number, k: number): SpaceLayout {
  return {
    ...layout,
    items: layout.items.map((q, i) => {
      if (i !== index || !q.stored) return q;
      const stored = q.stored.filter((_, j) => j !== k);
      const { stored: _s, ...rest } = q;
      return stored.length ? { ...rest, stored } : rest;
    }),
  };
}

/** Yerinde döndürülebilir mi (birden çok yönü olan yer eşyası) */
export const canRotate = (item: Item) => item.placement !== 'wall' && (item.rotations?.length ?? 1) > 1;

// ---------- Yürüme ----------
/** Alanın yürünemeyen karoları: ev, su, raf, ekim yerleri ve zemin katmanında olmayan eşyalar (açık kapı geçilir) */
export function blockedTiles(space: SpaceId, layout: SpaceLayout, ctx: WorldCtx): Set<string> {
  const out = new Set<string>();
  for (const [k, f] of fixedTiles(space, ctx)) if (solid(f)) out.add(k);
  for (const p of layout.items) {
    const it = itemById(p.item);
    if (it && !has(it, 'WALK_THROUGH') && it.placement !== 'wall' && !(has(it, 'GATE') && isOpen(it, p))) footprint(it, p.x, p.y, p.rot).forEach((t) => out.add(key(t.x, t.y)));
  }
  return out;
}

/** İki komşu karo arasında geçilebilir mi (duvar, çit); verilmezse hep geçilir */
export type Step = (from: Tile, to: Tile) => boolean;

/**
 * A* (4 yön, ikili yığınla). Hedef doluysa (eşyaya, ağaca tıklandı) hedefe en yakın boş komşuya gider.
 * `step` iki karo arasındaki kenarı sorar: dünyada bölgeler arası yalnızca kapılardan geçilir (worldPlan.ts).
 * Dönen yol başlangıcı içermez; yol yoksa null.
 */
export function findPath(from: Tile, to: Tile, w: number, h: number, blocked: Set<string>, step?: Step): Tile[] | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const free = (x: number, y: number) => inside(x, y) && !blocked.has(key(x, y));
  let goals = [to];
  if (!free(to.x, to.y)) {
    goals = [
      { x: to.x, y: to.y + 1 },
      { x: to.x + 1, y: to.y },
      { x: to.x - 1, y: to.y },
      { x: to.x, y: to.y - 1 },
      // Duvarın öbür yanındaki komşu sayılmaz (eşyaya kendi odasından yaklaşılır)
    ].filter((t) => free(t.x, t.y) && (!step || step(t, to)));
    if (!goals.length) return null;
  }
  const goalSet = new Set(goals.map((g) => g.y * w + g.x));
  const hcost = (x: number, y: number) => Math.min(...goals.map((g) => Math.abs(g.x - x) + Math.abs(g.y - y)));
  const id = (x: number, y: number) => y * w + x;
  const start = id(from.x, from.y);
  const came = new Map<number, number>();
  const best = new Map<number, number>([[start, 0]]);
  // İkili yığın: [f, g, id]
  const heap: [number, number, number][] = [[hcost(from.x, from.y), 0, start]];
  const push = (n: [number, number, number]) => {
    heap.push(n);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [, g0, cur] = pop();
    if (g0 > (best.get(cur) ?? Infinity)) continue;
    if (goalSet.has(cur)) {
      const path: Tile[] = [];
      for (let k: number | undefined = cur; k != null && k !== start; k = came.get(k)) path.unshift({ x: k % w, y: Math.floor(k / w) });
      return path;
    }
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (step && !step({ x: cx, y: cy }, { x: nx, y: ny })) continue;
      const nk = id(nx, ny);
      const g = g0 + 1;
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      came.set(nk, cur);
      push([g + hcost(nx, ny), g, nk]);
    }
  }
  return null;
}

// ---------- Ağaçlar: her gün bir ağaç ----------
export interface DayTree {
  /** Gün (YYYY-MM-DD): ağacın kimliği */
  id: string;
  date: string;
  month: string;
  species: SpeciesDef;
  stage: StageDef;
  stageIndex: number;
  name: string;
  icon: string;
  /** Günün bütün çalışması (elle yazılan dahil) */
  minutes: number;
  /** Bunun elle yazılan kısmı */
  manual: number;
  /** Yalnızca yarım kalmış seans: kuru ağaç */
  dry: boolean;
  /** Çok uzun gün: ışıltılı yapraklar */
  glow: boolean;
  /** Seri günü: dibinde çiçekler */
  flowers: boolean;
}

const lower = (s: string) => s.toLocaleLowerCase('tr-TR');

/** Ağacın büyüklüğü: günün toplam dakikasına göre */
export function stageOf(minutes: number): { stage: StageDef; index: number } {
  const index = Math.max(0, W.stages.filter((s) => minutes >= s.min).length - 1);
  return { stage: W.stages[index], index };
}

/** Günün ağaç türü: tarihten tohumlanır (hep aynı); mevsiminde olan türler daha sık çıkar */
export function speciesOf(date: string): SpeciesDef {
  const month = Number(date.slice(5, 7));
  const weight = (s: SpeciesDef) => (!s.months ? 1 : s.months.includes(month) ? 3 : 0.3);
  const total = W.species.reduce((n, s) => n + weight(s), 0);
  let pick = rng(`tur:${date}`)() * total;
  for (const s of W.species) {
    pick -= weight(s);
    if (pick < 0) return s;
  }
  return W.species[W.species.length - 1];
}

export const treeLabel = (species: Pick<SpeciesDef, 'name'>, stage: StageDef) => stage.label.replace('{s}', lower(species.name)).replace('{S}', species.name);

/**
 * Bütün ağaçlar: çalışma kaydı olan her gün bir ağaç (sayaç da elle yazılan süre de sayılır), türü tarihten,
 * büyüklüğü günün toplamından. Kaydı olmayan ama uzun süren yarım seansı olan gün kuru ağaçtır.
 * @param streakDays seri bonusu alan günler (dibinde çiçek açar)
 */
export function dayTrees(logs: StudyLog[], abandoned: Abandoned[], streakDays: Set<string> = new Set()): DayTree[] {
  const days = new Map<string, { minutes: number; manual: number }>();
  for (const l of logs) {
    const d = days.get(l.date) ?? { minutes: 0, manual: 0 };
    d.minutes += l.duration_minutes;
    if (l.source === 'manual') d.manual += l.duration_minutes;
    days.set(l.date, d);
  }
  const out: DayTree[] = [];
  for (const [date, d] of days) {
    if (d.minutes <= 0) continue;
    const species = speciesOf(date);
    const { stage, index } = stageOf(d.minutes);
    out.push({
      id: date,
      date,
      month: date.slice(0, 7),
      species,
      stage,
      stageIndex: index,
      name: treeLabel(species, stage),
      icon: stage.icon ?? species.icon,
      minutes: d.minutes,
      manual: d.manual,
      dry: false,
      glow: d.minutes >= W.glowMinutes,
      flowers: streakDays.has(date),
    });
  }
  const dryDays = new Map<string, number>();
  for (const a of abandoned) {
    if (a.minutes >= CFG.session.wiltMinutes && !days.has(a.date)) dryDays.set(a.date, Math.max(dryDays.get(a.date) ?? 0, a.minutes));
  }
  const dry = { ...W.dry, months: undefined } as SpeciesDef;
  for (const [date, minutes] of dryDays) {
    out.push({ id: date, date, month: date.slice(0, 7), species: dry, stage: W.stages[2], stageIndex: 2, name: W.dry.name, icon: W.dry.icon, minutes, manual: 0, dry: true, glow: false, flowers: false });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Ormana kendiliğinden gelen canlılar (satın alınamaz) */
export function creaturesOf(treeCount: number) {
  return W.creatures.filter((c) => treeCount >= c.trees);
}

// ---------- Başlangıç yerleşimleri ----------
/** Yeni evin odası: başlangıç eşyaları ücretsiz. Bütün haritalarda geçerli yerlerde. */
export const DEFAULT_ROOM: SpaceLayout = {
  floor: 'zemin:ahsap',
  wall: 'duvar:krem',
  items: [
    { item: 'mob:yatak', x: 0, y: 0, rot: 0 },
    { item: 'mob:kitaplik', x: 2, y: 0, rot: 0 },
    { item: 'mob:masa', x: 5, y: 0, rot: 0 },
    { item: 'mob:sandalye', x: 5, y: 1, rot: 180 },
    { item: 'isik:ayakli', x: 7, y: 0, rot: 0 },
    { item: 'bitki:saksi', x: 8, y: 0, rot: 0 },
    { item: 'hali:dikdortgen', x: 4, y: 4, rot: 0 },
  ],
};

/** Kaplama seçilmemişken görünen zemin/duvar (sahip olmak gerekmez) */
export function defaultCover(space: SpaceId, slot: 'floor' | 'wall', ctx: Pick<WorldCtx, 'rooms'>): string {
  const r = isRoom(space) ? roomOf(space, ctx) : undefined;
  if (r) return kindById(r.kind)[slot];
  return slot === 'floor' ? 'zemin:ahsap' : 'duvar:krem';
}

export const emptyLayout = (space: SpaceId): SpaceLayout =>
  space === 'room' ? structuredClone(DEFAULT_ROOM) : space === 'library' ? { floor: 'zemin:ahsap', wall: 'duvar:krem', items: [] } : { items: [] };
