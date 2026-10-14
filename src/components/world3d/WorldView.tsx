// Dünyanın 3D görünümü: bütün dünya (ev, bahçe, orman yolu, ay bahçeleri) tek sahnede (WorldScene). İzometrik
// hisli ortografik kamera karakteri izler; döndürme, yakınlaştırma ve kaydırma serbest (evin içindeyken açı ön
// çeyrekle sınırlı). Sahne yalnızca bir şey değişince çizilir (frameloop="demand").
//
// Oynarken: bir karoya dokununca karakter A* ile oraya yürür (uzun yolda koşar); alanlar arasında yalnızca
// kapılardan geçer (worldPlan.ts → canStep). Eve girince çatı kalkar. Kitaplığa, kitaba ya da ağaca dokununca
// yanına gidip penceresini açar.
// Bir eşyaya dokununca eşya havalanır, karakter yanına yürür, varınca sayfa seçenekleri açar (kullan, taşı,
// döndür, kaldır). Oturunca karakter eşyanın üstüne geçer; boş bir yere dokununca kalkar.
// Yerleştirirken (envanter açık ya da eşya taşınırken: `edit`) karakter görünür kalır; bulunduğu alanın ızgarası
// görünür, elde tutulan eşya imleçle gezer ve karoya (duvar süsü duvara) bırakılır. İmleç yalnızca düzenleme
// katmanını (EditOverlay) yeniden çizer; dünya (WorldScene, memo) yerinde kalır.
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Vector3, type DirectionalLight } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { AvatarLook } from '../../lib/avatar';
import { itemById } from '../../lib/catalog';
import { CFG, type MapDef } from '../../lib/config';
import type { DayPhase } from '../../lib/dayPhase';
import type { Book } from '../../lib/types';
import {
  approachTile,
  blockedTiles,
  canPlaceAt,
  findPath,
  isIndoor,
  powerKey,
  seatOf,
  supportOf,
  wallRot,
  type DayTree,
  type SpaceId,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
} from '../../lib/world';
import { canStep, entryOf, regionAt, regionOf, worldBlocked, type Region, type RegionId, type WorldPlan } from '../../lib/worldPlan';
import { modelUrl } from '../forest3d/models';
import type { TvData } from './art';
import Avatar, { pathSpeed, type Walker } from './Avatar';
import { FootTiles, GridLines, HoverTile, ItemModel, OnSurface } from './items';
import { isTap, LIGHT } from './light';
import { WALL_H } from './Room';
import WorldScene from './WorldScene';

/** Kamera hedefinden bu kadar karo uzaktaki alanlar sade çizilir */
const NEAR = 26;

export type ItemRef = { space: SpaceId; index: number };

export interface WorldViewProps {
  plan: WorldPlan;
  map: MapDef;
  /** Kayıtlı (ayıklanmış) yerleşimler */
  layouts: Partial<Record<SpaceId, SpaceLayout>>;
  forest: DayTree[];
  creatures: typeof CFG.world.creatures;
  phase: DayPhase;
  shadows: boolean;
  look: AvatarLook;
  /** Karakterin başladığı karo (dünya) */
  start: Tile;
  /** Bir alana git (sekmeler): n her istekte artar */
  goal: { to: RegionId; n: number } | null;
  growId: string | null;
  onGrown: () => void;
  /** Bitirilen (eskiden yeniye) ve okunmakta olan kitaplar */
  books: Book[];
  reading: Book[];
  onBook: (b: Book) => void;
  /** Yerleştirilen alan ve taslağı (envanter açık ya da eşya taşınıyor) */
  edit: { space: SpaceId; layout: SpaceLayout } | null;
  /** Elde tutulan eşya (yerleştirme) */
  held: { item: string; rot: number } | null;
  onDrop: (tile: Tile) => void;
  onTree: (t: DayTree) => void;
  /** Bir eşyaya dokunuldu (karakter yanına yürümeye başladı) */
  onAim: () => void;
  /** Karakter dokunulan eşyanın yanına vardı: seçenekler açılsın */
  onUse: (space: SpaceId, index: number) => void;
  /** Boş bir yere dokunuldu (seçenekler kapanır) */
  onFloor: () => void;
  /** Seçenekleri açık eşya (biraz havalanır) */
  using: ItemRef | null;
  /** Otur / yat / sallan isteği: n her istekte artar */
  action: { space: SpaceId; index: number; n: number; stand?: boolean } | null;
  /** Karakter bir eşyanın üstüne geçti ya da kalktı */
  onPosed: (p: ItemRef | null) => void;
  /** Karakterin elindeki ikram (DISPENSE) */
  holding: string | null;
  channels: Record<string, number>;
  tv: TvData;
  /** Karakterin bulunduğu alan değişince */
  onRegion: (id: RegionId | null) => void;
  /** Karakter yeni bir karoya geçince (konum saklanır) */
  onTile: (t: Tile) => void;
}

