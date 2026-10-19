// Dünya: evin odaları (oda, kütüphane, eklenen odalar ve teraslar) aynı karo ızgarasını ve aynı yerleştirme
// kurallarını kullanır. Buradaki saf fonksiyonlar SQL'deki save_space doğrulamasının aynısıdır
// (0034_rooms_v3.sql); demo API, 3D sahne ve testler bunları kullanır. Sayılar src/config/economy.json → world.
//
// Koordinatlar: x sağa, y öne (kameraya doğru) artar; karo (x, y) 3D'de (x + 0.5, 0, y + 0.5) merkezlidir.
// Duvar eşyaları arka duvarda y = -1 (x boyunca) ya da sol duvarda x = -1 (y boyunca) durur.
// Habbo gibi her oda ayrı bir yerdir (worldPlan.ts → spacePlan): biri seçilir, kapılardan ötekilere geçilir.
// Oda ve kütüphane toplam saatle yerinde büyür (aşama, saklanmaz). Her gün bir ağaç: çalışılan her gün o ayın
// bahçesinde (Bahçem sayfası, süslenmez) kendi yerine (takvim düzeni) bir ağaç dikilir.
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
import type { StudyLog, UserRoom } from './types';

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
  /** Masa üstündeki çeyrek eşyasının (items.json → quarter) çeyreği (0 sol üst, 1 sağ üst, 2 sol alt, 3 sağ alt); yoksa bütün karo */
  sub?: number;
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
// Kilit yok: çocuk istediği kadar (en çok maxRooms) oda ekler; türünü (adı, simgesi, varsayılan kaplaması; teras
// açık havadır), şeklini (Habbo modelleri gibi şablon, sonra blok düzenleyicide karo karo) ve adını seçer.
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
export const kindById = (id: string): RoomKind => ROOM_KINDS.find((k) => k.id === id) ?? ROOM_KINDS.find((k) => k.id === 'free') ?? ROOM_KINDS[0];
export const shapeById = (id: string): RoomShape | undefined => ROOM_SHAPES.find((s) => s.id === id);
/** Şablonun bir boyuttaki ölçüsü ve kesikleri (bilinmeyen şablon: küçük kare) */
export const cellsOf = (shape: string, size: RoomSize): RoomCells => shapeById(shape)?.sizes[size] ?? ROOM_SHAPES[0].sizes.s;
/** Odanın zemini: blok düzenleyicide çizilen şekil, yoksa şablonu */
export const roomCells = (r: Pick<UserRoom, 'shape' | 'size' | 'cells'>): RoomCells => r.cells ?? cellsOf(r.shape, r.size);
/** Odanın zemini mi (kesik değil, alanın içinde) */
export function inCells(c: RoomCells, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
  return !(c.cut ?? []).some(([cx, cy, cw, ch]) => x >= cx && x < cx + cw && y >= cy && y < cy + ch);
}
/** Kapıların satırı: 5 (kısa odada son satır) */
export const doorRow = (c: RoomCells) => Math.min(5, c.h - 1);

/**
 * Odanın sabitleri: batı kapısı (bir önceki odaya), doğu kapısı (sonrakine; doğu sütunu o satırda kesikse en
 * doğudaki zemin karosu), arka duvarda pencere (terasta yok), kesikler (boşluk).
 */
export function roomFixed(c: RoomCells, outdoor = false): FixedTile[] {
  const y = doorRow(c);
  let ex = c.w - 1;
  while (ex > 0 && !inCells(c, ex, y)) ex--;
  return [
    { kind: 'door', x: 0, y, edge: 'w' },
    ...(ex > 0 ? [{ kind: 'door', x: ex, y, edge: 'e' } as FixedTile] : []),
    ...(outdoor || c.w < 4 ? [] : [{ kind: 'window', x: Math.max(1, Math.floor(c.w / 2) - 1), y: -1, w: 2 } as FixedTile]),
    ...(c.cut ?? []).map(([x, y, w, h]): FixedTile => ({ kind: 'void', x, y, w, h })),
  ];
}

/** Zemin karolarının sayısı */
export function cellCount(c: RoomCells): number {
  let n = 0;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (inCells(c, x, y)) n++;
  return n;
}

/** En az bu kadar karo */
export const MIN_CELLS = 6;

/**
 * Blok düzenleyicinin şekli geçerli mi (sunucuda room_cells_check ile aynı): kutu 3…roomMax, kesikler kutunun içinde,
 * arka sıra (y 0) ve sol sütun (x 0) hep dolu (duvarlar, pencere ve duvar eşyaları için), en az MIN_CELLS karo,
 * bütün karolar birbirine bağlı.
 */
