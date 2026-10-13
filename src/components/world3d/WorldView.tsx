// Dünyanın 3D görünümü: bütün dünya (ev, bahçe, orman yolu, ay bahçeleri) tek sahnede (WorldScene). İzometrik
// hisli ortografik kamera karakteri izler; döndürme, yakınlaştırma ve kaydırma serbest (evin içindeyken açı ön
// çeyrekle sınırlı). Sahne yalnızca bir şey değişince çizilir (frameloop="demand").
//
// Oynarken: bir karoya dokununca karakter A* ile oraya yürür (uzun yolda koşar); alanlar arasında yalnızca
// kapılardan geçer (worldPlan.ts → canStep). Eve girince çatı kalkar. Kitaplığa, kitaba ya da ağaca dokununca
// yanına gidip penceresini açar.
// Bir eşyaya dokununca karakter yanına yürür ve sayfa kullanma çubuğunu açar (otur, yat, sallan, aç-kapa, TV
// kanalı, taşı, döndür, kaldır). Oturunca karakter eşyanın üstüne geçer; boş bir yere dokununca kalkar.
// Oyunda taşırken (`edit.full` yok) karakter görünür kalır, eşya elde imleçle gezer, karoya bırakılır.
// Düzenlerken (Habbo gibi): karakterin bulunduğu alan düzenlenir; kamera o alana sığar ve sabit açıya kilitlenir,
// ızgara ve imlecin altındaki karo görünür. Eşyaya dokun → seç; sürükle → taşı; envanterden seçilen eşya
// karoya (duvar süsü duvara) bırakılır.
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Vector3, type DirectionalLight, type OrthographicCamera } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { AvatarLook } from '../../lib/avatar';
import { itemById } from '../../lib/catalog';
import { CFG, type MapDef } from '../../lib/config';
import type { DayPhase } from '../../lib/dayPhase';
import type { Book } from '../../lib/types';
import { approachTile, blockedTiles, canPlaceAt, findPath, isIndoor, powerKey, seatOf, supportOf, wallRot, type DayTree, type SpaceId, type SpaceLayout, type Tile } from '../../lib/world';
import { canStep, entryOf, regionAt, regionOf, worldBlocked, type Region, type RegionId, type WorldPlan } from '../../lib/worldPlan';
import type { TvData } from './art';
import Avatar, { pathSpeed, type Walker } from './Avatar';
import { FootTiles, GridLines, HoverTile, ItemModel, OnSurface } from './items';
import { isTap, LIGHT } from './light';
import { WALL_H } from './Room';
import WorldScene from './WorldScene';

