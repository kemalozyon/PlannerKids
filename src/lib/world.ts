// Dünya: ev (oda, kütüphane) ve dış mekân (bahçe + aylık orman bölgeleri) aynı karo ızgarasını ve aynı
// yerleştirme kurallarını kullanır. Buradaki saf fonksiyonlar SQL'deki save_space doğrulamasının aynısıdır
// (0012_spaces.sql); demo API, 3D sahne ve testler bunları kullanır. Sayılar src/config/economy.json → world.
//
// Koordinatlar: x sağa, y öne (kameraya doğru) artar; karo (x, y) 3D'de (x + 0.5, 0, y + 0.5) merkezlidir.
// Dünyanın büyüklüğü yalnızca çalışmayla artar: bahçe toplam saate göre genişler, her ayın orman bölgesi
// o ay dikilen ağaçlarla büyür. Satın alınan eşyalar yalnızca süsler.
import { itemById, type Item } from './catalog';
import { CFG, type FixedTile, type Land, type SpaceId } from './config';
import { rng } from './rng';
import type { Abandoned, StudyLog } from './types';

export type { SpaceId };
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

/** Alan kurallarını etkileyen ilerleme */
export interface WorldCtx {
  /** Güvenilir toplam çalışma (dk): bahçe büyüklüğü */
  totalMinutes: number;
  /** Bitirilen kitap: kütüphane odası */
  booksDone: number;
}

export const key = (x: number, y: number) => `${x},${y}`;

// ---------- Arazi ve alanlar ----------
/** Açılan araziler (Açıklık → Dere → Tepe → Göl → Köprü → Sihirli koru) */
export function landsOf(totalMinutes: number): { unlocked: Land[]; current: Land; next: Land | null } {
  const unlocked = W.garden.lands.filter((l) => totalMinutes >= l.hours * 60);
  return { unlocked, current: unlocked.at(-1)!, next: W.garden.lands[unlocked.length] ?? null };
}

export function libraryOpen(ctx: WorldCtx): boolean {
  return ctx.booksDone >= W.library.books;
}

export function spaceSize(space: SpaceId, ctx: WorldCtx): { w: number; h: number } {
  if (space === 'garden') {
    const l = landsOf(ctx.totalMinutes).current;
    return { w: l.w, h: l.h };
  }
  return { w: W[space].w, h: W[space].h };
}

/** Alanın sabit karoları (kapı, ev, su, köprü, tepe, koru), karo karo; sonra gelen öncekini ezer (su üstünde köprü) */
export function fixedTiles(space: SpaceId, ctx: WorldCtx): Map<string, FixedTile> {
  const { w, h } = spaceSize(space, ctx);
  const lands = new Set(landsOf(ctx.totalMinutes).unlocked.map((l) => l.id));
  const out = new Map<string, FixedTile>();
  for (const f of W[space].fixed) {
    if (f.land && !lands.has(f.land)) continue;
    if (f.books && ctx.booksDone < f.books) continue;
    for (let y = f.y; y < Math.min(h, f.y + (f.h ?? 1)); y++) {
      for (let x = f.x; x < Math.min(w, f.x + (f.w ?? 1)); x++) out.set(key(x, y), f);
    }
  }
  return out;
}

/** Yürünemeyen sabit karolar (kapı ve köprü yürünür) */
const solid = (f: FixedTile) => f.kind !== 'door' && f.kind !== 'bridge';

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

/** İç mekâna mı dış mekâna mı konur */
export const fitsSpace = (item: Item, space: SpaceId) =>
  item.placement === 'both' || (space === 'garden' ? item.placement === 'outdoor' : item.placement === 'indoor');

/** Halı, yol, çiçek gibi üzerinden yürünen eşyalar zemin katmanındadır; mobilya halının üstüne konabilir */
const layerOf = (item: Item) => (item.walk ? 'zemin' : 'esya');

/**
 * Bir eşyadan kaç tane yerleştirilebilir.
 * Ücretsiz başlangıç eşyası 1; başarıyla açılan (saat, seviye, ağaç) açıldıysa 1; satın alınan/sandıktan
 * çıkan sahip olunan adet kadar. Kaplamalar (zemin/duvar) sayılmaz.
 */