export function roomCellsProblem(c: unknown): string | null {
  const q = c as RoomCells | null;
  if (!q || typeof q !== 'object' || !Number.isInteger(q.w) || !Number.isInteger(q.h)) return 'Odanın şekli geçersiz';
  if (q.w < 3 || q.h < 3 || q.w > W.roomMax.w || q.h > W.roomMax.h) return `Oda en az 3×3, en çok ${W.roomMax.w}×${W.roomMax.h} karo olur`;
  const cut = q.cut ?? [];
  if (!Array.isArray(cut) || cut.length > q.w * q.h) return 'Odanın şekli geçersiz';
  for (const r of cut) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger)) return 'Odanın şekli geçersiz';
    const [x, y, w, h] = r;
    if (w < 1 || h < 1 || x < 0 || y < 0 || x + w > q.w || y + h > q.h) return 'Odanın şekli geçersiz';
    if (x === 0 || y === 0) return 'Arka sıra ve sol sütun duvar dibi: hep dolu kalır';
  }
  const n = cellCount(q);
  if (n < MIN_CELLS) return `Oda en az ${MIN_CELLS} karo olur`;
  // Bağlı mı: (0,0)'dan yayıl
  const seen = new Set<string>(['0,0']);
  const todo: Tile[] = [{ x: 0, y: 0 }];
  while (todo.length) {
    const t = todo.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = t.x + dx;
      const y = t.y + dy;
      const k = key(x, y);
      if (!seen.has(k) && inCells(q, x, y)) {
        seen.add(k);
        todo.push({ x, y });
      }
    }
  }
  return seen.size === n ? null : 'Odanın bütün karoları birbirine bağlı olmalı';
}

