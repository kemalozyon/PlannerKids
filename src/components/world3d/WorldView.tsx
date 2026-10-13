// Dünyanın 3D görünümü: oda, kütüphane odası ya da dış mekân. Hepsi aynı karo ızgarası ve aynı yerleştirme
// motoruyla çizilir. İzometrik hisli ortografik kamera; döndürme ve yakınlaştırma serbest, kaydırma alanla sınırlı.
// Sahne yalnızca bir şey değişince çizilir (frameloop="demand"): yürüyüş, büyüme, kamera hareketi kare ister.
//
// Oynarken: karoya dokununca karakter A* ile oraya yürür; kapıya gidince alan değişir; kitaplığa ya da ağaca
// dokununca yanına gidip penceresini açar. Düzenlerken: eşyaya bas → kaldır, karoya bırak (yeşil: olur, kırmızı: olmaz).
import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Vector3, type OrthographicCamera } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { itemById, type Item } from '../../lib/catalog';
import type { FixedTile, SpaceId } from '../../lib/config';
import type { DayPhase } from '../../lib/dayPhase';
import {
  blockedTiles,
  canPlaceAt,
  findPath,
  fixedTiles,
  outdoorBlocked,
  spaceSize,
  type OutdoorMap,
  type PlacedItem,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
  type WorldTree,
} from '../../lib/world';
import { CFG } from '../../lib/config';
import Avatar, { type Walker } from './Avatar';
import { FootTiles, GridLines, ItemModel } from './items';
import { isTap, LIGHT } from './light';
import Outdoor from './Outdoor';
import Room from './Room';

export type WorldKind = 'room' | 'library' | 'outdoor';

export interface WorldViewProps {
  kind: WorldKind;
  /** Odanın, kütüphanenin ya da bahçenin (düzenlenen) yerleşimi */
  layout: SpaceLayout;
  ctx: WorldCtx;
  map: OutdoorMap | null;
  creatures: typeof CFG.world.creatures;
  phase: DayPhase;
  shadows: boolean;
  character: string;
  accessory: Item | null;
  /** Karakterin başladığı karo */
  start: Tile;
  /** Kameranın baktığı karo (bölge seçilince) */
  focus: Tile | null;
  growId: string | null;
  onGrown: () => void;
  editing: boolean;
  /** Elde tutulan eşya (yerleştirme) */
  held: { item: string; rot: number } | null;
  selected: number | null;
  onPick: (index: number) => void;
  onDrop: (tile: Tile) => void;
  onSelect: (index: number | null) => void;
  onDoor: (to: SpaceId) => void;
  onOpen: (index: number) => void;
  onTree: (t: WorldTree) => void;
}

export default function WorldView(props: WorldViewProps) {
  const L = LIGHT[props.phase];
  const indoor = props.kind !== 'outdoor';
  return (
    <Canvas
      orthographic
      frameloop="demand"
      shadows={props.shadows}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [20, 22, 20], zoom: 40, near: -200, far: 400 }}
      style={{ background: indoor ? 'linear-gradient(180deg,#f7efe3 0%,#e9dcc6 100%)' : L.sky, touchAction: 'none' }}
      aria-label={indoor ? 'Odan' : 'Bahçen ve ormanın'}
    >
      <Lights indoor={indoor} phase={props.phase} shadows={props.shadows} />
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  );
}

function Lights({ indoor, phase, shadows }: { indoor: boolean; phase: DayPhase; shadows: boolean }) {
  const L = LIGHT[phase];
  const night = phase === 'gece';
  return (
    <>
      <hemisphereLight args={[indoor ? '#fff5e6' : L.sky2, indoor ? '#8a6a4a' : L.ground, indoor ? (night ? 0.75 : 1.15) : L.hemiI]} />
      <directionalLight
        position={[12, 20, 8]}
        intensity={indoor ? (night ? 0.8 : 1.6) : L.sunI}
        color={indoor ? '#fff2dc' : L.sun}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={120}
      />
    </>
  );
}