export type OwnedCount = (item: Item) => number;

export interface Problem {
  message: string;
  /** Sorunlu eşyanın sırası */
  index?: number;
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
  if (space === 'library' && !libraryOpen(ctx)) return { message: 'Kütüphane odası henüz açılmadı' };
  if (!Array.isArray(layout.items) || layout.items.length > 150) return { message: 'Yerleşim geçersiz' };
  for (const [slot, cat] of [['floor', 'zemin'], ['wall', 'duvar']] as const) {
    const id = layout[slot];
    if (id == null) continue;
    const it = itemById(id);
    if (space === 'garden' || !it || it.category !== cat || ownedCount(it) < 1) return { message: 'Bu kaplama sende yok' };
  }
  const { w, h } = spaceSize(space, ctx);
  const fixed = fixedTiles(space, ctx);
  const taken = { zemin: new Set<string>(), esya: new Set<string>() };
  const used = new Map<string, number>();
  for (const [index, p] of layout.items.entries()) {
    const it = itemById(p.item);
    if (!it || !it.placement) return { message: 'Bu eşya yerleştirilemez', index };
    if (!fitsSpace(it, space)) return { message: space === 'garden' ? 'Bu eşya içeride durur' : 'Bu eşya dışarıda durur', index };
    if (![p.x, p.y, p.rot].every(Number.isInteger) || !(it.rotations ?? [0]).includes(p.rot)) return { message: 'Bu eşya böyle döndürülemez', index };
    const layer = taken[layerOf(it)];
    for (const t of footprint(it, p.x, p.y, p.rot)) {
      if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= h) return { message: 'Alanın dışına taşıyor', index };
      if (fixed.has(key(t.x, t.y))) return { message: 'Bu karo boş değil', index };
      if (layer.has(key(t.x, t.y))) return { message: 'Bu karo dolu', index };
      layer.add(key(t.x, t.y));
    }
    used.set(it.id, (used.get(it.id) ?? 0) + 1);
  }
  for (const [id, n] of used) {
    if (n + usedElsewhere(id) > ownedCount(itemById(id)!)) return { message: `${itemById(id)!.name} envanterinde yok`, index: layout.items.findIndex((p) => p.item === id) };
  }
  return null;
}

/** Bir eşya bu karoya konabilir mi (yerleştirme modunda yeşil/kırmızı önizleme) */
export function canPlaceAt(space: SpaceId, layout: SpaceLayout, ctx: WorldCtx, p: PlacedItem, ignore = -1): boolean {
  const it = itemById(p.item);
  if (!it || !it.placement || !fitsSpace(it, space)) return false;
  const { w, h } = spaceSize(space, ctx);
  const fixed = fixedTiles(space, ctx);
  const others = new Set<string>();
  layout.items.forEach((q, i) => {
    const o = itemById(q.item);
    if (i === ignore || !o || layerOf(o) !== layerOf(it)) return;
    footprint(o, q.x, q.y, q.rot).forEach((t) => others.add(key(t.x, t.y)));
  });
  return footprint(it, p.x, p.y, p.rot).every((t) => t.x >= 0 && t.y >= 0 && t.x < w && t.y < h && !fixed.has(key(t.x, t.y)) && !others.has(key(t.x, t.y)));
}

// ---------- Yürüme ----------
/** Alanın yürünemeyen karoları: ev, su, tepe, koru ve zemin katmanında olmayan eşyalar */
export function blockedTiles(space: SpaceId, layout: SpaceLayout, ctx: WorldCtx): Set<string> {
  const out = new Set<string>();
  for (const [k, f] of fixedTiles(space, ctx)) if (solid(f)) out.add(k);
  for (const p of layout.items) {
    const it = itemById(p.item);
    if (it && !it.walk) footprint(it, p.x, p.y, p.rot).forEach((t) => out.add(key(t.x, t.y)));
  }
  return out;
}

/**
 * A* (4 yön). Hedef doluysa (eşyaya tıklandı) hedefe en yakın boş komşuya gider.
 * Dönen yol başlangıcı içermez; yol yoksa null.
 */