/** Şekli 1×1 karolardan kurar: kutunun dışındaki ya da kesik karolar (blok düzenleyici) */
export function cellsFrom(w: number, h: number, floor: (x: number, y: number) => boolean): RoomCells {
  const cut: [number, number, number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!floor(x, y)) cut.push([x, y, 1, 1]);
  return cut.length ? { w, h, cut } : { w, h };
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
export function roomInputProblem(r: { kind: string; shape: string; size: string; name: string; cells?: RoomCells | null }): string | null {
  if (!ROOM_KINDS.some((k) => k.id === r.kind)) return 'Oda türü yok';
  if (!shapeById(r.shape)) return 'Oda şekli yok';
  if (!ROOM_SIZES.some((z) => z.id === r.size)) return 'Oda boyu yok';
  const n = (r.name ?? '').trim();
  if (n.length < 1 || n.length > 24) return 'Odanın adı 1–24 harf olmalı';
  return r.cells == null ? null : roomCellsProblem(r.cells);
}
/** Alanın zemin ölçüsü ve kesikleri (oda değilse dikdörtgen) */
export function spaceCells(space: SpaceId, ctx: WorldCtx): RoomCells {
  const r = isRoom(space) ? roomOf(space, ctx) : undefined;
  if (r) return roomCells(r);
  return spaceSize(space, ctx);
}

// ---------- Alanlar ----------
export const isMonthSpace = (s: string): s is MonthSpace => /^m:\d{4}-\d{2}$/.test(s);
export const monthSpace = (month: string): MonthSpace => `m:${month}`;
export const isHome = (s: string): s is HomeSpace => s === 'room' || s === 'library' || isRoom(s);
/** Açık hava odası (teras): duvarı ve kaplaması yok, dış mekân eşyaları konur */
export const isTerrace = (s: string, ctx: Pick<WorldCtx, 'rooms'>) => {
  const r = isRoom(s) ? roomOf(s, ctx) : undefined;
  return !!r && !!kindById(r.kind).outdoor;
};
/** Evin içi: oda, kütüphane ve teras olmayan eklenen odalar */
export const isIndoor = (s: string, ctx: Pick<WorldCtx, 'rooms'>) => s === 'room' || s === 'library' || (isRoom(s) && !isTerrace(s, ctx));
export const isOutdoor = (s: SpaceId, ctx: Pick<WorldCtx, 'rooms'>) => isMonthSpace(s) || isTerrace(s, ctx);

export const shiftMonth = (month: string, n: number) => {
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
    return r ? { w: roomCells(r).w, h: roomCells(r).h } : { w: 0, h: 0 };
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
    return r ? roomFixed(roomCells(r), !!kindById(r.kind).outdoor) : [];
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
  if (!isIndoor(space, ctx)) return out;
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

/** Bu alana konabilir mi: duvar eşyası içeride, iç/dış mekân eşyası kendi yerinde (dış mekân: teras) */
export const fitsSpace = (item: Item, space: SpaceId, ctx: Pick<WorldCtx, 'rooms'>) => {
  if (item.placement === 'wall') return isIndoor(space, ctx);
  if (item.placement === 'both') return true;
  return isOutdoor(space, ctx) ? item.placement === 'outdoor' : item.placement === 'indoor';
};

/**
 * Katmanlar: zemin (halı, yol: üstünden yürünür, mobilya üstüne konabilir), eşya, üst (masanın üstündeki
 * küçük eşya), duvar. Küçük eşya ya bütünüyle yüzeyin üstünde ya bütünüyle yerdedir. Üst katmanda her karo dört
 * çeyrektir: çeyrek eşyası (`quarter`) birini, ötekiler hepsini kaplar.
 */
type Layer = 'zemin' | 'esya' | 'ust' | 'duvar';

export const SUBS = [0, 1, 2, 3] as const;
/** Çeyreğin karo ortasına göre kayması (x, y) */
export const subOffset = (sub: number): [number, number] => [sub % 2 ? 0.25 : -0.25, sub >= 2 ? 0.25 : -0.25];
const validSub = (sub: unknown): sub is number => Number.isInteger(sub) && (sub as number) >= 0 && (sub as number) <= 3;

/** Katmanda kaplanan yerler: üst katmanda çeyrek çeyrek */
function takenKeys(layer: Layer, tiles: Tile[], sub?: number): string[] {
  if (layer !== 'ust') return tiles.map((t) => key(t.x, t.y));
  return tiles.flatMap((t) => (sub === undefined ? SUBS : [sub]).map((q) => `${key(t.x, t.y)}:${q}`));
}

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
function placeProblem(space: SpaceId, ctx: WorldCtx, p: PlacedItem, taken: Taken, surfaces: Set<string>): string | { layer: Layer; keys: string[] } {
  const it = itemById(p.item);
  if (!it || !it.placement) return 'Bu eşya yerleştirilemez';
  const bad = stateProblem(it, p);
  if (bad) return bad;
  if (!fitsSpace(it, space, ctx)) return it.placement === 'wall' ? 'Duvar süsü yalnızca odalara asılır' : isOutdoor(space, ctx) ? 'Bu eşya içeride durur' : 'Bu eşya terasta durur';
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
    return { layer: 'duvar', keys: takenKeys('duvar', tiles) };
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
  if (p.sub !== undefined && (!it.quarter || layer !== 'ust' || !validSub(p.sub))) return 'Yerleşim geçersiz';
  const keys = takenKeys(layer, tiles, p.sub);
  for (const k of keys) if (taken[layer].has(k)) return 'Bu karo dolu';
  return { layer, keys };
}

// ---------- Eşyanın kendi durumu ----------
const PLACED_KEYS = new Set(['item', 'x', 'y', 'rot', 'on', 'open', 'color', 'stored', 'fed', 'sub']);

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
  // Ağaç bahçeleri yalnızca ağaçların: eşya konmaz (Bahçem sayfası)
  return isMonthSpace(space) ? 'Ağaç bahçesi süslenmez' : null;
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
    if (!isIndoor(space, ctx) || !it || it.category !== cat || ownedCount(it) < 1) return { message: 'Bu kaplama sende yok' };
  }
  const surfaces = surfaceTiles(layout.items);
  const taken = emptyTaken();
  for (const [index, p] of layout.items.entries()) {
    const r = placeProblem(space, ctx, p, taken, surfaces);
    if (typeof r === 'string') return { message: r, index };
    r.keys.forEach((k) => taken[r.layer].add(k));
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
    if (layer) takenKeys(layer, tiles, q.sub).forEach((k) => taken[layer].add(k));
  }
  return typeof placeProblem(space, ctx, p, taken, surfaces) !== 'string';
}

/**
 * Masa üstü mıknatısı: elde tutulan küçük eşya (ON_SURFACE) bir yüzeyin (STACKABLE) üstüne ya da yarım karo
 * yakınına gelince yüzeyin en yakın boş yerine oturur; çeyrek eşyası (kupa, lamba) karonun en yakın çeyreğine.
 * Boş yer yoksa en yakın yer (kırmızı önizleme). `pointAt`: imlecin o yüzeyin üst yüksekliğindeki yeri (alanın
 * yerel karo koordinatında, kesirli; kamera eğik baktığı için her yüzeyin yüksekliğine göre ayrı). Yakında
 * yüzey yoksa null (eşya imlecin altındaki karoya).
 */
