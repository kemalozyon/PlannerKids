// Habbo gibi tek oda: seçilen oda (oda, kütüphane, eklenen oda) koyu boşlukta yüzen bir ada; yalnızca arka iki
// duvarı var (Room.tsx). Teras açık havadır: çim zemin, duvar yok, canlılar dolaşır. Eşyalar odanın kendi
// yerleşimiyle çizilir. Oda görünümü (WorldView, izometrik), gezinti (Explore, üçüncü şahıs) ve çalışırken oda
// (StudyRoom) aynı sahneyi kullanır; yalnızca kamera, karakter ve dokunma işleri farklı.
// Açık lambalardan yalnızca merkeze en yakın MAX_LIGHTS tanesi gerçek ışık saçar (telefonda akıcı kalsın).
import type { ThreeEvent } from '@react-three/fiber';
import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
import { useAmbient } from '../../lib/ambient';
import type { DayPhase } from '../../lib/dayPhase';
import { has, itemById } from '../../lib/catalog';
import { CFG, type FixedTile, type MapDef } from '../../lib/config';
import type { Book } from '../../lib/types';
import { cellRects, colorOf, subOffset, defaultCover, emptyLayout, fixedDefs, fixedTiles, footSize, isIndoor, isOn, isOpen, footprint, powerKey, supportOf, type PlacedItem, type SpaceId, type SpaceLayout, type Tile } from '../../lib/world';
import type { Region, WorldPlan } from '../../lib/worldPlan';
import { Color, type Texture } from 'three';
import { boardTexture, tvTexture, windowTexture, type BoardCard, type TvData } from './art';
import { capacity } from './Books';
import Fx from './Fx';
import { footCenter, ItemModel, OnSurface, surfaceTop, WALL_Y } from './items';
import LightPool, { MAX_LIGHTS, type Lamp } from './LightPool';
import { ItemBlobs } from './Blob';
import { useQuality } from './gfx';
import { Creatures, Ground, GrassTufts } from './Outdoor';
import Room, { DoorMat } from './Room';

export interface WorldSceneProps {
  plan: WorldPlan;
  map: MapDef;
  /** Odanın (düzenlenirken taslak) yerleşimi */
  layouts: Partial<Record<SpaceId, SpaceLayout>>;
  creatures: typeof CFG.world.creatures;
  night: boolean;
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
  /** Mantar panodaki notlar (NOTES eşyasında görünür) */
  board?: BoardCard[];
  /** Karakterin oturduğu/sallandığı eşya (salıncak sallanır) */
  posed?: { space: SpaceId; index: number } | null;
  /** Gerçek ışıkların seçildiği merkez (kamera hedefi ya da karakter) */
  center: Tile;
  /** Dokunmalar (karoyla); verilmezse sahne yalnızca görüntüdür */
  onWalk?: (to: Tile, then?: () => void) => void;
  onBook?: (b: Book) => void;
  /** Kapıya dokunuldu (sayfa kapının götürdüğü odayı açar) */
  onDoor?: (d: FixedTile) => void;
  onItem?: (kind: 'down' | 'click', space: SpaceId, index: number, e: ThreeEvent<PointerEvent | MouseEvent>) => void;
}

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
  const r = plan.regions[0];
  const space = r.id;
  const layout = p.layouts[space] ?? emptyLayout(space);
  const indoor = isIndoor(space, plan.ctx);
  // Merkeze en yakın açık lambalar ve ateşler gerçek ışık saçar (ışık havuzu)
  const lamps = useMemo(() => {
    const all: (Lamp & { d: number })[] = [];
    layout.items.forEach((it, i) => {
      const item = itemById(it.item);
      if (!item || (item.fx !== 'light' && item.fx !== 'fire') || !isOn(item, it)) return;
      const at = lampAt(r, layout, it, i);
      all.push({ k: powerKey(space, it), ...at, color: item.fx === 'fire' ? '#ff9a3c' : lampColor(colorOf(item, it)), fire: item.fx === 'fire', d: Math.hypot(at.x - p.center.x, at.z - p.center.y) });
    });
    return all.sort((a, b) => a.d - b.d).slice(0, MAX_LIGHTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, layout, p.center]);
  const view = windowTexture(p.phase, map.theme.ground, map.theme.scenery);
  const walkLocal = (t: Tile, then?: () => void) => p.onWalk?.({ x: r.x + t.x, y: r.y + t.y }, then);
  const onDoor = (d: FixedTile) => (p.onDoor ? walkLocal({ x: d.x, y: d.y }, () => p.onDoor?.(d)) : undefined);

  return (
    <group>
      <LightPool lamps={lamps} />
      <Fx />
      {indoor ? <IndoorRegion {...p} view={view} r={r} layout={layout} walkLocal={walkLocal} onDoorTap={onDoor} /> : <Terrace {...p} r={r} layout={layout} onDoorTap={onDoor} />}
    </group>
  );
}
/** Işığın rengi: seçili renk (koyu bir abajur bile) sıcak beyazla karışır, oda kararmaz */
const WARM = new Color('#ffd9a0');
const lampColor = (c: string | undefined) => (c ? `#${new Color(c).lerp(WARM, 0.55).getHexString()}` : '#ffd9a0');