export function findPath(from: Tile, to: Tile, w: number, h: number, blocked: Set<string>): Tile[] | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const free = (x: number, y: number) => inside(x, y) && !blocked.has(key(x, y));
  let goals = [to];
  if (!free(to.x, to.y)) {
    goals = [
      { x: to.x, y: to.y + 1 },
      { x: to.x + 1, y: to.y },
      { x: to.x - 1, y: to.y },
      { x: to.x, y: to.y - 1 },
    ].filter((t) => free(t.x, t.y));
    if (!goals.length) return null;
  }
  const goalSet = new Set(goals.map((g) => key(g.x, g.y)));
  const hcost = (x: number, y: number) => Math.min(...goals.map((g) => Math.abs(g.x - x) + Math.abs(g.y - y)));
  const open: { x: number; y: number; f: number; g: number }[] = [{ ...from, g: 0, f: hcost(from.x, from.y) }];
  const came = new Map<string, string>();
  const best = new Map<string, number>([[key(from.x, from.y), 0]]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (goalSet.has(ck)) {
      const path: Tile[] = [];
      for (let k: string | undefined = ck; k && k !== key(from.x, from.y); k = came.get(k)) {
        const [x, y] = k.split(',').map(Number);
        path.unshift({ x, y });
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!free(nx, ny)) continue;
      const nk = key(nx, ny);
      const g = cur.g + 1;
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      came.set(nk, ck);
      open.push({ x: nx, y: ny, g, f: g + hcost(nx, ny) });
    }
  }
  return null;
}

// ---------- Orman: her seans bir ağaç ----------
export type TreeKind = (typeof CFG.world.trees)[number];

export interface WorldTree {
  /** Kayıt (ya da yarım seans) kimliği: konum bundan tohumlanır */
  id: string;
  kind: string;
  name: string;
  icon: string;
  /** Kuru ağaç: yarıda bırakılan seans */
  dry: boolean;
  minutes: number;
  date: string;
  month: string;
  course_id: string | null;
  note: string | null;
  /** Sıralama (eklenme zamanı) */
  at: string;
}

export const DRY_TREE = { id: 'kuru', name: 'Kuru ağaç', icon: '🪵' };

/** Seans süresine göre ağaç türü */
export function treeKind(minutes: number): TreeKind {
  return W.trees.filter((t) => minutes >= t.min).at(-1) ?? W.trees[0];
}

/**
 * Bütün ağaçlar: sayaçla ölçülen (ve eski) her kayıt bir ağaç, uzun süren yarım seans kuru ağaç.
 * Elle yazılan süre ağaç vermez.
 */