export function snapToSurface(
  space: SpaceId,
  layout: SpaceLayout,
  ctx: WorldCtx,
  held: { item: string; rot: number },
  pointAt: (surface: PlacedItem) => { x: number; y: number },
): (Tile & { sub?: number }) | null {
  const it = itemById(held.item);
  if (!it || !has(it, 'ON_SURFACE') || it.placement === 'wall') return null;
  const [w, h] = footSize(it, held.rot);
  let best: (Tile & { sub?: number }) | null = null;
  let bestD = Infinity;
  let bestFree = false;
  for (const q of layout.items) {
    const s = itemById(q.item);
    if (!s || !has(s, 'STACKABLE') || s.placement === 'wall') continue;
    const pt = pointAt(q);
    const [sw, sh] = footSize(s, q.rot);
    if (pt.x < q.x - 0.5 || pt.y < q.y - 0.5 || pt.x > q.x + sw + 0.5 || pt.y > q.y + sh + 0.5) continue;
    for (let y = q.y; y + h <= q.y + sh; y++) {
      for (let x = q.x; x + w <= q.x + sw; x++) {
        for (const sub of it.quarter ? SUBS : [undefined]) {
          const [ox, oy] = sub === undefined ? [0, 0] : subOffset(sub);
          const d = Math.hypot(x + w / 2 + ox - pt.x, y + h / 2 + oy - pt.y);
          const cand: PlacedItem = { item: held.item, x, y, rot: held.rot, ...(sub === undefined ? {} : { sub }) };
          const free = canPlaceAt(space, layout, ctx, cand);
          if ((free && !bestFree) || (free === bestFree && d < bestD)) {
            best = sub === undefined ? { x, y } : { x, y, sub };
            bestD = d;
            bestFree = free;
          }
        }
      }
    }
  }
  return best;
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
export function moveItemTo(space: SpaceId, layout: SpaceLayout, index: number, to: Tile & { sub?: number }, rot: number, ctx: WorldCtx): SpaceLayout | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it) return null;
  const base = removeItemAt(layout, index);
  // Durumu (açık, renk, içindekiler) onunla gider
  const { sub: _sub, ...state } = p;
  const q: PlacedItem = { ...state, x: to.x, y: to.y, rot: it.placement === 'wall' ? wallRot(to.x, to.y) : rot, ...(to.sub === undefined ? {} : { sub: to.sub }) };
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
  if (isMonthSpace(space)) return { layout: { items: [] }, dropped: items.length };
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
    let p = cleanState(it, raw);
    let r = placeProblem(space, ctx, p, taken, surfaces);
    // Çeyreği artık geçmiyorsa (yüzey kalktı, çeyrek dolu) bütün karo olarak denenir
    if (typeof r === 'string' && p.sub !== undefined) {
      const { sub: _sub, ...rest } = p;
      p = rest;
      r = placeProblem(space, ctx, p, taken, surfaces);
    }
    if (typeof r === 'string' || !take(p.item, it)) continue;
    if (p.stored) p.stored = p.stored.filter((id) => take(id, itemById(id)!));
    r.keys.forEach((k) => taken[r.layer].add(k));
    keep.push(p);
  }
  const cover = (id: string | null | undefined, cat: 'zemin' | 'duvar') => {
    const it = id ? itemById(id) : undefined;
    return isIndoor(space, ctx) && it && it.category === cat && ownedCount(it) > 0 ? id : undefined;
  };
  const out: SpaceLayout = { items: keep };
  if (isIndoor(space, ctx)) {
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
  if (it.quarter && validSub(p.sub)) out.sub = p.sub;
  return out;
}

// ---------- Eşyayı kullanmak: otur, yat, sallan, aç-kapa ----------
export type Pose = 'sit' | 'lie' | 'swing';

/** Eşyanın önü: dönüşe göre (0° güney/kameraya doğru, 90° batı, 180° kuzey, 270° doğu) */
const FRONT: Record<number, Tile> = { 0: { x: 0, y: 1 }, 90: { x: -1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: 1, y: 0 } };
/** Dönüşün baktığı yön (bir karo) */
export const dirOf = (rot: number): Tile => FRONT[rot] ?? FRONT[0];

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
 * Ders çalışma yeri (STUDY masası): masanın önünde, masaya dönük oturuş (alanın yerel koordinatında 3D konum).
 * Önündeki karoda sandalye (SIT) varsa onun oturağında; yoksa tabure çizilir (`stool`). Masa değilse null.
 */
