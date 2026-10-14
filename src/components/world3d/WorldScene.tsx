// Bütün dünya tek sahnede: zemin ve manzara, ev (kütüphane | oda + dış kabuk), önündeki bahçe, orman yolu ve
// ay bahçeleri. Her alan dünya planındaki yerine (worldPlan.ts) kendi yerel koordinatlarıyla bir grup olarak
// konur; eşyalar alanın kendi yerleşimiyle çizilir. Dünya görünümü (WorldView, izometrik) ve gezinti
// (Explore, üçüncü şahıs) aynı sahneyi kullanır; yalnızca kamera, karakter ve dokunma işleri farklı.
//
// Uzaktaki alanlar (`near` dışında) sade çizilir: eşya, canlı, gün taşı ve tabela yok; ağaçlar ve zemin var.
// Açık lambalardan yalnızca merkeze en yakın MAX_LIGHTS tanesi gerçek ışık saçar (telefonda akıcı kalsın).
import type { ThreeEvent } from '@react-three/fiber';
import { memo, Suspense, useMemo } from 'react';
import type { DayPhase } from '../../lib/dayPhase';
import { has, itemById } from '../../lib/catalog';
import { CFG, type FixedTile, type MapDef } from '../../lib/config';
import type { Book } from '../../lib/types';
import { colorOf, defaultCover, emptyLayout, fixedDefs, fixedTiles, footSize, isIndoor, isMonthSpace, isOn, isOpen, isRoom, powerKey, roomById, supportOf, type DayTree, type SpaceId, type SpaceLayout, type Tile } from '../../lib/world';
import { regionOf, type Region, type RegionId, type WorldPlan } from '../../lib/worldPlan';
import type { Texture } from 'three';
import { tvTexture, windowTexture, type TvData } from './art';
import { capacity } from './Books';
import HouseShell from './House';
import { ItemModel, OnSurface } from './items';
import { Creatures, MonthGarden, Sign, Terrain, Trail, Yard } from './Outdoor';
import Room, { WALL_H } from './Room';

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
  /** Karakterin (ya da düzenlenen) alan: doğusundaki odanın bölme duvarı alçalır, içerisi görünsün */
  here?: RegionId | null;
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
  /** TV kanalları (powerKey → kanal); aç-kapa durumu yerleşimde */
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

/** Prop'lar değişmedikçe yeniden çizilmez (elde eşya gezdirirken yalnızca düzenleme katmanı çizilir) */
export default memo(WorldScene);

function WorldScene(p: WorldSceneProps) {
  const { plan, map } = p;
  const room = regionOf(plan, 'room')!;
  const lib = regionOf(plan, 'library')!;
  // Evin açık odaları (kütüphane, oda, seriyle açılanlar) ve sıradaki kilitli oda
  const indoor = plan.regions.filter((r) => isIndoor(r.id) && !r.locked);
  const lockedRooms = plan.regions.filter((r) => isRoom(r.id) && r.locked);
  const houseW = Math.max(...indoor.map((r) => r.x + r.w));
  const hereR = p.here ? plan.regions.find((r) => r.id === p.here && isIndoor(r.id)) : undefined;
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
        if (item?.fx === 'light' && isOn(item, it)) all.push({ k, d: Math.hypot(r.x + it.x - p.center.x, r.y + it.y - p.center.y) });
      }
    }
    return new Set(all.sort((a, b) => a.d - b.d).slice(0, MAX_LIGHTS).map((x) => x.k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, p.layouts, p.center, p.near]);
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
      {/* Ev: kütüphane | oda | seriyle açılan odalar, dış kabuk */}
      {indoor.map((r) => (
        <IndoorRegion
          key={r.id}
          {...p}
          {...ctl}
          r={r}
          layout={layoutOf(r.id as SpaceId)}
          walkLocal={walkLocal}
          detail={isNear(r.id)}
          lowLeft={!!hereR && hereR.x + hereR.w === r.x}
        />
      ))}
      {lockedRooms.map((r) => (
        <LockedRoom key={r.id} r={r} />
      ))}
      <HouseShell
        w={houseW - lib.x}
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
        {isNear('garden') && <Creatures list={p.creatures} area={{ x0: 0.6, x1: yard.w - 0.6, y0: 0.6, y1: yard.h - 0.6 }} attract={petSpot(layoutOf('garden'), plan.ctx.today)} />}
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
            {near && !r.locked && <Creatures list={p.creatures.slice(0, 3)} area={{ x0: 0.6, x1: r.w - 0.6, y0: 0.6, y1: r.h - 0.6 }} attract={petSpot(layoutOf(space), plan.ctx.today)} />}
          </group>
        );
      })}
    </group>
  );
}