export function forestOf(logs: StudyLog[], abandoned: Abandoned[]): WorldTree[] {
  const out: WorldTree[] = [];
  for (const l of logs) {
    if (l.source === 'manual') continue;
    const k = treeKind(l.duration_minutes);
    out.push({ id: l.id, kind: k.id, name: k.name, icon: k.icon, dry: false, minutes: l.duration_minutes, date: l.date, month: l.date.slice(0, 7), course_id: l.course_id, note: l.note, at: l.created_at });
  }
  for (const a of abandoned) {
    if (a.minutes < CFG.session.wiltMinutes) continue;
    out.push({ id: a.id, kind: DRY_TREE.id, name: DRY_TREE.name, icon: DRY_TREE.icon, dry: true, minutes: a.minutes, date: a.date, month: a.date.slice(0, 7), course_id: null, note: null, at: a.created_at });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Bir ayın orman bölgesinin kenarı: ağaç sayısıyla büyür */
export function regionSize(trees: number): number {
  const r = W.region;
  return Math.max(r.min, Math.min(r.max, Math.ceil(Math.sqrt(trees * r.tilesPerTree)) + 2));
}

/**
 * Ağaçların bölgedeki yerleri. Konum ağacın kimliğinden tohumlanır, ağaçlar eklenme sırasıyla yerleşir;
 * orman her açılışta aynı görünür. pathRow satırı bahçeden gelen patika için boş kalır.
 */
export function regionLayout(trees: WorldTree[]): { size: number; spots: Map<string, Tile> } {
  const size = regionSize(trees.length);
  const taken = new Set<string>();
  for (let x = 0; x < size; x++) taken.add(key(x, W.garden.pathRow));
  const spots = new Map<string, Tile>();
  for (const t of trees) {
    const rand = rng(`agac:${t.id}`);
    let spot: Tile | null = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const x = Math.floor(rand() * size);
      const y = Math.floor(rand() * size);
      if (!taken.has(key(x, y))) spot = { x, y };
    }
    for (let i = 0; !spot && i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      if (!taken.has(key(x, y))) spot = { x, y };
    }
    if (!spot) continue; // bölge dolu (ayda 180'den fazla seans)
    taken.add(key(spot.x, spot.y));
    spots.set(t.id, spot);
  }
  return { size, spots };
}

// ---------- Dış mekân haritası ----------
export interface RegionBox {
  month: string;
  /** Dünya koordinatında sol üst köşe */
  ox: number;
  oy: number;
  size: number;
  trees: WorldTree[];
  spots: Map<string, Tile>;
}

export interface OutdoorMap {
  garden: { w: number; h: number };
  /** En yeni ay bahçeye en yakın */
  regions: RegionBox[];
  /** Bahçe ile bölgeler arasındaki patika karoları (dünya koordinatı) */
  path: Tile[];
  width: number;
  height: number;
}

/** Bahçe solda, aylık bölgeler sağa doğru (en yeni ay bahçenin yanında); aralarında 1 karoluk patika */
export function outdoorMap(ctx: WorldCtx, trees: WorldTree[], thisMonth: string): OutdoorMap {
  const garden = spaceSize('garden', ctx);
  const byMonth = new Map<string, WorldTree[]>([[thisMonth, []]]);
  for (const t of trees) {
    if (!byMonth.has(t.month)) byMonth.set(t.month, []);
    byMonth.get(t.month)!.push(t);
  }
  const months = [...byMonth.keys()].filter((m) => m <= thisMonth).sort().reverse();
  const regions: RegionBox[] = [];
  const path: Tile[] = [];
  let ox = garden.w;
  for (const month of months) {
    path.push({ x: ox, y: W.garden.pathRow });
    ox += 1;
    const list = byMonth.get(month)!;
    const { size, spots } = regionLayout(list);
    regions.push({ month, ox, oy: 0, size, trees: list, spots });
    ox += size;
  }
  return { garden, regions, path, width: ox, height: Math.max(garden.h, ...regions.map((r) => r.size)) };
}

/** Bütün dış mekânın yürünemeyen karoları (dünya koordinatı); boşluklar da yürünmez */
export function outdoorBlocked(map: OutdoorMap, garden: SpaceLayout, ctx: WorldCtx): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) out.add(key(x, y));
  for (let y = 0; y < map.garden.h; y++) for (let x = 0; x < map.garden.w; x++) out.delete(key(x, y));
  for (const k of blockedTiles('garden', garden, ctx)) out.add(k);
  for (const p of map.path) out.delete(key(p.x, p.y));
  for (const r of map.regions) {
    for (let y = 0; y < r.size; y++) for (let x = 0; x < r.size; x++) out.delete(key(r.ox + x, r.oy + y));
    for (const s of r.spots.values()) out.add(key(r.ox + s.x, r.oy + s.y));
  }
  return out;
}

/** Ormana kendiliğinden gelen canlılar (satın alınamaz) */
export function creaturesOf(treeCount: number) {
  return W.creatures.filter((c) => treeCount >= c.trees);
}

/** Yeni hesap için oda: başlangıç eşyaları ücretsiz (kitaplık, masa, sandalye) */
export const DEFAULT_ROOM: SpaceLayout = {
  floor: 'zemin:ahsap',
  wall: 'duvar:krem',
  items: [
    { item: 'mob:kitaplik', x: 0, y: 1, rot: 90 },
    { item: 'mob:masa', x: 2, y: 0, rot: 0 },
    { item: 'mob:sandalye', x: 2, y: 1, rot: 180 },
  ],
};

export const emptyLayout = (space: SpaceId): SpaceLayout =>
  space === 'room' ? structuredClone(DEFAULT_ROOM) : space === 'library' ? { floor: 'zemin:ahsap', wall: 'duvar:krem', items: [] } : { items: [] };
