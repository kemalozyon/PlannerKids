// Adanın 3D dünyası: ışık, zemin, ağaçlar, süsler, hayvanlar. Hem uzaktan bakılan ada (Island3D)
// hem karakterle gezinti (Explore) bunu çizer; yalnızca kamera ve kontroller farklı.
import { Html, useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AdditiveBlending, Color, InstancedMesh, MeshStandardMaterial, Object3D, type Group } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CELLS, speciesById } from '../../lib/forest';
import { cellPosition, islandLayout, ringPoint, rng, wiltSpots, type BiomeId, type DayPhase, type Decor, type DecorKind, type IslandProgress } from '../../lib/island';
import { sfx } from '../../lib/sfx';
import type { Item } from '../../lib/catalog';
import type { ForestTree, Placement } from '../../lib/types';
import type { Wilt } from '../../lib/wilt';
import { PETS, treeModel, useModel } from './models';

export const LIGHT: Record<DayPhase, { label: string; sky: string; sun: string; sunI: number; sky2: string; ground: string; hemiI: number; fog: string }> = {
  sabah: { label: '🌅 Sabah', sky: 'linear-gradient(180deg,#ffe2bd 0%,#bfe3ff 100%)', sun: '#fff0d6', sunI: 2.3, sky2: '#ffe9d0', ground: '#7a5a3a', hemiI: 1.1, fog: '#d9ecff' },
  gunduz: { label: '☀️ Gündüz', sky: 'linear-gradient(180deg,#bfe8ff 0%,#8fd0ff 100%)', sun: '#ffffff', sunI: 2.7, sky2: '#ffffff', ground: '#6a5a3a', hemiI: 1.2, fog: '#a8dcff' },
  aksam: { label: '🌇 Akşam', sky: 'linear-gradient(180deg,#ffc58f 0%,#f2876c 100%)', sun: '#ffae6b', sunI: 1.9, sky2: '#ffcfa8', ground: '#5a3a3a', hemiI: 0.9, fog: '#f6a37e' },
  gece: {
    label: '🌙 Gece',
    sky: 'radial-gradient(1px 1px at 20% 30%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 70% 20%,#fff 50%,transparent 51%),radial-gradient(1.5px 1.5px at 85% 45%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 40% 12%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 10% 60%,#fff 50%,transparent 51%),linear-gradient(180deg,#24336b 0%,#0e1430 100%)',
    sun: '#a9bcff',
    sunI: 0.7,
    sky2: '#7f8fd8',
    ground: '#1f2440',
    hemiI: 0.55,
    fog: '#1a2350',
  },
};

export const PET_OF: Partial<Record<BiomeId, { model: string; pitch: number; fly?: boolean; name: string }>> = {
  tavsan: { model: 'bunny', pitch: 1.3, name: 'Tavşan' },
  civciv: { model: 'chick', pitch: 1.7, name: 'Civciv' },
  tilki: { model: 'fox', pitch: 1, name: 'Tilki' },
  ari: { model: 'bee', pitch: 2, fly: true, name: 'Arı' },
  geyik: { model: 'deer', pitch: 0.75, name: 'Geyik' },
};

const DECOR_MODEL: Record<DecorKind, string> = {
  grass: 'grass_large',
  bush: 'plant_bushDetailed',
  flowerYellow: 'flower_yellowA',
  flowerPurple: 'flower_purpleA',
  flowerRed: 'flower_redB',
  rock: 'rock_largeA',
  stone: 'rock_smallTopA',
  mushroomRed: 'mushroom_redGroup',
  mushroomTan: 'mushroom_tanGroup',
  log: 'log',
  stump: 'stump_old',
};

/** Tıklama mı sürükleme mi: kamera döndürülürken yanlışlıkla dikim olmasın */
export const isTap = (e: ThreeEvent<MouseEvent>) => e.delta < 8;
const pointer = (on: boolean) => () => {
  document.body.style.cursor = on ? 'pointer' : '';
};

/** Gezintide hayvanın dışarıdan okunan/değiştirilen durumu */
export interface PetState {
  x: number;
  z: number;
  tx: number;
  tz: number;
  wait: number;
  mode: 'idle' | 'walk' | 'dance';
  danceUntil: number;
  hopAt: number;
  /** performance.now() zamanı; o zamana kadar oyuncunun peşinden gelir */
  followUntil: number;
  /** Sev: dans, ses, kalp */
  poke: () => void;
}

