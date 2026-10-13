// Bütün dünya tek sahnede: zemin ve manzara, ev (kütüphane | oda + dış kabuk), önündeki bahçe, orman yolu ve
// ay bahçeleri. Her alan dünya planındaki yerine (worldPlan.ts) kendi yerel koordinatlarıyla bir grup olarak
// konur; eşyalar alanın kendi yerleşimiyle çizilir. Dünya görünümü (WorldView, izometrik) ve gezinti
// (Explore, üçüncü şahıs) aynı sahneyi kullanır; yalnızca kamera, karakter ve dokunma işleri farklı.
//
// Uzaktaki alanlar (`near` dışında) sade çizilir: eşya, canlı, gün taşı ve tabela yok; ağaçlar ve zemin var.
// Açık lambalardan yalnızca merkeze en yakın MAX_LIGHTS tanesi gerçek ışık saçar (telefonda akıcı kalsın).
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, type ReactNode } from 'react';
import type { DayPhase } from '../../lib/dayPhase';
import { itemById } from '../../lib/catalog';
import { CFG, type FixedTile, type MapDef } from '../../lib/config';
import type { Book } from '../../lib/types';
import { emptyLayout, fixedDefs, fixedTiles, isMonthSpace, isOn, powerKey, supportOf, type DayTree, type SpaceId, type SpaceLayout, type Tile } from '../../lib/world';
import { regionOf, type Region, type RegionId, type WorldPlan } from '../../lib/worldPlan';
import type { Texture } from 'three';
import { tvTexture, windowTexture, type TvData } from './art';
import { capacity } from './Books';
import HouseShell from './House';
import { ItemModel, OnSurface } from './items';
import { Creatures, MonthGarden, Terrain, Trail, Yard } from './Outdoor';
import Room from './Room';

export interface WorldSceneProps {
  plan: WorldPlan;
  map: MapDef;
  /** Her alanın (düzenlenen alan için taslak) yerleşimi */
  layouts: Partial<Record<SpaceId, SpaceLayout>>;
  /** Bütün ağaçlar (aylarına göre bahçelere dağılır) */
  forest: DayTree[];
  creatures: typeof CFG.world.creatures;
  /** Evin içi görünsün (çatı kalkar) */
  open: boolean;
  night: boolean;
  /** Ayrıntılı çizilen alanlar; null: hepsi */
  near: Set<RegionId> | null;
  labels: boolean;
  growId: string | null;
  onGrown: () => void;
  /** Bitirilen (eskiden yeniye) ve okunmakta olan kitaplar */
  books: Book[];
  reading: Book[];
  /** Seçili eşya biraz havalanır */
  selected?: { space: SpaceId; index: number } | null;
  /** Bir alanın eşyası çizilmesin (elde taşınırken eski yerinde görünmesin) */
  hidden?: { space: SpaceId; index: number } | null;
  phase: DayPhase;
  /** Işık/TV/ateş açık mı (powerKey → açık); TV kanalları */
  power: Record<string, boolean>;
  channels: Record<string, number>;
  tv: TvData | null;
  /** Karakterin oturduğu/sallandığı eşya (salıncak sallanır) */
  posed?: { space: SpaceId; index: number } | null;
  /** Gerçek ışıkların seçildiği merkez (kamera hedefi ya da karakter) */
  center: Tile;
  /** Dokunmalar (dünya karosuyla); verilmezse sahne yalnızca görüntüdür */
  onWalk?: (to: Tile, then?: () => void) => void;
  onBook?: (b: Book) => void;
  onTree?: (t: DayTree) => void;
  onItem?: (kind: 'down' | 'click', space: SpaceId, index: number, e: ThreeEvent<PointerEvent | MouseEvent>) => void;
  /** Alanların içinde çizilen ek parçalar (düzenleme ızgarası, önizleme) */
  extra?: Partial<Record<SpaceId, ReactNode>>;
}

/** Sahnede en fazla bu kadar lamba gerçek ışık saçar; kalanlar yalnızca parlar */
const MAX_LIGHTS = 4;

/** Kitapları kitaplıklara paylaştırır: kütüphanede eskiden yeniye gömme raflardan başlayarak, odada en yeniler önce */
function shareBooks(books: Book[], caps: number[], newestFirst: boolean): Book[][] {
  const list = newestFirst ? [...books].reverse() : books;
  const out: Book[][] = [];
  let i = 0;
  for (const c of caps) {
    out.push(list.slice(i, i + c));
    i += c;
  }
  return out;
}