/** Lambanın ışığının çıktığı yer (dünya): ayak izinin ortası, eşyanın üst kısmı; duvar lambası duvarın önü */
function lampAt(r: Region, layout: SpaceLayout, it: PlacedItem, i: number): { x: number; y: number; z: number } {
  const item = itemById(it.item)!;
  if (item.placement === 'wall') {
    const n = item.w ?? 1;
    return it.y === -1 ? { x: r.x + it.x + n / 2, y: WALL_Y, z: r.y + 0.5 } : { x: r.x + 0.5, y: WALL_Y, z: r.y + it.y + n / 2 };
  }
  const [fx, fz] = footCenter(item, it.x, it.y, it.rot);
  const [ox, oz] = it.sub === undefined ? [0, 0] : subOffset(it.sub);
  const cx = fx + ox;
  const cz = fz + oz;
  const s = supportOf(layout, it, i);
  const base = s != null ? surfaceTop(itemById(layout.items[s].item)!) : 0;
  return { x: r.x + cx, y: base + Math.max(0.3, surfaceTop(item) * (item.fx === 'fire' ? 0.5 : 0.85)), z: r.y + cz };
}

/** Bugün mama konan kap/yatak (INTERACT_PET): canlılar çevresinde dolaşır */
function petSpot(layout: SpaceLayout, today: string): { x: number; z: number } | null {
  const p = layout.items.find((q) => q.fed === today && has(itemById(q.item), 'INTERACT_PET'));
  if (!p) return null;
  const [w, h] = footSize(itemById(p.item)!, p.rot);
  return { x: p.x + w / 2, z: p.y + h / 2 };
}

function IndoorRegion(
  p: WorldSceneProps & {
    r: Region;
    layout: SpaceLayout;
    view: Texture;
    walkLocal: (t: Tile, then?: () => void) => void;
    onDoorTap: (d: FixedTile) => void;
  },
) {
  const { r, layout } = p;
  const space = r.id;
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
  const reach = (b: Book, t: Tile) => p.walkLocal(t, () => p.onBook?.(b));
  return (
    <group position={[r.x, 0, r.y]}>
      <Room
        w={r.w}
        h={r.h}
        floor={itemById(layout.floor ?? defaultCover(space, 'floor', p.plan.ctx))}
        wall={itemById(layout.wall ?? defaultCover(space, 'wall', p.plan.ctx))}
        rects={r.cells ? cellRects(r.cells) : undefined}
        fixed={defs}
        onDoor={p.onDoorTap}
        shelfBooks={space === 'library' ? (shares[0] ?? []) : []}
        reading={space === 'library' ? p.reading : []}
        onBook={(b) => reach(b, { x: Math.min(r.w - 1, 2), y: 1 })}
        view={p.view}
      />
      <Items {...p} space={space} layout={layout} caseBooks={caseBooks} reach={reach} />
    </group>
  );
}