function Scene(p: WorldViewProps) {
  const indoor = p.kind !== 'outdoor';
  const space: SpaceId = indoor ? (p.kind as SpaceId) : 'garden';
  const size = indoor ? spaceSize(space, p.ctx) : { w: p.map!.width, h: p.map!.height };
  const fixed = useMemo(() => fixedTiles(space, p.ctx), [space, p.ctx]);
  const doors = useMemo(() => {
    const out: FixedTile[] = [];
    for (const f of fixed.values()) if (f.kind === 'door' && !out.includes(f)) out.push(f);
    return out;
  }, [fixed]);
  const blocked = useMemo(
    () => (indoor ? blockedTiles(space, p.layout, p.ctx) : outdoorBlocked(p.map!, p.layout, p.ctx)),
    [indoor, space, p.layout, p.ctx, p.map],
  );
  const invalidate = useThree((s) => s.invalidate);
  const walker = useRef<Walker>({ x: p.start.x + 0.5, z: p.start.y + 0.5, face: indoor ? Math.PI / 4 : 0, path: [], onArrive: null });
  const [hover, setHover] = useState<Tile | null>(null);
  /** Bırakmanın hemen ardından gelen "click" seçimi kaldırmasın */
  const droppedAt = useRef(0);

  const here = (): Tile => {
    const w = walker.current;
    return { x: Math.floor(w.x), y: Math.floor(w.z) };
  };
  /** Karoya yürü; varınca then() */
  const walkTo = (to: Tile, then?: () => void) => {
    const path = findPath(here(), to, size.w, size.h, blocked);
    if (!path) return;
    walker.current.path = path.map((t) => ({ x: t.x + 0.5, z: t.y + 0.5 }));
    walker.current.onArrive = then ?? null;
    invalidate();
  };
  const goDoor = (d: FixedTile) => walkTo({ x: d.x, y: d.y }, () => d.to && p.onDoor(d.to));

  const tileOf = (e: ThreeEvent<PointerEvent | MouseEvent>): Tile => ({ x: Math.floor(e.point.x), y: Math.floor(e.point.z) });

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    const t = tileOf(e);
    if (p.editing) {
      if (!p.held && performance.now() - droppedAt.current > 400) p.onSelect(null);
      return;
    }
    const door = doors.find((d) => d.x === t.x && d.y === t.y);
    if (door) goDoor(door);
    else walkTo(t);
  };

  const ghost = p.held && hover ? { item: p.held.item, x: hover.x, y: hover.y, rot: p.held.rot } : null;
  const ghostItem = ghost ? itemById(ghost.item) : undefined;
  const ghostOk = ghost ? canPlaceAt(space, p.layout, p.ctx, ghost) : false;

  const outdoorDoor = doors.find((d) => d.to === 'room');
  const editW = indoor ? size.w : p.map!.garden.w;
  const editH = indoor ? size.h : p.map!.garden.h;

  return (
    <>
      <Camera size={size} fitTo={indoor ? size : p.map!.garden} indoor={indoor} focus={p.focus} kind={p.kind} locked={!!p.held} />
      {indoor ? (
        <Room w={size.w} h={size.h} floor={itemById(p.layout.floor ?? 'zemin:ahsap')} wall={itemById(p.layout.wall ?? 'duvar:krem')} doors={doors} onDoor={goDoor} />
      ) : (
        <Outdoor
          map={p.map!}
          fixed={fixed}
          growId={p.growId}
          onGrown={p.onGrown}
          creatures={p.creatures}
          onHouse={() => outdoorDoor && goDoor(outdoorDoor)}
          onTree={(t, tile) => walkTo(tile, () => p.onTree(t))}
        />
      )}
      {/* Zemine dokunma/sürükleme yakalayıcı */}
      <mesh
        position={[size.w / 2, 0.005, size.h / 2]}
        rotation-x={-Math.PI / 2}
        onClick={onFloorClick}
        onPointerMove={(e) => {
          if (!p.editing) return;
          const t = tileOf(e);
          if (!hover || hover.x !== t.x || hover.y !== t.y) setHover(t);
        }}
        onPointerUp={(e) => {
          // Sürükle-bırak: eşya bırakıldığı karoya konur (dokunmatikte de)
          if (p.editing && p.held) {
            e.stopPropagation();
            droppedAt.current = performance.now();
            p.onDrop(tileOf(e));
          }
        }}
      >
        <planeGeometry args={[size.w, size.h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {p.layout.items.map((it, i) => {
        const item = itemById(it.item);
        if (!item?.model) return null;
        return (
          <ItemModel
            key={`${i}-${it.item}`}
            item={item}
            x={it.x}
            y={it.y}
            rot={it.rot}
            lift={p.selected === i ? 0.12 : 0}
            onPointerDown={(e) => {
              if (!p.editing || p.held) return;
              e.stopPropagation();
              p.onPick(i);
            }}
            onClick={(e) => {
              if (p.editing || !isTap(e)) return;
              e.stopPropagation();
              walkTo({ x: it.x, y: it.y }, item.opens ? () => p.onOpen(i) : undefined);
            }}
          />
        );
      })}
      {p.editing && <GridLines w={editW} h={editH} color={indoor ? '#6b4a2f' : '#ffffff'} />}
      {ghost && ghostItem && (
        <>
          <FootTiles item={ghostItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ok={ghostOk} />
          <ItemModel item={ghostItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ghost={ghostOk ? 'ok' : 'bad'} lift={0.05} />
        </>
      )}
      {!p.editing && <Avatar model={p.character} accessory={p.accessory} walker={walker} />}
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

/** Kamerayı alana sığdırır; kaydırma alanın içinde kalır, iç mekânda döndürme arka duvarları göstermeye sınırlı */
function Camera({
  size,
  fitTo,
  indoor,
  focus,
  kind,
  locked,
}: {
  size: { w: number; h: number };
  /** Açılışta ekrana sığdırılan alan (dışarıda bahçe) */
  fitTo: { w: number; h: number };
  indoor: boolean;
  focus: Tile | null;
  kind: WorldKind;
  locked: boolean;
}) {
  const { camera, size: view, invalidate } = useThree();
  const controls = useRef<OrbitImpl>(null);
  const fit = useMemo(() => {
    const span = ((fitTo.w + fitTo.h) / Math.SQRT2) * (indoor ? 1 : 0.8);
    return Math.min(view.width / (span * 1.1), view.height / (span * 0.9));
  }, [indoor, fitTo.w, fitTo.h, view.width, view.height]);

  // Alan değişince ya da bölge seçilince kamerayı oraya taşı
  useEffect(() => {
    const c = controls.current;
    const cam = camera as OrthographicCamera;
    const target = focus ? new Vector3(focus.x + 0.5, 0, focus.y + 0.5) : new Vector3(fitTo.w / 2, indoor ? 0.4 : 0, fitTo.h / 2);
    const offset = new Vector3(18, 20, 18);
    cam.position.copy(target).add(offset);
    cam.zoom = fit;
    cam.updateProjectionMatrix();
    if (c) {
      c.target.copy(target);
      c.update();
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, focus?.x, focus?.y, fit]);

  // Kaydırma sınırı: hedef alanın dışına çıkmasın
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const clamp = () => {
      const t = c.target;
      const x = Math.min(size.w, Math.max(0, t.x));
      const z = Math.min(size.h, Math.max(0, t.z));
      if (x !== t.x || z !== t.z) {
        const d = new Vector3(x - t.x, 0, z - t.z);
        t.add(d);
        camera.position.add(d);
      }
    };
    c.addEventListener('change', clamp);
    return () => c.removeEventListener('change', clamp);
  }, [camera, size.w, size.h]);

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
      minZoom={fit * (indoor ? 0.6 : 0.3)}
      maxZoom={fit * 3}
    />
  );
}

export type { PlacedItem };