/** Bugün mama konan kap/yatak (INTERACT_PET): canlılar çevresinde dolaşır */
function petSpot(layout: SpaceLayout, today: string): { x: number; z: number } | null {
  const p = layout.items.find((q) => q.fed === today && has(itemById(q.item), 'INTERACT_PET'));
  if (!p) return null;
  const [w, h] = footSize(itemById(p.item)!, p.rot);
  return { x: p.x + w / 2, z: p.y + h / 2 };
}

/** Bahçe kapısına dokununca: kapının karosuna yürü */
function gateWalk(r: Region, space: SpaceId, plan: WorldPlan, walkLocal: (r: Region, t: Tile) => void) {
  const g = fixedDefs(space, plan.ctx).find((f) => f.kind === 'gate');
  if (g) walkLocal(r, { x: g.x, y: g.y });
}

function IndoorRegion(
  p: WorldSceneProps & {
    r: Region;
    layout: SpaceLayout;
    detail: boolean;
    lit: Set<string>;
    view: Texture;
    walkLocal: (r: Region, t: Tile, then?: () => void) => void;
    lowLeft: boolean;
  },
) {
  const { r, layout } = p;
  const space = r.id as SpaceId;
  const defs = fixedDefs(space, p.plan.ctx);
  const shelves = defs.filter((f) => f.kind === 'shelf');
  const cases = layout.items.map((it, i) => ({ it, i })).filter(({ it }) => has(itemById(it.item), 'BOOKS'));
  const shares = shareBooks(
    p.books,
    [...(space === 'library' ? shelves.map((f) => capacity(f.w ?? 1)) : []), ...cases.map(({ it }) => capacity(itemById(it.item)?.w ?? 1))],
    space !== 'library',
  );
  const own = space === 'library' ? shelves.length : 0;
  const caseBooks = new Map(cases.map(({ i }, k) => [i, shares[own + k]]));
  const reach = (b: Book, t: Tile) => p.walkLocal(r, t, () => p.onBook?.(b));
  return (
    <group position={[r.x, 0, r.y]}>
      <Room
        w={r.w}
        h={r.h}
        floor={itemById(layout.floor ?? defaultCover(space, 'floor'))}
        wall={itemById(layout.wall ?? defaultCover(space, 'wall'))}
        lowLeft={p.lowLeft}
        fixed={defs}
        onDoor={(d: FixedTile) => p.walkLocal(r, { x: d.x, y: d.y })}
        shelfBooks={space === 'library' ? (shares[0] ?? []) : []}
        reading={space === 'library' ? p.reading : []}
        onBook={(b) => reach(b, { x: Math.min(r.w - 1, 2), y: 1 })}
        view={p.view}
      />
      {p.detail && <Items {...p} space={space} layout={layout} caseBooks={caseBooks} reach={reach} leftWall={!p.lowLeft} />}
    </group>
  );
}