/** Düzenleme çubuğu ve envanter çekmecesinin kapladığı yükseklik (px) */
const EDIT_TOP = 46;
const EDIT_BOTTOM = 250;
/** Kamera hedefinden bu kadar karo uzaktaki alanlar sade çizilir */
const NEAR = 26;

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
  /** Düzenlenen alan ve taslağı; full: "Düzenle" modu (kamera alana sığar, karakter gizlenir), değilse oyunda taşıma */
  edit: { space: SpaceId; layout: SpaceLayout; full: boolean } | null;
  /** Elde tutulan eşya (yerleştirme) */
  held: { item: string; rot: number } | null;
  selected: number | null;
  onPick: (index: number) => void;
  onDrop: (tile: Tile) => void;
  onSelect: (index: number | null) => void;
  onTree: (t: DayTree) => void;
  /** Oynarken bir eşyaya dokunuldu (kullanma çubuğu) */
  onUse: (space: SpaceId, index: number) => void;
  /** Oynarken boş bir yere dokunuldu (kullanma çubuğu kapanır) */
  onFloor: () => void;
  /** Oynarken seçili eşya (biraz havalanır) */
  using: { space: SpaceId; index: number } | null;
  /** Otur / yat / sallan isteği: n her istekte artar */
  action: { space: SpaceId; index: number; n: number; stand?: boolean } | null;
  /** Karakter bir eşyanın üstüne geçti ya da kalktı */
  onPosed: (p: { space: SpaceId; index: number } | null) => void;
  power: Record<string, boolean>;
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
  const full = !!p.edit?.full;
  const layouts = useMemo(() => (p.edit ? { ...p.layouts, [p.edit.space]: p.edit.layout } : p.layouts), [p.layouts, p.edit]);
  const blocked = useMemo(() => worldBlocked(plan, layouts), [plan, layouts]);
  const step = useMemo(() => (a: Tile, b: Tile) => canStep(plan, a, b), [plan]);
  const walker = useRef<Walker>({ x: p.start.x + 0.5, z: p.start.y + 0.5, face: Math.PI / 4, path: [], onArrive: null });
  const follow = useRef(true);
  const [here, setHere] = useState<RegionId | null>(() => regionAt(plan, p.start)?.id ?? null);
  const [center, setCenter] = useState<Tile>(p.start);
  const [hover, setHover] = useState<Tile | null>(null);
  /** Bırakmanın hemen ardından gelen "click" seçimi kaldırmasın */
  const droppedAt = useRef(0);
  /** Eşyaya basılıp sürüklenince taşınır */
  const press = useRef<{ index: number; tile: Tile } | null>(null);
  useEffect(() => {
    const up = () => (press.current = null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

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
  /** Dünya karosuna yürü; varınca then() */
  const walkTo = (to: Tile, then?: () => void) => {
    standUp();
    const path = findPath(tileNow(), to, plan.w, plan.h, blocked, step);
    if (!path) return;
    walker.current.path = path.map((t) => ({ x: t.x + 0.5, z: t.y + 0.5 }));
    walker.current.speed = pathSpeed(path.length);
    walker.current.onArrive = then ?? null;
    follow.current = true;
    invalidate();
  };
  // Sekmeden bir alana git
  useEffect(() => {
    if (!p.goal) return;
    const to = entryOf(plan, p.goal.to);
    if (to) walkTo(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.goal?.n]);

  /** Eşyanın önüne yürü (dünya karosu); varınca then() */
  const walkToItem = (space: SpaceId, i: number, then?: () => void) => {
    const r = regionOf(plan, space);
    const it = layouts[space]?.items[i];
    const item = it && itemById(it.item);
    if (!r || !it || !item) return;
    const near = approachTile(item, it, r.w, r.h, blockedTiles(space, layouts[space]!, plan.ctx));
    walkTo(near ? { x: r.x + near.x, y: r.y + near.y } : { x: r.x + it.x, y: r.y + it.y }, then);
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

  // Başlangıç alanını sayfaya bildir (sekme, Düzenle)
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
  const inside = here === 'room' || here === 'library';
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
  }, [plan, center, editR]);

  const editing = !!p.edit;
  const heldItem = p.held ? itemById(p.held.item) : undefined;
  const heldWall = heldItem?.placement === 'wall';
  const local = (t: Tile): Tile => (editR ? { x: t.x - editR.x, y: t.y - editR.y } : t);
  const tileOf = (e: ThreeEvent<PointerEvent | MouseEvent>): Tile => ({ x: Math.floor(e.point.x), y: Math.floor(e.point.z) });

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    if (full) {
      if (!p.held && performance.now() - droppedAt.current > 400) p.onSelect(null);
      return;
    }
    // Oyunda taşırken bırakma pointerup'ta olur
    if (p.held || performance.now() - droppedAt.current < 400) return;
    p.onFloor();
    walkTo(tileOf(e));
  };
  const move = (t: Tile) => {
    if (!hover || hover.x !== t.x || hover.y !== t.y) setHover(t);
    const pr = press.current;
    if (pr && !p.held && (pr.tile.x !== t.x || pr.tile.y !== t.y)) {
      press.current = null;
      p.onPick(pr.index);
    }
  };
  const release = (e: ThreeEvent<PointerEvent>, t: Tile) => {
    if (editing && p.held) {
      e.stopPropagation();
      droppedAt.current = performance.now();
      p.onDrop(t);
    }
  };

  const onItem = (kind: 'down' | 'click', space: SpaceId, i: number, e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const l = layouts[space];
    const it = l?.items[i];
    const item = it && itemById(it.item);
    if (!it || !item) return;
    if (kind === 'down') {
      if (!full || p.held || space !== p.edit!.space) return;
      e.stopPropagation();
      press.current = { index: i, tile: { x: it.x, y: it.y } };
      return;
    }
    if (!isTap(e as ThreeEvent<MouseEvent>)) return;
    e.stopPropagation();
    if (full) {
      if (!p.held && space === p.edit!.space) p.onSelect(i);
      return;
    }
    if (p.held) return;
    // Oynarken: yanına yürü, kullanma çubuğu açılsın (duvar eşyasına yürümeden)
    p.onUse(space, i);
    if (item.placement !== 'wall') walkToItem(space, i);
  };

  // Düzenlenen alanın içine çizilenler: ızgara, imleç karosu, önizleme, duvar yakalayıcılar
  const editLayout = p.edit?.layout;
  const ghost =
    p.held && hover && editR && (heldWall ? hover.x === -1 || hover.y === -1 : hover.x >= 0 && hover.y >= 0)
      ? { item: p.held.item, x: hover.x, y: hover.y, rot: heldWall ? wallRot(hover.x, hover.y) : p.held.rot }
      : null;
  const ghostOk = ghost && p.edit ? canPlaceAt(p.edit.space, p.edit.layout, plan.ctx, ghost) : false;
  const ghostSupport = ghost && editLayout ? supportOf(editLayout, ghost) : null;
  const indoorEdit = !!editR && isIndoor(editR.id as SpaceId);
  const extra = editR && p.edit && (full || p.held) && (
    <>
      <GridLines w={editR.w} h={editR.h} color={indoorEdit ? '#6b4a2f' : '#ffffff'} />
      {hover && !heldWall && hover.x >= 0 && hover.y >= 0 && hover.x < editR.w && hover.y < editR.h && <HoverTile x={hover.x} y={hover.y} />}
      {ghost && heldItem && (
        <>
          <FootTiles item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ok={ghostOk} />
          {ghostSupport != null && itemById(editLayout!.items[ghostSupport].item) ? (
            <OnSurface support={itemById(editLayout!.items[ghostSupport].item)!}>
              <ItemModel item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ghost={ghostOk ? 'ok' : 'bad'} lift={0.05} />
            </OnSurface>
          ) : (
            <ItemModel item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ghost={ghostOk ? 'ok' : 'bad'} lift={0.05} />
          )}
        </>
      )}
      {/* Duvar süsü tutulurken duvarlar yakalar: arka duvar y = -1, sol duvar x = -1 */}
      {indoorEdit && heldWall && (
        <>
          <mesh
            position={[editR.w / 2, WALL_H / 2, 0.05]}
            onPointerMove={(e) => move({ x: Math.floor(e.point.x - editR.x), y: -1 })}
            onPointerUp={(e) => release(e, { x: Math.floor(e.point.x - editR.x), y: -1 })}
          >
            <planeGeometry args={[editR.w, WALL_H]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh
            position={[0.05, WALL_H / 2, editR.h / 2]}
            rotation-y={Math.PI / 2}
            onPointerMove={(e) => move({ x: -1, y: Math.floor(e.point.z - editR.y) })}
            onPointerUp={(e) => release(e, { x: -1, y: Math.floor(e.point.z - editR.y) })}
          >
            <planeGeometry args={[editR.h, WALL_H]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </>
  );

  return (
    <>
      <Camera plan={plan} walker={walker} follow={follow} edit={full ? editR : null} indoor={inside || (full && indoorEdit)} locked={!!p.held} onCenter={setCenter} />
      <WorldScene
        plan={plan}
        map={p.map}
        layouts={layouts}
        forest={p.forest}
        creatures={p.creatures}
        open={open}
        night={p.phase === 'gece' || p.phase === 'aksam'}
        near={near}
        labels
        growId={p.growId}
        onGrown={p.onGrown}
        books={p.books}
        reading={p.reading}
        selected={full && p.edit && p.selected != null ? { space: p.edit.space, index: p.selected } : !full ? p.using : null}
        phase={p.phase}
        power={p.power}
        channels={p.channels}
        tv={p.tv}
        posed={posed}
        center={center}
        onWalk={full || p.held ? undefined : walkTo}
        onBook={p.onBook}
        onTree={p.onTree}
        onItem={onItem}
        extra={p.edit && extra ? { [p.edit.space]: extra } : undefined}
      />
      {/* Zemine dokunma/sürükleme yakalayıcı: bütün dünya */}
      <mesh
        position={[plan.w / 2, 0.02, plan.h / 2]}
        rotation-x={-Math.PI / 2}
        onClick={onFloorClick}
        onPointerMove={(e) => (full || p.held) && !heldWall && move(local(tileOf(e)))}
        onPointerUp={(e) => !heldWall && release(e, local(tileOf(e)))}
      >
        <planeGeometry args={[plan.w, plan.h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {!full && <Avatar look={p.look} walker={walker} onTile={onTile} />}
      {p.held && <HoldCursor />}
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
 * Kamera karakteri izler (kullanıcı kaydırınca bırakır, karakter yürüyünce yeniden izler). Düzenlerken o alana
 * sığar, açı sabitlenir (Habbo gibi izometrik); yakınlaştırma ve kaydırma açık kalır. Evin içindeyken döndürme
 * arka duvarları göstermeye sınırlı.
 */
function Camera({
  plan,
  walker,
  follow,
  edit,
  indoor,
  locked,
  onCenter,
}: {
  plan: WorldPlan;
  walker: MutableRefObject<Walker>;
  follow: MutableRefObject<boolean>;
  edit: Region | null;
  indoor: boolean;
  locked: boolean;
  onCenter: (t: Tile) => void;
}) {
  const { camera, size: view, invalidate } = useThree();
  const controls = useRef<OrbitImpl>(null);
  const reported = useRef({ x: -99, y: -99 });
  const OFF = useMemo(() => new Vector3(18, 20, 18), []);
  const tmp = useMemo(() => new Vector3(), []);
  // Oynarken ~13 karo görünür; düzenlerken alan çekmece ile çubuk arasına sığar
  const base = Math.min(view.width, view.height) / 13;
  const insetTop = edit ? EDIT_TOP : 0;
  const insetBottom = edit ? EDIT_BOTTOM : 0;
  const fit = edit
    ? Math.min(view.width / (((edit.w + edit.h) / Math.SQRT2) * 1.05), (view.height - insetTop - insetBottom) / (((edit.w + edit.h) / Math.SQRT2) * 0.85))
    : base;

  useEffect(() => {
    const cam = camera as OrthographicCamera;
    if (edit) cam.setViewOffset(view.width, view.height, 0, (insetBottom - insetTop) / 2, view.width, view.height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, edit, view.width, view.height, insetTop, insetBottom, invalidate]);

  // Başta ve düzenlemeye girip çıkınca kamerayı yerleştir
  useEffect(() => {
    const c = controls.current;
    const cam = camera as OrthographicCamera;
    const w = walker.current;
    const target = edit ? new Vector3(edit.x + edit.w / 2, isIndoorRegion(edit) ? 0.6 : 0, edit.y + edit.h / 2) : new Vector3(w.x, 0.4, w.z);
    cam.position.copy(target).add(OFF);
    cam.zoom = fit;
    cam.updateProjectionMatrix();
    if (c) {
      c.target.copy(target);
      c.update();
    }
    follow.current = !edit;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.id, fit]);

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
    if (!c || edit || !follow.current) return;
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
      enableRotate={!edit}
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

const isIndoorRegion = (r: Region) => r.id === 'room' || r.id === 'library';