export function studySpot(layout: SpaceLayout, index: number): { x: number; z: number; y: number; face: number; stool: boolean } | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it || !has(it, 'STUDY')) return null;
  const [w, h] = footSize(it, p.rot);
  const f = FRONT[p.rot] ?? FRONT[0];
  let x = p.x + w / 2 + f.x * (w / 2 + 0.42);
  let z = p.y + h / 2 + f.y * (h / 2 + 0.42);
  // Masanın önündeki şerit (ortadakiler önce): orada bir sandalye varsa onun karosunda oturulur
  const strip: Tile[] = f.y
    ? Array.from({ length: w }, (_, i) => ({ x: p.x + i, y: f.y > 0 ? p.y + h : p.y - 1 }))
    : Array.from({ length: h }, (_, i) => ({ x: f.x > 0 ? p.x + w : p.x - 1, y: p.y + i }));
  const mid = (strip.length - 1) / 2;
  const off = (t: Tile) => Math.abs((f.y ? t.x - p.x : t.y - p.y) - mid);
  strip.sort((a, b) => off(a) - off(b));
  let chair: Item | undefined;
  for (const t of strip) {
    const q = layout.items.find((q) => {
      const c = itemById(q.item);
      return c && poseOf(c) === 'sit' && footprint(c, q.x, q.y, q.rot).some((u) => u.x === t.x && u.y === t.y);
    });
    if (!q) continue;
    chair = itemById(q.item);
    if (f.y) x = t.x + 0.5;
    else z = t.y + 0.5;
    break;
  }
  return { x, z, y: chair?.seat ?? 0.45, face: Math.PI - (p.rot * Math.PI) / 180, stool: !chair };
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
  // Yatağa yandan; atlama tahtasına arkadan (önü havuz)
  const order = has(item, 'LAY') ? [left, right, f, back] : has(item, 'DIVE') ? [back, left, right, f] : [f, left, right, back];
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
export type ActionId =
  | 'sit'
  | 'lie'
  | 'swing'
  | 'stand'
  | 'toggle'
  | 'open'
  | 'color'
  | 'storage'
  | 'dispense'
  | 'sound'
  | 'feed'
  | 'books'
  | 'music'
  | 'notes'
  | 'stats'
  | 'study'
  | 'teleport'
  | 'roll'
  | 'dive';
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
      item.fx === 'fire' ? (on ? '🔥 Söndür' : '🔥 Yak') : item.fx === 'tv' ? (on ? '📺 Kapat' : '📺 Aç') : item.fx === 'anim' ? (on ? '⏹️ Durdur' : '▶️ Çalıştır') : item.fx === 'steam' ? (on ? '⏹️ Kapat' : '♨️ Çalıştır') : on ? '💡 Kapat' : '💡 Aç';
    out.push({ id: 'toggle', label });
  }
  if (has(item, 'TELEPORT')) out.push({ id: 'teleport', label: '🌀 Işınlan' });
  if (has(item, 'ROLL')) out.push({ id: 'roll', label: '🎲 Zar at' });
  if (has(item, 'DIVE')) out.push({ id: 'dive', label: '🤸 Atla' });
  if (has(item, 'GATE')) out.push({ id: 'open', label: isOpen(item, p) ? '🚧 Kapıyı kapat' : '🚪 Kapıyı aç' });
  else if (has(item, 'OPEN_CLOSE')) out.push({ id: 'open', label: isOpen(item, p) ? '🔒 Kapağı kapat' : '🔓 Kapağı aç' });
  if (has(item, 'CHANGE_COLOR') && (item.palette?.length ?? 0) > 1) out.push({ id: 'color', label: '🎨 Renk' });
  if (has(item, 'STORAGE')) out.push({ id: 'storage', label: `📦 İçi ${p.stored?.length ?? 0}/${item.capacity ?? 0}` });
  if (has(item, 'DISPENSE')) out.push({ id: 'dispense', label: DISPENSE_LABEL[item.dispense ?? ''] ?? '🎁 Al' });
  if (has(item, 'PLAY_SOUND')) out.push({ id: 'sound', label: '🎵 Çal' });
  if (has(item, 'INTERACT_PET') && p.fed !== o.today) out.push({ id: 'feed', label: '🥣 Mama koy' });
  if (has(item, 'BOOKS')) out.push({ id: 'books', label: '📚 Rafları aç' });
  if (has(item, 'STATS')) out.push({ id: 'stats', label: '📊 Kayıtlarım' });
  if (has(item, 'MUSIC')) out.push({ id: 'music', label: '🎧 Müzik' });
  if (has(item, 'NOTES')) out.push({ id: 'notes', label: '📌 Notlarım' });
  if (has(item, 'STUDY')) out.push({ id: 'study', label: '📖 Ders çalış' });
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