export interface WorldProps {
  month: string;
  trees: ForestTree[];
  wilts: Wilt[];
  progress: IslandProgress;
  phase: DayPhase;
  placing?: 'none' | 'tree' | 'move';
  movingId?: string;
  onCell?: (cell: number) => void;
  onTree?: (t: ForestTree) => void;
  onWilt?: (w: Wilt) => void;
  /** Gezinti: hayvanların durumu buraya yazılır (yakınlık ve sevme için) */
  pets?: MutableRefObject<Map<string, PetState>>;
  /** Adaya yerleştirilmiş yapılar ve süsler */
  placed?: PlacedThing[];
  /** Yanındaki evcil hayvanlar (gezintide peşinden gelir, adada dolaşır) */
  companions?: Item[];
  /** Gezintide taşınan eşya yerinde çizilmez */
  hidePlacement?: string;
  /** Gezinti: sevilen hayvanların peşinden geleceği oyuncu konumu */
  player?: MutableRefObject<{ x: number; z: number }>;
}

/** Işıklar + ada + ızgara + ağaçlar + süsler + hayvanlar */
export interface PlacedThing {
  p: Placement;
  item: Item;
}

export function World({
  month,
  trees,
  wilts,
  progress,
  phase,
  placing = 'none',
  movingId,
  onCell,
  onTree,
  onWilt,
  pets,
  player,
  placed = [],
  companions = [],
  hidePlacement,
}: WorldProps) {
  const R = progress.radius;
  const layout = useMemo(() => islandLayout(month, progress), [month, progress]);
  const L = LIGHT[phase];
  const night = phase === 'gece' || phase === 'aksam';
  const byCell = useMemo(() => new Map(trees.map((t) => [t.cell, t])), [trees]);
  const spots = useMemo(() => wiltSpots(wilts, layout, R), [wilts, layout, R]);

  // Yeni dikilen / büyütülen ağaçlar: büyüme animasyonu + parçacık + ses (ilk açılışta değil)
  const prev = useRef<Map<string, number> | null>(null);
  const [born, setBorn] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const now = new Map(trees.map((t) => [t.id, t.stage]));
    if (prev.current) {
      const fresh = trees.filter((t) => (prev.current!.get(t.id) ?? -1) < t.stage);
      if (fresh.length) {
        sfx.plant();
        setBorn((b) => new Map([...b, ...fresh.map((t) => [t.id, performance.now()] as [string, number])]));
      }
    }
    prev.current = now;
  }, [trees]);

  return (
    <>
      <hemisphereLight args={[L.sky2, L.ground, L.hemiI]} />
      <directionalLight
        position={[8, 14, 6]}
        color={L.sun}
        intensity={L.sunI}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0005}
      />

      <IslandBase radius={R} />
      <Tiles placing={placing} byCell={byCell} onCell={onCell} />

      <Suspense fallback={null}>
        {trees.map((t) => (
          <Tree3D
            key={t.id}
            tree={t}
            bornAt={born.get(t.id)}
            moving={t.id === movingId}
            dim={placing !== 'none' && t.id !== movingId}
            onClick={() => placing === 'none' && onTree?.(t)}
          />
        ))}
        {layout.decor.map((d, i) => (
          <DecorItem key={i} d={d} />
        ))}
        {layout.pond && <Pond {...layout.pond} />}
        {layout.campfire && <Campfire {...layout.campfire} lit={night} />}
        {spots.map(({ w, x, z }) => (
          <Wilted key={w.item.id} w={w} x={x} z={z} onClick={() => placing === 'none' && onWilt?.(w)} />
        ))}
        {(Object.keys(PET_OF) as BiomeId[])
          .filter((b) => progress.unlocked.has(b))
          .map((b) => (
            <Pet key={b} id={b} {...PET_OF[b]!} radius={R} seed={`${month}:${b}`} avoid={layout.pond} registry={pets} player={player} />
          ))}
        {companions.map((it, i) => (
          <Pet
            key={it.id}
            id={it.id}
            model={it.model!}
            pitch={it.pitch ?? 1}
            fly={it.fly}
            radius={R}
            seed={`${month}:${it.id}`}
            avoid={layout.pond}
            registry={pets}
            player={player}
            companion={i + 1}
          />
        ))}
        {placed
          .filter((t) => t.p.id !== hidePlacement)
          .map((t) => (
            <PlacedModel key={t.p.id} item={t.item} x={t.p.x} z={t.p.z} rot={t.p.rot} />
          ))}
      </Suspense>
      {[...born.entries()].map(([id, at]) => {
        const t = trees.find((x) => x.id === id);
        if (!t) return null;
        const [x, z] = cellPosition(t.cell);
        return <Sparkles key={`${id}-${at}`} x={x} z={z} at={at} />;
      })}
      {night && <Fireflies radius={R} />}
    </>
  );
}

