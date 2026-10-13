// Dünya: ev (oda, kütüphane, evin bahçesi) ve aylık ağaç bahçeleri aynı karo ızgarasını ve aynı yerleştirme
// kurallarını kullanır. Buradaki saf fonksiyonlar SQL'deki save_space doğrulamasının aynısıdır
// (0015_world_v2.sql); demo API, 3D sahne ve testler bunları kullanır. Sayılar src/config/economy.json → world.
//
// Koordinatlar: x sağa, y öne (kameraya doğru) artar; karo (x, y) 3D'de (x + 0.5, 0, y + 0.5) merkezlidir.
// Duvar eşyaları arka duvarda y = -1 (x boyunca) ya da sol duvarda x = -1 (y boyunca) durur.
// Alanlar tek bir bağlı dünyada yan yana durur (worldPlan.ts): kütüphane | oda, önünde bahçe, doğuda orman yolu
// ve ay bahçeleri. Arazi toplam saatle yerinde büyür (aşama, saklanmaz). Her gün bir ağaç: çalışılan her gün o
// ayın bahçesinde kendi yerine (takvim düzeni) bir ağaç dikilir.
import { itemById, type Item } from './catalog';
import { CFG, type FixedTile, type HomeSpace, type MapDef, type MonthSpace, type SpaceId, type SpeciesDef, type StageDef } from './config';
import { rng } from './rng';
import type { Abandoned, StudyLog } from './types';

export type { SpaceId, HomeSpace, MonthSpace };
const W = CFG.world;

export interface Tile {
  x: number;
  y: number;
}

export interface PlacedItem {
  item: string;
  x: number;
  y: number;
  rot: number;
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

// ---------- Alanlar ----------
export const isMonthSpace = (s: string): s is MonthSpace => /^m:\d{4}-\d{2}$/.test(s);
export const monthSpace = (month: string): MonthSpace => `m:${month}`;
export const isHome = (s: string): s is HomeSpace => s === 'room' || s === 'library' || s === 'garden';
export const isIndoor = (s: SpaceId) => s === 'room' || s === 'library';
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
    if (i !== skip && it?.surface && it.placement !== 'wall') footprint(it, p.x, p.y, p.rot).forEach((t) => out.add(key(t.x, t.y)));
  });
  return out;
}

function layerOf(it: Item, tiles: Tile[], surfaces: Set<string>): Layer | null {
  if (it.placement === 'wall') return 'duvar';
  if (it.walk) return 'zemin';
  if (!it.small) return 'esya';
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

function monthProblem(space: SpaceId, ctx: WorldCtx): string | null {
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
  const used = new Map<string, number>();
  for (const [index, p] of layout.items.entries()) {
    const r = placeProblem(space, ctx, p, taken, surfaces);
    if (typeof r === 'string') return { message: r, index };
    r.tiles.forEach((t) => taken[r.layer].add(key(t.x, t.y)));
    used.set(p.item, (used.get(p.item) ?? 0) + 1);
  }
  for (const [id, n] of used) {
    if (n + usedElsewhere(id) > ownedCount(itemById(id)!)) return { message: `${itemById(id)!.name} envanterinde yok`, index: layout.items.findIndex((p) => p.item === id) };
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
  if (!it?.surface) return [];
  const mine = new Set(footprint(it, base.x, base.y, base.rot).map((t) => key(t.x, t.y)));
  const rest = surfaceTiles(layout.items, index);
  return layout.items.flatMap((p, i) => {
    const s = itemById(p.item);
    if (i === index || !s?.small) return [];
    const tiles = footprint(s, p.x, p.y, p.rot);
    // Bu yüzeyin üstündeyse (başka bir yüzey tek başına taşımıyorsa) onunla gider
    return tiles.some((t) => mine.has(key(t.x, t.y))) && !tiles.every((t) => rest.has(key(t.x, t.y))) ? [i] : [];
  });
}

/** Küçük eşyanın yüksekliği: bir yüzeyin üstündeyse o yüzeyin sırası */
export function supportOf(layout: SpaceLayout, p: PlacedItem, ignore = -1): number | null {
  const it = itemById(p.item);
  if (!it?.small) return null;
  const tiles = footprint(it, p.x, p.y, p.rot);
  for (const [i, q] of layout.items.entries()) {
    const s = itemById(q.item);
    if (i === ignore || !s?.surface) continue;
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
  for (const p of items) {
    const it = itemById(p.item);
    const r = placeProblem(space, ctx, p, taken, surfaces);
    if (!it || typeof r === 'string') continue;
    const n = (used.get(p.item) ?? 0) + 1;
    if (n + usedElsewhere(p.item) > ownedCount(it)) continue;
    used.set(p.item, n);
    r.tiles.forEach((t) => taken[r.layer].add(key(t.x, t.y)));
    keep.push(p);
  }
  const cover = (id: string | null | undefined, cat: 'zemin' | 'duvar') => {
    const it = id ? itemById(id) : undefined;
    return isIndoor(space) && it && it.category === cat && ownedCount(it) > 0 ? id : undefined;
  };
  const out: SpaceLayout = { items: keep };
  if (isIndoor(space)) {
    out.floor = cover(layout.floor, 'zemin') ?? 'zemin:ahsap';
    out.wall = cover(layout.wall, 'duvar') ?? 'duvar:krem';
  }
  return { layout: out, dropped: items.length - keep.length };
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
  const kind = item.use === 'sit' || item.use === 'lie' || item.use === 'swing' ? item.use : null;
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
  const order = item.use === 'lie' ? [left, right, f, back] : [f, left, right, back];
  for (const d of order) for (const t of side(d)) if (free(t)) return t;
  return null;
}

/** Aç/kapa durumunun anahtarı: alan + eşya + yer (eşya taşınınca varsayılana döner) */
export const powerKey = (space: SpaceId, p: PlacedItem) => `${space}|${p.item}@${p.x},${p.y}`;

/** Açık mı: ışık varsayılan açık (bugünkü görünüş), TV ve ateş kapalı */
export function isOn(item: Item, k: string, power: Record<string, boolean>): boolean {
  if (item.use !== 'light' && item.use !== 'tv' && item.use !== 'fire') return false;
  return power[k] ?? item.use === 'light';
}

// ---------- Yürüme ----------
/** Alanın yürünemeyen karoları: ev, su, raf, ekim yerleri ve zemin katmanında olmayan eşyalar */
export function blockedTiles(space: SpaceId, layout: SpaceLayout, ctx: WorldCtx): Set<string> {
  const out = new Set<string>();
  for (const [k, f] of fixedTiles(space, ctx)) if (solid(f)) out.add(k);
  for (const p of layout.items) {
    const it = itemById(p.item);
    if (it && !it.walk && it.placement !== 'wall') footprint(it, p.x, p.y, p.rot).forEach((t) => out.add(key(t.x, t.y)));
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

export const emptyLayout = (space: SpaceId): SpaceLayout =>
  space === 'room' ? structuredClone(DEFAULT_ROOM) : space === 'library' ? { floor: 'zemin:ahsap', wall: 'duvar:krem', items: [] } : { items: [] };