// ---------- Oyun eşyaları: havuz, ışınlayıcı, yürüyen bant, top, atlama tahtası ----------
/** Havuz suyu karoları (SWIM eşyalarının ayak izi; alanın yerel koordinatı) */
export function swimTiles(layout: SpaceLayout): Set<string> {
  const out = new Set<string>();
  for (const p of layout.items) {
    const it = itemById(p.item);
    if (it && has(it, 'SWIM')) footprint(it, p.x, p.y, p.rot).forEach((t) => out.add(key(t.x, t.y)));
  }
  return out;
}

/** Karonun içinde mi (alanın kutusu) */
const inBox = (space: SpaceId, ctx: WorldCtx, t: Tile) => {
  const { w, h } = spaceSize(space, ctx);
  return t.x >= 0 && t.y >= 0 && t.x < w && t.y < h;
};

/**
 * Yürüyen bant (CONVEY): `t` karosunda bant varsa baktığı yöndeki karo (boş ve odanın içindeyse); yoksa null.
 * Karakter durunca bir karo taşınır, zincirlenir (bant bandı izler).
 */
export function conveyStep(space: SpaceId, layout: SpaceLayout, ctx: WorldCtx, t: Tile): Tile | null {
  const belt = layout.items.find((p) => {
    const it = itemById(p.item);
    return it && has(it, 'CONVEY') && footprint(it, p.x, p.y, p.rot).some((q) => q.x === t.x && q.y === t.y);
  });
  if (!belt) return null;
  const d = dirOf(belt.rot);
  const to = { x: t.x + d.x, y: t.y + d.y };
  if (!inBox(space, ctx, to) || blockedTiles(space, layout, ctx).has(key(to.x, to.y))) return null;
  return to;
}

/**
 * Topa vur (KICK): `index`teki eşya `dir` yönünde en çok `max` karo yuvarlanır; engelde, duvarda ya da konamayacağı
 * yerde durur. Eşya aynı sırada kalır (çizimde kayarak gider). Hiç kıpırdayamazsa null.
 */
export function kickItem(space: SpaceId, layout: SpaceLayout, index: number, dir: Tile, ctx: WorldCtx, max = 3): SpaceLayout | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it || !has(it, 'KICK')) return null;
  const blocked = blockedTiles(space, layout, ctx);
  let at = { x: p.x, y: p.y };
  for (let i = 0; i < max; i++) {
    const q = { ...p, x: at.x + dir.x, y: at.y + dir.y };
    if (!inBox(space, ctx, q) || blocked.has(key(q.x, q.y)) || !canPlaceAt(space, layout, ctx, q, index)) break;
    at = { x: q.x, y: q.y };
  }
  if (at.x === p.x && at.y === p.y) return null;
  return { ...layout, items: layout.items.map((q, i) => (i === index ? { ...q, x: at.x, y: at.y } : q)) };
}

/**
 * Işınlayıcının eşi (TELEPORT): evin alanlarında (order sırasıyla) aynı renkteki ışınlayıcılardan bundan sonraki
 * (sonuncudan ilkine döner). Tek başınaysa null.
 */
export function teleportTarget(spaces: Partial<Record<SpaceId, SpaceLayout>>, order: SpaceId[], from: { space: SpaceId; index: number }): { space: SpaceId; index: number } | null {
  const color = (q: PlacedItem) => q.color ?? 0;
  const me = spaces[from.space]?.items[from.index];
  if (!me) return null;
  const all: { space: SpaceId; index: number }[] = [];
  for (const sp of order)
    spaces[sp]?.items.forEach((q, i) => {
      const it = itemById(q.item);
      if (it && has(it, 'TELEPORT') && color(q) === color(me)) all.push({ space: sp, index: i });
    });
  if (all.length < 2) return null;
  const k = all.findIndex((r) => r.space === from.space && r.index === from.index);
  return k < 0 ? null : all[(k + 1) % all.length];
}

/** Işınlayıcıdan çıkış: kabinin ortası ve önündeki boş karo (yoksa kabinin kendisi) */
export function teleportExit(item: Item, p: PlacedItem, w: number, h: number, blocked: Set<string>): { x: number; z: number; out: Tile } {
  const [fw, fh] = footSize(item, p.rot);
  return { x: p.x + fw / 2, z: p.y + fh / 2, out: approachTile(item, p, w, h, blocked) ?? { x: p.x, y: p.y } };
}