function IslandBase({ radius }: { radius: number }) {
  return (
    <group>
      {/* Çimen üstü */}
      <mesh position={[0, -0.18, 0]} receiveShadow>
        <cylinderGeometry args={[radius, radius, 0.36, 28]} />
        <meshStandardMaterial color="#7cc65a" flatShading />
      </mesh>
      {/* Toprak gövde */}
      <mesh position={[0, -1.05, 0]}>
        <cylinderGeometry args={[radius * 0.99, radius * 0.62, 1.4, 14]} />
        <meshStandardMaterial color="#b0794a" flatShading />
      </mesh>
      <mesh position={[0, -2.05, 0]}>
        <cylinderGeometry args={[radius * 0.62, radius * 0.25, 0.8, 10]} />
        <meshStandardMaterial color="#8d5e3a" flatShading />
      </mesh>
    </group>
  );
}

/** 8×8 dikim ızgarası. Dikim/taşıma sırasında boş hücreler nabız gibi parlar. */
function Tiles({ placing, byCell, onCell }: { placing: 'none' | 'tree' | 'move'; byCell: Map<number, ForestTree>; onCell?: (c: number) => void }) {
  const mats = useMemo(
    () => ({
      a: new MeshStandardMaterial({ color: '#8fd36b' }),
      b: new MeshStandardMaterial({ color: '#86cc63' }),
      open: new MeshStandardMaterial({ color: '#c9f29b', emissive: new Color('#fffbd0'), emissiveIntensity: 0.3 }),
    }),
    [],
  );
  useFrame(({ clock }) => {
    mats.open.emissiveIntensity = 0.25 + Math.sin(clock.elapsedTime * 4) * 0.2;
  });
  return (
    <group>
      {Array.from({ length: CELLS }, (_, cell) => {
        const [x, z] = cellPosition(cell);
        const open = placing !== 'none' && !byCell.has(cell);
        const alt = (Math.floor(cell / 8) + cell) % 2 === 1;
        return (
          <mesh
            key={cell}
            position={[x, 0.025, z]}
            material={open ? mats.open : alt ? mats.b : mats.a}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              if (isTap(e) && open) onCell?.(cell);
            }}
            onPointerOver={open ? pointer(true) : undefined}
            onPointerOut={open ? pointer(false) : undefined}
          >
            <boxGeometry args={[0.94, 0.05, 0.94]} />
          </mesh>
        );
      })}
    </group>
  );
}

const easeOutElastic = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * Math.PI * 3.2));

/** Ağacın tepesinin yaklaşık yüksekliği (balonlar için) */
export const treeTop = (stage: number) => [0.6, 0.8, 1.7, 2.1, 2.7][stage] ?? 2;