export default function WorldView(props: WorldViewProps) {
  const L = LIGHT[props.phase];
  return (
    <Canvas
      orthographic
      frameloop="demand"
      shadows={props.shadows}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [20, 22, 20], zoom: 40, near: -200, far: 400 }}
      style={{ background: L.sky, touchAction: 'none' }}
      aria-label="Dünyan"
    >
      <Lights phase={props.phase} shadows={props.shadows} />
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  );
}

/** Her çizimde değişmeyen bir fonksiyon; çağrılınca en son hâlini çalıştırır (memo'lu sahne yeniden çizilmesin) */
function useStable<A extends unknown[], R>(f: (...a: A) => R): (...a: A) => R {
  const ref = useRef(f);
  ref.current = f;
  return useCallback((...a: A) => ref.current(...a), []);
}

/** Güneş gölgesi kamera hedefini izler (dünya geniş, gölge haritası değil) */
function Lights({ phase, shadows }: { phase: DayPhase; shadows: boolean }) {
  const L = LIGHT[phase];
  const sun = useRef<DirectionalLight>(null);
  const controls = useThree((s) => s.controls) as OrbitImpl | null;
  useFrame(() => {
    const l = sun.current;
    if (!l || !controls) return;
    const t = controls.target;
    l.position.set(t.x + 12, 20, t.z + 8);
    l.target.position.set(t.x, 0, t.z);
    l.target.updateMatrixWorld();
  });
  return (
    <>
      <hemisphereLight args={[L.sky2, L.ground, L.hemiI]} />
      <directionalLight
        ref={sun}
        position={[12, 20, 8]}
        intensity={L.sunI}
        color={L.sun}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-far={120}
      />
    </>
  );
}