export default function WorldScene(p: WorldSceneProps) {
  const { plan, map } = p;
  const room = regionOf(plan, 'room')!;
  const lib = regionOf(plan, 'library')!;
  const yard = regionOf(plan, 'garden')!;
  const trails = plan.regions.filter((r) => r.id === 'trail');
  const months = plan.regions.filter((r) => isMonthSpace(r.id));
  const front = map.room.fixed.find((f) => f.kind === 'door' && f.edge === 's');
  const layoutOf = (s: SpaceId) => p.layouts[s] ?? emptyLayout(s);
  const isNear = (id: RegionId) => !p.near || p.near.has(id);
  const walkLocal = (r: Region, t: Tile, then?: () => void) => p.onWalk?.({ x: r.x + t.x, y: r.y + t.y }, then);
  // Merkeze en yakın açık lambalar gerçek ışık saçar
  const lit = useMemo(() => {
    const all: { k: string; d: number }[] = [];
    for (const r of plan.regions) {
      if (r.id === 'trail' || r.locked || !isNear(r.id)) continue;
      for (const it of layoutOf(r.id).items) {
        const item = itemById(it.item);
        const k = powerKey(r.id, it);
        if (item?.use === 'light' && isOn(item, k, p.power)) all.push({ k, d: Math.hypot(r.x + it.x - p.center.x, r.y + it.y - p.center.y) });
      }
    }
    return new Set(all.sort((a, b) => a.d - b.d).slice(0, MAX_LIGHTS).map((x) => x.k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, p.layouts, p.power, p.center, p.near]);
  const view = windowTexture(p.phase, map.theme.ground, map.theme.scenery);
  const ctl = { lit, view };
  const byMonth = useMemo(() => {
    const out = new Map<string, DayTree[]>();
    for (const t of p.forest) {
      if (!out.has(t.month)) out.set(t.month, []);
      out.get(t.month)!.push(t);
    }
    return out;
  }, [p.forest]);

  return (
    <group>
      <Terrain map={map} w={plan.w} h={plan.h} />
      {/* Ev: kütüphane | oda, dış kabuk */}
      <IndoorRegion {...p} {...ctl} r={lib} layout={layoutOf('library')} walkLocal={walkLocal} detail={isNear('library')} />
      <IndoorRegion {...p} {...ctl} r={room} layout={layoutOf('room')} walkLocal={walkLocal} detail={isNear('room')} />
      <HouseShell
        w={lib.w + room.w}
        h={room.h}
        doorX={room.x + (front?.x ?? 0)}
        theme={map.theme}
        open={p.open}
        night={p.night}
        onClick={() => front && walkLocal(room, { x: front.x, y: front.y })}
      />
      {/* Bahçe */}
      <group position={[yard.x, 0, yard.y]}>
        <Yard map={map} fixed={fixedTiles('garden', plan.ctx)} labels={p.labels} onGate={() => gateWalk(yard, 'garden', plan, walkLocal)} />
        {isNear('garden') && <Items {...p} {...ctl} space="garden" layout={layoutOf('garden')} />}
        {isNear('garden') && <Creatures list={p.creatures} area={{ x0: 0.6, x1: yard.w - 0.6, y0: 0.6, y1: yard.h - 0.6 }} />}
        {p.extra?.garden}
      </group>
      <Trail rects={trails} seed={map.id} />
      {/* Ay bahçeleri */}
      {months.map((r) => {
        const space = r.id as SpaceId;
        const month = space.slice(2);
        const near = isNear(space);
        return (
          <group key={space} position={[r.x, 0, r.y]}>
            <MonthGarden
              month={month}
              trees={byMonth.get(month) ?? []}
              locked={!!r.locked}
              today={plan.ctx.today}
              growId={p.growId && p.growId.startsWith(month) ? p.growId : null}
              onGrown={p.onGrown}
              onTree={(t, tile) => walkLocal(r, tile, () => p.onTree?.(t))}
              onGate={() => gateWalk(r, space, plan, walkLocal)}
              labels={p.labels}
              detail={near}
            />
            {near && !r.locked && <Items {...p} {...ctl} space={space} layout={layoutOf(space)} />}
            {near && !r.locked && <Creatures list={p.creatures.slice(0, 3)} area={{ x0: 0.6, x1: r.w - 0.6, y0: 0.6, y1: r.h - 0.6 }} />}
            {p.extra?.[space]}
          </group>
        );
      })}
    </group>
  );
}

/** Bahçe kapısına dokununca: kapının karosuna yürü */
function gateWalk(r: Region, space: SpaceId, plan: WorldPlan, walkLocal: (r: Region, t: Tile) => void) {
  const g = fixedDefs(space, plan.ctx).find((f) => f.kind === 'gate');
  if (g) walkLocal(r, { x: g.x, y: g.y });
}

function IndoorRegion(
  p: WorldSceneProps & { r: Region; layout: SpaceLayout; detail: boolean; lit: Set<string>; view: Texture; walkLocal: (r: Region, t: Tile, then?: () => void) => void },
) {
  const { r, layout } = p;
  const space = r.id as 'room' | 'library';
  const defs = fixedDefs(space, p.plan.ctx);
  const shelves = defs.filter((f) => f.kind === 'shelf');
  const cases = layout.items.map((it, i) => ({ it, i })).filter(({ it }) => itemById(it.item)?.opens === 'shelf');
  const shares = shareBooks(
    p.books,
    [...(space === 'library' ? shelves.map((f) => capacity(f.w ?? 1)) : []), ...cases.map(({ it }) => capacity(itemById(it.item)?.w ?? 1))],
    space === 'room',
  );
  const own = space === 'library' ? shelves.length : 0;
  const caseBooks = new Map(cases.map(({ i }, k) => [i, shares[own + k]]));
  const reach = (b: Book, t: Tile) => p.walkLocal(r, t, () => p.onBook?.(b));
  return (
    <group position={[r.x, 0, r.y]}>
      <Room
        w={r.w}
        h={r.h}
        floor={itemById(layout.floor ?? 'zemin:ahsap')}
        wall={itemById(layout.wall ?? 'duvar:krem')}
        fixed={defs}
        onDoor={(d: FixedTile) => p.walkLocal(r, { x: d.x, y: d.y })}
        shelfBooks={space === 'library' ? (shares[0] ?? []) : []}
        reading={space === 'library' ? p.reading : []}
        onBook={(b) => reach(b, { x: Math.min(r.w - 1, 2), y: 1 })}
        view={p.view}
      />
      {p.detail && <Items {...p} space={space} layout={layout} caseBooks={caseBooks} reach={reach} />}
      {p.extra?.[space]}
    </group>
  );
}

/** Bir alanın eşyaları (alanın yerel koordinatında) */
function Items({
  space,
  layout,
  selected,
  hidden,
  onItem,
  caseBooks,
  reach,
  power,
  channels,
  tv,
  posed,
  lit,
}: Pick<WorldSceneProps, 'selected' | 'hidden' | 'onItem' | 'power' | 'channels' | 'tv' | 'posed'> & {
  space: SpaceId;
  layout: SpaceLayout;
  caseBooks?: Map<number, Book[]>;
  reach?: (b: Book, t: Tile) => void;
  lit: Set<string>;
}) {
  return (
    <>
      {layout.items.map((it, i) => {
        const item = itemById(it.item);
        if (!item || !(item.model || item.art || item.proc)) return null;
        if (hidden && hidden.space === space && hidden.index === i) return null;
        const support = supportOf(layout, it, i);
        const supportItem = support != null ? itemById(layout.items[support].item) : undefined;
        const k = powerKey(space, it);
        const on = isOn(item, k, power);
        const model = (
          <ItemModel
            key={`${i}-${it.item}`}
            item={item}
            x={it.x}
            y={it.y}
            rot={it.rot}
            lift={selected && selected.space === space && selected.index === i ? 0.12 : 0}
            books={caseBooks?.get(i)}
            on={on}
            lit={lit.has(k)}
            screen={item.use === 'tv' && on && tv ? tvTexture(channels[k] ?? 0, tv) : null}
            active={!!posed && posed.space === space && posed.index === i}
            onBook={reach ? (b) => reach(b, { x: it.x, y: it.y }) : undefined}
            onPointerDown={onItem ? (e) => onItem('down', space, i, e) : undefined}
            onClick={onItem ? (e) => onItem('click', space, i, e) : undefined}
          />
        );
        return supportItem ? (
          <OnSurface key={`${i}-${it.item}`} support={supportItem}>
            {model}
          </OnSurface>
        ) : (
          model
        );
      })}
    </>
  );
}