function Tree3D({ tree, bornAt, moving, dim, onClick }: { tree: ForestTree; bornAt?: number; moving: boolean; dim: boolean; onClick: () => void }) {
  const sp = speciesById(tree.species);
  const m = treeModel(tree.species, tree.stage, sp.bloom);
  const obj = useModel(m.name, m.colors);
  const ref = useRef<Group>(null);
  const [x, z] = cellPosition(tree.cell);
  const yaw = useMemo(() => rng(tree.id)() * Math.PI * 2, [tree.id]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = bornAt ? (performance.now() - bornAt) / 1000 : 1;
    const s = m.scale * Math.max(0.001, easeOutElastic(Math.min(1, t)));
    g.scale.setScalar(s);
    // Taşınırken havada süzülür; rüzgârda hafifçe sallanır
    g.position.y = moving ? 0.35 + Math.sin(clock.elapsedTime * 5) * 0.08 : 0.05;
    g.rotation.z = Math.sin(clock.elapsedTime * 1.3 + x + z) * 0.025;
  });
  return (
    <group
      ref={ref}
      position={[x, 0.05, z]}
      rotation-y={yaw}
      onClick={(e) => {
        e.stopPropagation();
        if (isTap(e)) {
          sfx.pop();
          onClick();
        }
      }}
      onPointerOver={pointer(true)}
      onPointerOut={pointer(false)}
    >
      <primitive object={obj} />
      {dim && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.45, 16]} />
          <meshBasicMaterial color="#000" transparent opacity={0.12} />
        </mesh>
      )}
    </group>
  );
}

function DecorItem({ d }: { d: Decor }) {
  const obj = useModel(DECOR_MODEL[d.kind]);
  return <primitive object={obj} position={[d.x, 0, d.z]} rotation-y={d.rot} scale={d.scale} />;
}

function Pond({ x, z, r }: { x: number; z: number; r: number }) {
  const lily = useModel('lily_large');
  const lily2 = useModel('lily_small');
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <cylinderGeometry args={[r, r * 0.95, 0.06, 18]} />
        <meshStandardMaterial color="#4fb8e6" flatShading />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[r + 0.12, r + 0.12, 0.05, 18]} />
        <meshStandardMaterial color="#c9b48a" flatShading />
      </mesh>
      <primitive object={lily} position={[r * 0.3, 0.05, -r * 0.2]} scale={1.6} />
      <primitive object={lily2} position={[-r * 0.35, 0.05, r * 0.3]} scale={1.6} />
    </group>
  );
}

function Campfire({ x, z, lit }: { x: number; z: number; lit: boolean }) {
  const logs = useModel('campfire_logs');
  const flame = useRef<Group>(null);
  const light = useRef<{ intensity: number }>(null);
  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 13) * 0.12 + Math.sin(clock.elapsedTime * 7.3) * 0.08;
    if (flame.current) flame.current.scale.set(f, f * 1.15, f);
    if (light.current) light.current.intensity = lit ? 6 * f : 0;
  });
  return (
    <group position={[x, 0, z]}>
      <primitive object={logs} scale={1.6} />
      {lit && (
        <group ref={flame} position={[0, 0.12, 0]}>
          <mesh position={[0, 0.14, 0]}>
            <coneGeometry args={[0.13, 0.36, 6]} />
            <meshBasicMaterial color="#ff9a2e" />
          </mesh>
          <mesh position={[0, 0.1, 0]}>
            <coneGeometry args={[0.08, 0.22, 6]} />
            <meshBasicMaterial color="#ffe36b" />
          </mesh>
        </group>
      )}
      <pointLight ref={light as never} position={[0, 0.6, 0]} color="#ff9a4a" distance={5} decay={1.6} intensity={0} />
    </group>
  );
}

/** Solgun fidan (kahverengi, eğik) ya da kurtarılmış fidan (yeşil çalı) */
function Wilted({ w, x, z, onClick }: { w: Wilt; x: number; z: number; onClick: () => void }) {
  const dead = useModel('crops_leafsStageB', { leaf: '#a98b5b', grass: '#a98b5b' });
  const alive = useModel('plant_bushDetailed', { grass: '#5cc06a' });
  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => {
        e.stopPropagation();
        if (isTap(e)) {
          if (w.revived) sfx.pop();
          else sfx.sad();
          onClick();
        }
      }}
      onPointerOver={pointer(true)}
      onPointerOut={pointer(false)}
    >
      {w.revived ? <primitive object={alive} scale={1.5} /> : <primitive object={dead} scale={1.8} rotation-z={0.45} />}
      {/* Dokunması kolay olsun diye görünmez geniş alan */}
      <mesh position={[0, 0.3, 0]} visible={false}>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
      </mesh>
    </group>
  );
}