/**
 * Atlama tahtası (DIVE): tahtanın ortası, ucu (önü) ve düşülecek su karosu (alanın yerel koordinatı, 3D konum).
 * Önündeki karo havuz değilse null.
 */
export function diveSpot(layout: SpaceLayout, index: number): { board: { x: number; z: number }; tip: { x: number; z: number }; land: Tile } | null {
  const p = layout.items[index];
  const it = p && itemById(p.item);
  if (!it || !has(it, 'DIVE')) return null;
  const [w, h] = footSize(it, p.rot);
  const d = dirOf(p.rot);
  const land = { x: p.x + (d.x > 0 ? w : d.x < 0 ? -1 : Math.floor(w / 2)), y: p.y + (d.y > 0 ? h : d.y < 0 ? -1 : Math.floor(h / 2)) };
  if (!swimTiles(layout).has(key(land.x, land.y))) return null;
  const cx = p.x + w / 2;
  const cz = p.y + h / 2;
  return { board: { x: cx, z: cz }, tip: { x: cx + d.x * 0.45, z: cz + d.y * 0.45 }, land };
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

/**
 * Yolu yumuşatır (ip çekme): karo karo A* yolundan, arası düz çizgiyle yürünebilen ara noktaları atar; karakter
 * köşelerde zikzak yapmadan çapraz gider. Çizgi (ve karakterin iki yanı, ±0.28) yalnızca boş karolardan geçmeli ve
 * her karo geçişi `step` kuralına uymalı (duvar/çit kapı dışında aşılmaz). Son karo hep kalır.
 */
export function smoothPath(from: Tile, path: Tile[], blocked: Set<string>, step?: Step): Tile[] {
  if (path.length < 2) return path;
  const ok = (a: Tile, b: Tile) => !step || step(a, b);
  /** a karosundan b karosuna (komşu ya da çapraz) geçilebilir mi */
  const pass = (a: Tile, b: Tile) => {
    if (blocked.has(key(b.x, b.y))) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) <= 1) return ok(a, b);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    // Çapraz: iki ara karo da boş ve geçişler izinli olmalı (köşeden sıyrılmasın)
    const m1 = { x: b.x, y: a.y };
    const m2 = { x: a.x, y: b.y };
    return !blocked.has(key(m1.x, m1.y)) && !blocked.has(key(m2.x, m2.y)) && ok(a, m1) && ok(m1, b) && ok(a, m2) && ok(m2, b);
  };
  const line = (a: Tile, b: Tile, off: number) => {
    const ax = a.x + 0.5;
    const ay = a.y + 0.5;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!len) return true;
    const nx = (-dy / len) * off;
    const ny = (dx / len) * off;
    const n = Math.ceil(len * 8);
    let prev: Tile = { x: Math.floor(ax + nx), y: Math.floor(ay + ny) };
    if (blocked.has(key(prev.x, prev.y))) return false;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const cur = { x: Math.floor(ax + dx * t + nx), y: Math.floor(ay + dy * t + ny) };
      if (cur.x === prev.x && cur.y === prev.y) continue;
      if (!pass(prev, cur)) return false;
      prev = cur;
    }
    return true;
  };
  const sees = (a: Tile, b: Tile) => line(a, b, 0) && line(a, b, 0.28) && line(a, b, -0.28);
  const out: Tile[] = [];
  let anchor = from;
  let i = 0;
  while (i < path.length) {
    let j = i;
    while (j + 1 < path.length && sees(anchor, path[j + 1])) j++;
    out.push(path[j]);
    anchor = path[j];
    i = j + 1;
  }
  return out;
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
  /** Çok uzun gün (Nadir): ışıltılı yapraklar */
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