/** Seriyle açılacak oda: atılmış temel, yarım duvar dipleri, iskele ve tabela (girilmez) */
function LockedRoom({ r }: { r: Region }) {
  const def = roomById(r.id as Parameters<typeof roomById>[0]);
  const posts = [
    [0.2, 0.2],
    [r.w - 0.2, 0.2],
    [0.2, r.h - 0.2],
    [r.w - 0.2, r.h - 0.2],
  ];
  return (
    <group position={[r.x, 0, r.y]}>
      <mesh position={[r.w / 2, 0.06, r.h / 2]} receiveShadow>
        <boxGeometry args={[r.w, 0.12, r.h]} />
        <meshStandardMaterial color="#bdb6a8" />
      </mesh>
      {/* Duvar dipleri: arka ve doğu */}
      <mesh position={[r.w / 2, 0.3, 0.07]}>
        <boxGeometry args={[r.w, 0.5, 0.14]} />
        <meshStandardMaterial color="#d8cdb8" />
      </mesh>
      <mesh position={[r.w - 0.07, 0.3, r.h / 2]}>
        <boxGeometry args={[0.14, 0.5, r.h]} />
        <meshStandardMaterial color="#d8cdb8" />
      </mesh>
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, WALL_H / 2, z]} castShadow>
          <boxGeometry args={[0.12, WALL_H, 0.12]} />
          <meshStandardMaterial color="#c98a3c" />
        </mesh>
      ))}
      <mesh position={[r.w / 2, WALL_H, 0.2]}>
        <boxGeometry args={[r.w, 0.1, 0.1]} />
        <meshStandardMaterial color="#c98a3c" />
      </mesh>
      {/* Kapalı kapı (batı duvarı, odadan) */}
      <mesh position={[0.06, 0.95, 5.5]}>
        <boxGeometry args={[0.08, 1.9, 0.9]} />
        <meshStandardMaterial color="#8a5a34" />
      </mesh>
      <Sign x={r.w / 2} z={r.h / 2} y={1.6} text={`🔒 ${def.icon} ${def.name} · ${def.streak} günlük seri`} scale={1} />
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
  channels,
  tv,
  posed,
  lit,
  leftWall = true,
}: Pick<WorldSceneProps, 'selected' | 'hidden' | 'onItem' | 'channels' | 'tv' | 'posed'> & {
  space: SpaceId;
  layout: SpaceLayout;
  caseBooks?: Map<number, Book[]>;
  reach?: (b: Book, t: Tile) => void;
  lit: Set<string>;
  /** Sol duvar alçalmışsa oradaki duvar süsleri gizlenir */
  leftWall?: boolean;
}) {
  return (
    <>
      {layout.items.map((it, i) => {
        const item = itemById(it.item);
        if (!item || !(item.model || item.art || item.proc)) return null;
        if (hidden && hidden.space === space && hidden.index === i) return null;
        if (!leftWall && item.placement === 'wall' && it.x === -1) return null;
        const support = supportOf(layout, it, i);
        const supportItem = support != null ? itemById(layout.items[support].item) : undefined;
        const k = powerKey(space, it);
        const on = isOn(item, it);
        const model = (
          <ItemModel
            item={item}
            x={it.x}
            y={it.y}
            rot={it.rot}
            lift={selected && selected.space === space && selected.index === i ? 0.12 : 0}
            books={caseBooks?.get(i)}
            on={on}
            open={isOpen(item, it)}
            color={colorOf(item, it)}
            lit={lit.has(k)}
            screen={item.fx === 'tv' && on && tv ? tvTexture(channels[k] ?? 0, tv) : null}
            active={!!posed && posed.space === space && posed.index === i}
            onBook={reach ? (b) => reach(b, { x: it.x, y: it.y }) : undefined}
            onPointerDown={onItem ? (e) => onItem('down', space, i, e) : undefined}
            onClick={onItem ? (e) => onItem('click', space, i, e) : undefined}
          />
        );
        // Her eşya kendi Suspense'inde: yeni konan eşyanın modeli yüklenirken dünyanın geri kalanı görünür kalır
        return (
          <Suspense key={`${i}-${it.item}`} fallback={null}>
            {supportItem ? <OnSurface support={supportItem}>{model}</OnSurface> : model}
          </Suspense>
        );
      })}
    </>
  );
}