/** Adada dolaşan hayvan. Dokununca (ya da gezintide "Sev" ile) dans eder, ses çıkarır, kalp uçar. */
function Pet({
  id,
  model,
  pitch,
  fly,
  radius,
  seed,
  avoid,
  registry,
  player,
  companion,
}: {
  id: string;
  model: string;
  pitch: number;
  fly?: boolean;
  radius: number;
  seed: string;
  avoid: { x: number; z: number; r: number } | null;
  registry?: MutableRefObject<Map<string, PetState>>;
  player?: MutableRefObject<{ x: number; z: number }>;
  /** Arkadaş hayvan: gezintide hep peşinden gelir (sırası, yan yana durmaları için) */
  companion?: number;
}) {
  const { scene, animations } = useGLTF(PETS[model]);
  const obj = useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse((c) => {
      c.castShadow = true;
    });
    return o;
  }, [scene]);
  const group = useRef<Group>(null);
  const { actions } = useAnimations(animations, group);
  const rand = useMemo(() => rng(seed), [seed]);
  const avoidList = useMemo(() => (avoid ? [{ ...avoid, r: avoid.r + 0.3 }] : []), [avoid]);
  const [heart, setHeart] = useState(0);
  const st = useRef<PetState>({
    x: 0,
    z: 0,
    tx: 0,
    tz: 0,
    wait: 1 + rand() * 2,
    mode: 'idle',
    danceUntil: 0,
    hopAt: -10,
    followUntil: companion && player ? Infinity : 0,
    poke: () => {
      const s = st.current;
      s.mode = 'dance';
      s.danceUntil = -1; // bir sonraki karede sahne saatine göre ayarlanır
      if (fly) sfx.buzz();
      else sfx.boing(pitch);
      setHeart((h) => h + 1);
    },
  });
  const playing = useRef<string | null>(null);

  useEffect(() => {
    const start = ringPoint(rand, radius, avoidList) ?? [radius - 1, 0];
    Object.assign(st.current, { x: start[0], z: start[1], tx: start[0], tz: start[1] });
    const reg = registry?.current;
    reg?.set(id, st.current);
    return () => {
      reg?.delete(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = (name: string) => {
    if (playing.current === name) return;
    const next = actions[name] ?? actions.idle;
    if (!next) return;
    if (playing.current) actions[playing.current]?.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    playing.current = name;
  };

  const turnTo = (g: Group, dx: number, dz: number, dt: number) => {
    let diff = Math.atan2(dx, dz) - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 6);
  };

  useFrame(({ clock }, dt) => {
    const s = st.current;
    const g = group.current;
    if (!g) return;
    const now = clock.elapsedTime;
    const following = player && performance.now() < s.followUntil;
    if (s.mode === 'dance') {
      if (s.danceUntil < 0) {
        s.danceUntil = now + 2;
        s.hopAt = now;
      }
      play('dance');
      if (now > s.danceUntil) {
        s.mode = 'idle';
        s.wait = 1 + rand() * 2;
      }
    } else if (following) {
      // Sevilen hayvan oyuncunun bir adım gerisinden gelir (arkadaşlar biraz daha geride, yan yana)
      const gap = companion ? 0.9 + companion * 0.45 : 1;
      const dx = player.current.x - s.x;
      const dz = player.current.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > gap + 0.15) {
        const speed = d > 3 ? 4.6 : 2.8;
        const step = Math.min(d - gap, speed * dt);
        s.x += (dx / d) * step;
        s.z += (dz / d) * step;
        play(fly ? 'idle' : 'walk');
      } else play('idle');
      turnTo(g, dx, dz, dt);
      s.tx = s.x;
      s.tz = s.z;
      s.mode = 'idle';
      s.wait = 2;
    } else if (s.mode === 'idle') {
      play('idle');
      s.wait -= dt;
      if (s.wait <= 0) {
        // Bir sonraki hedef: bulunduğu yere yakın bir nokta (kıyı boyunca dolaşsın)
        for (let i = 0; i < 12; i++) {
          const pt = ringPoint(rand, radius, avoidList);
          if (pt && (fly || Math.hypot(pt[0] - s.x, pt[1] - s.z) < 5)) {
            s.tx = pt[0];
            s.tz = pt[1];
            break;
          }
        }
        s.mode = 'walk';
      }
    } else {
      play(fly ? 'idle' : 'walk');
      const dx = s.tx - s.x;
      const dz = s.tz - s.z;
      const d = Math.hypot(dx, dz);
      const speed = fly ? 1.1 : 0.75;
      if (d < 0.05) {
        s.mode = 'idle';
        s.wait = 1.5 + rand() * 3.5;
      } else {
        const step = Math.min(d, speed * dt);
        s.x += (dx / d) * step;
        s.z += (dz / d) * step;
        turnTo(g, dx, dz, dt);
      }
    }
    const hop = Math.max(0, Math.sin(Math.min(1, (now - s.hopAt) / 0.45) * Math.PI)) * 0.4;
    g.position.set(s.x, (fly ? 1.3 + Math.sin(now * 3) * 0.12 : 0.1) + hop, s.z);
  });

  return (
    <group
      ref={group}
      scale={fly ? 0.3 : 0.42}
      onClick={(e) => {
        e.stopPropagation();
        if (isTap(e)) st.current.poke();
      }}
      onPointerOver={pointer(true)}
      onPointerOut={pointer(false)}
    >
      <primitive object={obj} />
      {heart > 0 && <Heart key={heart} />}
    </group>
  );
}

function Heart() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setOn(false), 1200);
    return () => clearTimeout(id);
  }, []);
  if (!on) return null;
  return (
    <Html position={[0, 3.4, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <span className="pet-heart">❤️</span>
    </Html>
  );
}

/** Dikim/büyütme ya da yıldız toplama anında etrafa saçılan parçacıklar */
export function Sparkles({ x, z, at, y = 0.4 }: { x: number; z: number; at: number; y?: number }) {
  const N = 22;
  const mesh = useRef<InstancedMesh>(null);
  const parts = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const a = (i / N) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 1.2 + Math.random() * 1.4;
        return { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 2.5 + Math.random() * 2, c: new Color(['#ffe36b', '#ffffff', '#9be564', '#ffb3d1'][i % 4]) };
      }),
    [],
  );
  const tmp = useMemo(() => new Object3D(), []);
  useEffect(() => {
    parts.forEach((p, i) => mesh.current?.setColorAt(i, p.c));
    if (mesh.current?.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [parts]);
  useFrame(() => {
    const t = (performance.now() - at) / 1000;
    if (!mesh.current) return;
    parts.forEach((p, i) => {
      tmp.position.set(x + p.vx * t, y + p.vy * t - 4.5 * t * t, z + p.vz * t);
      tmp.scale.setScalar(Math.max(0, 1 - t / 1.1) * 0.09);
      tmp.rotation.set(t * 6, t * 4, 0);
      tmp.updateMatrix();
      mesh.current!.setMatrixAt(i, tmp.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.visible = t < 1.2;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Akşam ve gece adada yanıp sönen ateşböcekleri */
function Fireflies({ radius }: { radius: number }) {
  const N = 32;
  const mesh = useRef<InstancedMesh>(null);
  const seeds = useMemo(() => Array.from({ length: N }, () => ({ a: Math.random() * Math.PI * 2, r: 1 + Math.random() * (radius - 1.5), h: 0.4 + Math.random() * 1.4, s: 0.3 + Math.random() * 0.6, p: Math.random() * 10 })), [radius]);
  const tmp = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!mesh.current) return;
    seeds.forEach((f, i) => {
      const a = f.a + t * f.s * 0.15;
      tmp.position.set(Math.cos(a) * f.r + Math.sin(t * f.s + f.p) * 0.4, f.h + Math.sin(t * 1.7 + f.p) * 0.25, Math.sin(a) * f.r + Math.cos(t * f.s + f.p) * 0.4);
      tmp.scale.setScalar(0.045 * (0.4 + Math.max(0, Math.sin(t * 2.2 + f.p))));
      tmp.updateMatrix();
      mesh.current!.setMatrixAt(i, tmp.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color="#fff27a" transparent opacity={0.95} blending={AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

/** Adaya yerleştirilmiş yapı ya da süs */
export function PlacedModel({ item, x, z, rot, y = 0 }: { item: Item; x: number; z: number; rot: number; y?: number }) {
  const obj = useModel(item.model!);
  return <primitive object={obj} position={[x, y, z]} rotation-y={rot} scale={item.scale ?? 1} />;
}