/** Günün ağaç türü: o gün seçilen tohum (seeds.ts), yoksa tarihten tohumlanır (hep aynı; mevsiminde olan türler daha sık çıkar) */
export function speciesOf(date: string, seeds?: Record<string, string>): SpeciesDef {
  const chosen = seeds?.[date] && W.species.find((s) => s.id === seeds[date]);
  if (chosen) return chosen;
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
 * Bütün ağaçlar: çalışma kaydı olan her gün bir ağaç (sayaç da elle yazılan süre de sayılır), türü seçilen tohumdan
 * ya da tarihten, büyüklüğü günün toplamından (Fidan · Genç · Tam · Nadir). Yarım kalan seans ağaç dikmez, kurutmaz da.
 * @param streakDays seri bonusu alan günler (dibinde çiçek açar)
 * @param seeds tarih → seçilen tohumun türü
 */
export function dayTrees(logs: StudyLog[], streakDays: Set<string> = new Set(), seeds?: Record<string, string>): DayTree[] {
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
    const species = speciesOf(date, seeds);
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
      glow: d.minutes >= W.glowMinutes,
      flowers: streakDays.has(date),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Ormana kendiliğinden gelen canlılar (satın alınamaz) */
export function creaturesOf(treeCount: number) {
  return W.creatures.filter((c) => treeCount >= c.trees);
}

// ---------- Başlangıç yerleşimleri ----------
/**
 * Yeni evin odası, Habbo'nunkiler gibi hazır döşenmiş: ücretsiz eşyalar + items.json'da "starter" olan eşyalar
 * (herkese birer tane bedava; sunucuda world_owned). Bütün haritalarda geçerli yerlerde (en küçük oda 12 × 10).
 */
export const DEFAULT_ROOM: SpaceLayout = {
  floor: 'zemin:balik-sirti',
  wall: 'duvar:puantiye',
  items: [
    // Uyku ve çalışma köşesi
    { item: 'mob:yatak', x: 0, y: 0, rot: 0 },
    { item: 'mob:kitaplik', x: 2, y: 0, rot: 0 },
    { item: 'mob:masa', x: 5, y: 0, rot: 0 },
    { item: 'mob:sandalye', x: 5, y: 1, rot: 180 },
    { item: 'isik:ayakli', x: 7, y: 0, rot: 0 },
    { item: 'bitki:saksi', x: 8, y: 0, rot: 0 },
    { item: 'hali:dikdortgen', x: 4, y: 4, rot: 0 },
    { item: 'isik:masa-lambasi', x: 6, y: 0, rot: 0 },
    // Televizyon köşesi: TV dolabının üstünde TV ve radyo, halının üstünde sehpa ve kanepe
    { item: 'mob:tv-dolabi', x: 9, y: 0, rot: 0 },
    { item: 'mob:eski-tv', x: 9, y: 0, rot: 0 },
    { item: 'mob:radyo', x: 10, y: 0, rot: 0 },
    { item: 'bitki:buyuk-saksi', x: 11, y: 0, rot: 0 },
    { item: 'hali:sari', x: 9, y: 2, rot: 0 },
    { item: 'mob:sehpa', x: 9, y: 2, rot: 0 },
    { item: 'mob:koltuk-pembe', x: 9, y: 3, rot: 180 },
    { item: 'set:muzik-armut', x: 11, y: 2, rot: 270 },
    // Oyun köşesi: halka halı ve iki puf
    { item: 'set:hali-yuvarlak', x: 2, y: 7, rot: 0 },
    { item: 'set:puf', x: 2, y: 8, rot: 0 },
    { item: 'set:puf-mavi', x: 3, y: 8, rot: 0 },
    { item: 'bitki:saksi2', x: 0, y: 9, rot: 0 },
    { item: 'set:bitki-monstera', x: 11, y: 9, rot: 0 },
    // Duvarlar: arka duvar (y = -1) ve sol duvar (x = -1)
    { item: 'duvar:gokkusagi', x: 0, y: -1, rot: 0 },
    { item: 'duvar:pano', x: 3, y: -1, rot: 0 },
    { item: 'duvar:saat', x: 8, y: -1, rot: 0 },
    { item: 'duvar:roket', x: 11, y: -1, rot: 0 },
    { item: 'isik:duvar', x: -1, y: 2, rot: 270 },
    { item: 'duvar:harita', x: -1, y: 7, rot: 270 },
  ],
};

/** Kaplama seçilmemişken görünen zemin/duvar (sahip olmak gerekmez; terasta boş: çim zemin, duvar yok) */
export function defaultCover(space: SpaceId, slot: 'floor' | 'wall', ctx: Pick<WorldCtx, 'rooms'>): string {
  const r = isRoom(space) ? roomOf(space, ctx) : undefined;
  if (r) return kindById(r.kind)[slot];
  return slot === 'floor' ? 'zemin:ahsap' : 'duvar:krem';
}

export const emptyLayout = (space: SpaceId): SpaceLayout =>
  space === 'room' ? structuredClone(DEFAULT_ROOM) : space === 'library' ? { floor: 'zemin:ahsap', wall: 'duvar:krem', items: [] } : { items: [] };