function Scene(p: WorldViewProps) {
  const { plan } = p;
  const invalidate = useThree((s) => s.invalidate);
  const editR = p.edit ? regionOf(plan, p.edit.space) : null;
  const layouts = useMemo(() => (p.edit ? { ...p.layouts, [p.edit.space]: p.edit.layout } : p.layouts), [p.layouts, p.edit]);
  const blocked = useMemo(() => worldBlocked(plan, layouts), [plan, layouts]);
  const step = useMemo(() => (a: Tile, b: Tile) => canStep(plan, a, b), [plan]);
  const walker = useRef<Walker>({ x: p.start.x + 0.5, z: p.start.y + 0.5, face: Math.PI / 4, path: [], onArrive: null });
  const follow = useRef(true);
  const [here, setHere] = useState<RegionId | null>(() => regionAt(plan, p.start)?.id ?? null);
  const [center, setCenter] = useState<Tile>(p.start);
  /** Dokunulan, karakterin yürüdüğü eşya (havalanır; varınca seçenekler açılır) */
  const [aim, setAim] = useState<ItemRef | null>(null);
  /** Bırakmanın hemen ardından gelen "click" karakteri yürütmesin */
  const droppedAt = useRef(0);
  /** Düzenleme katmanının imleci (yalnızca o katman yeniden çizilir) */
  const hoverTo = useRef<((t: Tile | null) => void) | null>(null);

  const [posed, setPosed] = useState<{ space: SpaceId; index: number; key: string } | null>(null);
  const tileNow = (): Tile => ({ x: Math.floor(walker.current.x), y: Math.floor(walker.current.z) });
  /** Eşyanın üstündeyse kalk: yaklaştığı karoya iner */
  const standUp = () => {
    const P = walker.current.pose;
    if (!P) return;
    walker.current.x = P.back.x;
    walker.current.z = P.back.z;
    walker.current.pose = null;
    setPosed(null);
    p.onPosed(null);
    invalidate();
  };
  /** Dünya karosuna yürü; varınca then(). Yol yoksa false */
  const walkTo = (to: Tile, then?: () => void): boolean => {
    standUp();
    const path = findPath(tileNow(), to, plan.w, plan.h, blocked, step);
    if (!path) return false;
    walker.current.path = path.map((t) => ({ x: t.x + 0.5, z: t.y + 0.5 }));
    walker.current.speed = pathSpeed(path.length);
    walker.current.onArrive = then ?? null;
    follow.current = true;
    invalidate();
    return true;
  };
  const onWalk = useStable((to: Tile, then?: () => void) => {
    setAim(null);
    walkTo(to, then);
  });
  // Sekmeden bir alana git
  useEffect(() => {
    if (!p.goal) return;
    const to = entryOf(plan, p.goal.to);
    setAim(null);
    if (to) walkTo(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.goal?.n]);

  /** Eşyanın önüne yürü (dünya karosu); varınca then(). Yol yoksa false */
  const walkToItem = (space: SpaceId, i: number, then?: () => void): boolean => {
    const r = regionOf(plan, space);
    const it = layouts[space]?.items[i];
    const item = it && itemById(it.item);
    if (!r || !it || !item) return false;
    const near = approachTile(item, it, r.w, r.h, blockedTiles(space, layouts[space]!, plan.ctx));
    return walkTo(near ? { x: r.x + near.x, y: r.y + near.y } : { x: r.x + it.x, y: r.y + it.y }, then);
  };
  // Otur / yat / sallan
  useEffect(() => {
    const a = p.action;
    if (!a) return;
    if (a.stand) return standUp();
    const r = regionOf(plan, a.space);
    const it = layouts[a.space]?.items[a.index];
    const item = it && itemById(it.item);
    const seat = item && it ? seatOf(item, it) : null;
    if (!r || !seat || !it) return;
    walkToItem(a.space, a.index, () => {
      const w = walker.current;
      w.pose = { ...seat, x: r.x + seat.x, z: r.y + seat.z, back: { x: w.x, z: w.z } };
      setPosed({ space: a.space, index: a.index, key: powerKey(a.space, it) });
      p.onPosed({ space: a.space, index: a.index });
      invalidate();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.action?.n]);
  // Oturduğu eşya taşınır ya da kalkarsa karakter de kalkar
  useEffect(() => {
    if (!posed) return;
    const it = layouts[posed.space]?.items[posed.index];
    if (!it || powerKey(posed.space, it) !== posed.key) standUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layouts]);

  // Başlangıç alanını sayfaya bildir (sekme, envanter)
  useEffect(() => {
    p.onRegion(here);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onTile = (x: number, y: number) => {
    const id = regionAt(plan, { x, y })?.id ?? null;
    if (id !== here) {
      setHere(id);
      p.onRegion(id);
    }
    p.onTile({ x, y });
  };
  const inside = !!here && isIndoor(here);
  const open = editR ? isIndoor(editR.id as SpaceId) || inside : inside;

  // Yakındaki alanlar ayrıntılı çizilir
  const near = useMemo(() => {
    const out = new Set<RegionId>();
    for (const r of plan.regions) {
      const dx = Math.max(r.x - center.x, 0, center.x - (r.x + r.w));
      const dy = Math.max(r.y - center.y, 0, center.y - (r.y + r.h));
      if (Math.hypot(dx, dy) < NEAR) out.add(r.id);
    }
    if (editR) out.add(editR.id);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, center, editR?.id]);

  const heldItem = p.held ? itemById(p.held.item) : undefined;
  const heldWall = heldItem?.placement === 'wall';
  // Eşya ele alınınca modeli önceden yüklensin (önizleme takılmadan görünsün)
  useEffect(() => {
    if (heldItem?.model) useGLTF.preload(modelUrl(heldItem.model));
  }, [heldItem]);
  const local = (t: Tile): Tile => (editR ? { x: t.x - editR.x, y: t.y - editR.y } : t);
  const tileOf = (e: ThreeEvent<PointerEvent | MouseEvent>): Tile => ({ x: Math.floor(e.point.x), y: Math.floor(e.point.z) });

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    // Elde eşya varken bırakma pointerup'ta olur
    if (p.held || performance.now() - droppedAt.current < 400) return;
    p.onFloor();
    setAim(null);
    walkTo(tileOf(e));
  };
  const release = (e: ThreeEvent<PointerEvent>, t: Tile) => {
    if (p.edit && p.held) {
      e.stopPropagation();
      droppedAt.current = performance.now();
      p.onDrop(t);
    }
  };

  const onItem = useStable((kind: 'down' | 'click', space: SpaceId, i: number, e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (kind === 'down') return;
    const it = layouts[space]?.items[i];
    const item = it && itemById(it.item);
    if (!it || !item || !isTap(e as ThreeEvent<MouseEvent>)) return;
    e.stopPropagation();
    if (p.held) return;
    // Yanına yürü; varınca seçenekler (duvar eşyasında ya da yol yoksa hemen)
    p.onAim();
    setAim({ space, index: i });
    const show = () => {
      setAim(null);
      p.onUse(space, i);
    };
    if (item.placement === 'wall' || !walkToItem(space, i, show)) show();
  });
  const onBook = useStable((b: Book) => p.onBook(b));
  const onTree = useStable((t: DayTree) => p.onTree(t));
  const onGrown = useStable(() => p.onGrown());
  const selected = p.using ?? aim;

  return (
    <>
      <Camera plan={plan} walker={walker} follow={follow} indoor={inside} locked={!!p.held} onCenter={setCenter} />
      <WorldScene
        plan={plan}
        map={p.map}
        layouts={layouts}
        forest={p.forest}
        creatures={p.creatures}
        open={open}
        here={editR?.id ?? here}
        night={p.phase === 'gece' || p.phase === 'aksam'}
        near={near}
        labels
        growId={p.growId}
        onGrown={onGrown}
        books={p.books}
        reading={p.reading}
        selected={selected}
        phase={p.phase}
        channels={p.channels}
        tv={p.tv}
        posed={posed}
        center={center}
        onWalk={p.held ? undefined : onWalk}
        onBook={onBook}
        onTree={onTree}
        onItem={onItem}
      />
      {editR && p.edit && (
        <group position={[editR.x, 0, editR.y]}>
          <EditOverlay region={editR} edit={p.edit} ctx={plan.ctx} held={p.held} hoverTo={hoverTo} onRelease={release} />
        </group>
      )}
      {/* Zemine dokunma/sürükleme yakalayıcı: bütün dünya */}
      <mesh
        position={[plan.w / 2, 0.02, plan.h / 2]}
        rotation-x={-Math.PI / 2}
        onClick={onFloorClick}
        onPointerMove={(e) => p.edit && !heldWall && hoverTo.current?.(local(tileOf(e)))}
        onPointerUp={(e) => !heldWall && release(e, local(tileOf(e)))}
      >
        <planeGeometry args={[plan.w, plan.h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Avatar look={p.look} walker={walker} onTile={onTile} holding={p.holding} />
      {p.held && <HoldCursor />}
    </>
  );
}

/**
 * Yerleştirilen alanın içine çizilenler (alanın yerel koordinatında): ızgara, imleç karosu, elde tutulan eşyanın
 * yeşil/kırmızı önizlemesi, duvar süsü tutulurken duvar yakalayıcıları. İmleç state'i burada: imleç gezerken
 * yalnızca bu katman çizilir.
 */
function EditOverlay({
  region,
  edit,
  ctx,
  held,
  hoverTo,
  onRelease,
}: {
  region: Region;
  edit: { space: SpaceId; layout: SpaceLayout };
  ctx: WorldCtx;
  held: { item: string; rot: number } | null;
  hoverTo: MutableRefObject<((t: Tile | null) => void) | null>;
  onRelease: (e: ThreeEvent<PointerEvent>, t: Tile) => void;
}) {
  const [hover, setHover] = useState<Tile | null>(null);
  useEffect(() => {
    hoverTo.current = (t) => setHover((h) => (h && t && h.x === t.x && h.y === t.y ? h : t));
    return () => {
      hoverTo.current = null;
    };
  }, [hoverTo]);
  const heldItem = held ? itemById(held.item) : undefined;
  const heldWall = heldItem?.placement === 'wall';
  const indoor = isIndoor(region.id);
  const ghost =
    held && hover && (heldWall ? hover.x === -1 || hover.y === -1 : hover.x >= 0 && hover.y >= 0)
      ? { item: held.item, x: hover.x, y: hover.y, rot: heldWall ? wallRot(hover.x, hover.y) : held.rot }
      : null;
  const ghostOk = ghost ? canPlaceAt(edit.space, edit.layout, ctx, ghost) : false;
  const support = ghost ? supportOf(edit.layout, ghost) : null;
  const supportItem = support != null ? itemById(edit.layout.items[support].item) : undefined;
  const model = ghost && heldItem && <ItemModel item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ghost={ghostOk ? 'ok' : 'bad'} lift={0.05} />;
  const set = (t: Tile) => hoverTo.current?.(t);
  return (
    <>
      <GridLines w={region.w} h={region.h} color={indoor ? '#6b4a2f' : '#ffffff'} />
      {held && hover && !heldWall && hover.x >= 0 && hover.y >= 0 && hover.x < region.w && hover.y < region.h && <HoverTile x={hover.x} y={hover.y} />}
      {ghost && heldItem && (
        <>
          <FootTiles item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ok={ghostOk} />
          <Suspense fallback={null}>{supportItem ? <OnSurface support={supportItem}>{model}</OnSurface> : model}</Suspense>
        </>
      )}
      {/* Duvar süsü tutulurken duvarlar yakalar: arka duvar y = -1, sol duvar x = -1 */}
      {indoor && heldWall && (
        <>
          <mesh
            position={[region.w / 2, WALL_H / 2, 0.05]}
            onPointerMove={(e) => set({ x: Math.floor(e.point.x - region.x), y: -1 })}
            onPointerUp={(e) => onRelease(e, { x: Math.floor(e.point.x - region.x), y: -1 })}
          >
            <planeGeometry args={[region.w, WALL_H]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh
            position={[0.05, WALL_H / 2, region.h / 2]}
            rotation-y={Math.PI / 2}
            onPointerMove={(e) => set({ x: -1, y: Math.floor(e.point.z - region.y) })}
            onPointerUp={(e) => onRelease(e, { x: -1, y: Math.floor(e.point.z - region.y) })}
          >
            <planeGeometry args={[region.h, WALL_H]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </>
  );
}

function HoldCursor() {
  useEffect(() => {
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = '';
    };
  }, []);
  return null;
}

/**
 * Kamera karakteri izler (kullanıcı kaydırınca bırakır, karakter yürüyünce yeniden izler). Elde eşya varken
 * kamera kilitli (sürükleme eşyayı gezdirir). Evin içindeyken döndürme arka duvarları göstermeye sınırlı.
 */
function Camera({
  plan,
  walker,
  follow,
  indoor,
  locked,
  onCenter,
}: {
  plan: WorldPlan;
  walker: MutableRefObject<Walker>;
  follow: MutableRefObject<boolean>;
  indoor: boolean;
  locked: boolean;
  onCenter: (t: Tile) => void;
}) {
  const { camera, size: view, invalidate } = useThree();
  const controls = useRef<OrbitImpl>(null);
  const reported = useRef({ x: -99, y: -99 });
  const OFF = useMemo(() => new Vector3(18, 20, 18), []);
  const tmp = useMemo(() => new Vector3(), []);
  // ~13 karo görünür (tam ekranda da aynı ölçek)
  const fit = Math.min(view.width, view.height) / 13;

  // Başta ve ekran boyu değişince kamerayı karakterin üstüne yerleştir
  useEffect(() => {
    const c = controls.current;
    const cam = camera;
    const w = walker.current;
    const target = new Vector3(w.x, 0.4, w.z);
    cam.position.copy(target).add(OFF);
    cam.zoom = fit;
    cam.updateProjectionMatrix();
    if (c) {
      c.target.copy(target);
      c.update();
    }
    follow.current = true;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // Kullanıcı kamerayı tutunca izleme biter; karakter yeniden yürüyünce başlar (walkTo)
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const start = () => (follow.current = false);
    const clamp = () => {
      const t = c.target;
      const x = Math.min(plan.w, Math.max(0, t.x));
      const z = Math.min(plan.h, Math.max(0, t.z));
      if (x !== t.x || z !== t.z) {
        const d = new Vector3(x - t.x, 0, z - t.z);
        t.add(d);
        camera.position.add(d);
      }
      const r = reported.current;
      if (Math.abs(t.x - r.x) + Math.abs(t.z - r.y) > 3) {
        reported.current = { x: t.x, y: t.z };
        onCenter({ x: Math.floor(t.x), y: Math.floor(t.z) });
      }
    };
    c.addEventListener('start', start);
    c.addEventListener('change', clamp);
    return () => {
      c.removeEventListener('start', start);
      c.removeEventListener('change', clamp);
    };
  }, [camera, plan.w, plan.h, follow, onCenter]);

  // Karakteri yumuşakça izle
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !follow.current) return;
    const w = walker.current;
    tmp.set(w.x - c.target.x, 0, w.z - c.target.z);
    if (tmp.lengthSq() < 0.0004) return;
    tmp.multiplyScalar(1 - Math.exp(-Math.min(dt, 0.05) * 6));
    c.target.add(tmp);
    camera.position.add(tmp);
    c.update();
    invalidate();
  });

  const az = Math.PI / 4;
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!locked}
      enableDamping={false}
      screenSpacePanning
      minPolarAngle={0.55}
      maxPolarAngle={1.12}
      minAzimuthAngle={indoor ? az - 0.7 : -Infinity}
      maxAzimuthAngle={indoor ? az + 0.7 : Infinity}
      minZoom={fit * 0.35}
      maxZoom={fit * 3}
    />
  );
}