/** Teras: açık hava odası; çim zemin (şekline göre parça parça), duvar yok, kapılar paspas, canlılar dolaşır */
function Terrace(p: WorldSceneProps & { r: Region; layout: SpaceLayout; onDoorTap: (d: FixedTile) => void }) {
  const { r, layout, map } = p;
  const space = r.id;
  const quality = useQuality();
  const parts = useMemo(() => (r.cells ? cellRects(r.cells) : [[0, 0, r.w, r.h] as [number, number, number, number]]), [r]);
  const defs = fixedDefs(space, p.plan.ctx);
  // Çim tutamları boş karolara (sabit karolar, kesikler ve eşyaların altı hariç)
  const busy = useMemo(() => {
    const out = new Set<string>(fixedTiles(space, p.plan.ctx).keys());
    for (const it of layout.items) {
      const item = itemById(it.item);
      if (item) for (const t of footprint(item, it.x, it.y, it.rot)) out.add(`${t.x},${t.y}`);
    }
    return out;
  }, [space, p.plan.ctx, layout]);
  return (
    <group position={[r.x, 0, r.y]}>
      {parts.map(([x, y, w, h]) => (
        <Ground key={`${x},${y}`} x={x} y={y} w={w} h={h} color={map.theme.ground} side={map.theme.side} />
      ))}
      {defs
        .filter((d) => d.kind === 'door')
        .map((d) => (
          <DoorMat key={`${d.x},${d.y}`} d={d} onDoor={p.onDoorTap} />
        ))}
      <Items {...p} space={space} layout={layout} />
      {quality === 'yuksek' && <GrassTufts w={r.w} h={r.h} exclude={busy} color={map.theme.ground} seed={space} />}
      <Creatures list={p.creatures} area={{ x0: 0.6, x1: r.w - 0.6, y0: 0.6, y1: r.h - 0.6 }} attract={petSpot(layout, p.plan.ctx.today)} />
    </group>
  );
}

/** Eşyanın yeri (dönüş hariç: döndürmek "yeni konmuş" sayılmaz) */
const sigOf = (it: PlacedItem) => `${it.item}@${it.x},${it.y}${it.sub === undefined ? '' : `:${it.sub}`}`;

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
  board,
  posed,
}: Pick<WorldSceneProps, 'selected' | 'hidden' | 'onItem' | 'channels' | 'tv' | 'board' | 'posed'> & {
  space: SpaceId;
  layout: SpaceLayout;
  caseBooks?: Map<number, Book[]>;
  reach?: (b: Book, t: Tile) => void;
}) {
  // Radyo / pikap (MUSIC): ortam çaları bu eşyadan çalıyorsa açık (plak döner)
  const playing = useAmbient().source;
  // Yeni konan eşyalar (önceki yerleşimde aynı yerde yoktu) düşerek gelir; ilk çizimde hiçbiri
  const prev = useRef<Set<string> | null>(null);
  const sigs = layout.items.map(sigOf);
  const fresh = useMemo(() => {
    const p = prev.current;
    return new Set(p ? sigs.filter((x) => !p.has(x)) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  useEffect(() => {
    prev.current = new Set(sigs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  return (
    <>
      <ItemBlobs layout={layout} />
      {layout.items.map((it, i) => {
        const item = itemById(it.item);
        if (!item || !(item.model || item.art || item.proc)) return null;
        if (hidden && hidden.space === space && hidden.index === i) return null;
        const support = supportOf(layout, it, i);
        const supportItem = support != null ? itemById(layout.items[support].item) : undefined;
        const k = powerKey(space, it);
        const on = has(item, 'MUSIC') ? playing === k : isOn(item, it);
        const appear = fresh.has(sigOf(it));
        const model = (
          <ItemModel
            item={item}
            x={it.x}
            y={it.y}
            rot={it.rot}
            sub={it.sub}
            lift={selected && selected.space === space && selected.index === i ? 0.12 : 0}
            books={caseBooks?.get(i)}
            on={on}
            open={isOpen(item, it)}
            color={colorOf(item, it)}
            appear={appear}
            screen={item.fx === 'tv' && on && tv ? tvTexture(channels[k] ?? 0, tv) : has(item, 'NOTES') && board ? boardTexture(board, item.w ?? 1) : null}
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
