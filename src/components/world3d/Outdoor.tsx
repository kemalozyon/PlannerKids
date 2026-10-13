// Dış mekân: solda bahçe (ev, çalıştıkça açılan dere/tepe/göl/köprü/koru ve satın alınan süsler), sağa doğru
// aylık orman bölgeleri. Her seans bir ağaç: türü süreye göre, yeri seans kimliğinden tohumlanır (world.ts).
// Tekrar eden ağaçlar türe göre tek çizimde (InstancedMesh) çizilir; yeni dikilen ağaç bir kez elastik büyür.
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Color, ExtrudeGeometry, Matrix4, Mesh, Object3D, Shape, SRGBColorSpace, type Group, type InstancedMesh, type Material, type BufferGeometry } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { formatMonth } from '../../lib/forest';
import type { FixedTile } from '../../lib/config';
import { rng } from '../../lib/rng';
import type { OutdoorMap, WorldTree } from '../../lib/world';
import { CFG } from '../../lib/config';
import { modelUrl, useModel, type Recolor } from '../forest3d/models';
import { isTap } from './light';

/** Ağaç türlerinin görünüşü (eşikler config'te, model burada) */
export const TREE_LOOK: Record<string, { model: string; scale: number; colors: Recolor }> = {
  fidan: { model: 'crops_leafsStageB', scale: 1.15, colors: { grass: '#7ccf5a' } },
  cali: { model: 'plant_bushDetailed', scale: 1.35, colors: { grass: '#5fb85a' } },
  genc: { model: 'tree_small', scale: 1.3, colors: { leaf: '#7ad35a' } },
  cam: { model: 'tree_pineRoundA', scale: 1.3, colors: { leaf: '#2f9d63' } },
  mese: { model: 'tree_oak', scale: 1.4, colors: { leaf: '#4fae4c' } },
  dev: { model: 'tree_pineTallA_detailed', scale: 1.65, colors: { leaf: '#2d8a57' } },
  kuru: { model: 'tree_thin_fall', scale: 1.15, colors: { leaf: '#a8987e', wood: '#7a6a5a' } },
};

const GRASS = '#7ccf5a';
const GRASS_SIDE = '#8a6a43';
const FOREST = '#5fae4f';

export interface OutdoorProps {
  map: OutdoorMap;
  fixed: Map<string, FixedTile>;
  /** Bir kez büyüme animasyonu oynatılacak ağaç */
  growId: string | null;
  onGrown: () => void;
  onTree: (t: WorldTree, tile: { x: number; y: number }) => void;
  onHouse: () => void;
  creatures: typeof CFG.world.creatures;
  /** Bölge tabelaları (DOM etiketi; gezintide kapalı) */
  labels?: boolean;
}

export default function Outdoor({ map, fixed, growId, onGrown, onTree, onHouse, creatures, labels = true }: OutdoorProps) {
  const { garden } = map;
  return (
    <group>
      {/* Bahçe ve bölgelerin toprağı */}
      <Ground x={0} y={0} w={garden.w} h={garden.h} color={GRASS} />
      {map.path.map((p) => (
        <Ground key={`${p.x},${p.y}`} x={p.x} y={p.y} w={1} h={1} color="#d9b27a" low />
      ))}
      {map.regions.map((r) => (
        <group key={r.month}>
          <Ground x={r.ox} y={r.oy} w={r.size} h={r.size} color={FOREST} />
          <Ground x={r.ox} y={CFG.world.garden.pathRow} w={r.size} h={1} color="#d9b27a" low />
          {labels && <Sign x={r.ox + 0.5} z={CFG.world.garden.pathRow + 0.5} text={`🌲 ${formatMonth(r.month)} · ${r.trees.filter((t) => !t.dry).length}`} />}
        </group>
      ))}
      <Features fixed={fixed} onHouse={onHouse} />
      <Trees map={map} growId={growId} onTree={onTree} />
      {growId && <Growing map={map} id={growId} onDone={onGrown} />}
      <Creatures list={creatures} map={map} />
    </group>
  );
}

/** Bölge tabelası: tuvale çizilmiş yazı, her zaman kameraya dönük (DOM etiketi değil) */
function Sign({ x, z, text }: { x: number; z: number; text: string }) {
  const { map, aspect } = useMemo(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    const font = '800 44px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 48;
    c.width = w;
    c.height = 76;
    g.font = font;
    g.fillStyle = '#c9a46b';
    g.beginPath();
    g.roundRect(0, 6, w, 70, 18);
    g.fill();
    g.fillStyle = '#fff8e8';
    g.beginPath();
    g.roundRect(0, 0, w, 68, 18);
    g.fill();
    g.fillStyle = '#5a3d1f';
    g.textBaseline = 'middle';
    g.fillText(text, 24, 36);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return { map: t, aspect: w / 76 };
  }, [text]);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <sprite position={[x, 1.9, z]} scale={[1.2 * aspect, 1.2, 1]}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  );
}

function Ground({ x, y, w, h, color, low }: { x: number; y: number; w: number; h: number; color: string; low?: boolean }) {
  const d = low ? 0.06 : 0.5;
  return (
    <group>
      <mesh position={[x + w / 2, -d / 2 - (low ? -0.005 : 0), y + h / 2]} receiveShadow>
        <boxGeometry args={[w, d, h]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {!low && (
        <mesh position={[x + w / 2, -0.55, y + h / 2]}>
          <boxGeometry args={[w - 0.04, 0.5, h - 0.04]} />
          <meshStandardMaterial color={GRASS_SIDE} />
        </mesh>
      )}
    </group>
  );
}

// ---------- Sabit karolar: ev, su, köprü, tepe, koru ----------
function Features({ fixed, onHouse }: { fixed: Map<string, FixedTile>; onHouse: () => void }) {
  const groups = useMemo(() => {
    const water: [number, number][] = [];
    const bridge: [number, number][] = [];
    const seen = new Set<FixedTile>();
    const rects: FixedTile[] = [];
    for (const [k, f] of fixed) {
      const [x, y] = k.split(',').map(Number);
      if (f.kind === 'water') water.push([x, y]);
      else if (f.kind === 'bridge') bridge.push([x, y]);
      else if (!seen.has(f)) {
        seen.add(f);
        rects.push(f);
      }
    }
    // Köprü yalnızca su üstündeyse anlamlı: köprünün altına da su çiz
    return { water: [...water, ...bridge], bridge, rects };
  }, [fixed]);
  return (
    <group>
      {groups.water.map(([x, y]) => (
        <mesh key={`w${x},${y}`} position={[x + 0.5, 0.012, y + 0.5]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[1.001, 1.001]} />
          <meshStandardMaterial color="#5cb8f2" emissive="#2f7fc0" emissiveIntensity={0.15} />
        </mesh>
      ))}
      {groups.bridge.map(([x, y]) => (
        <Bridge key={`b${x},${y}`} x={x} y={y} alongX={fixed.get(`${x - 1},${y}`)?.kind !== 'water' && fixed.get(`${x + 1},${y}`)?.kind !== 'water'} />
      ))}
      {groups.rects.map((f, i) =>
        f.kind === 'house' ? (
          <House key={i} f={f} onClick={onHouse} />
        ) : f.kind === 'hill' ? (
          <Hill key={i} f={f} />
        ) : f.kind === 'grove' ? (
          <Grove key={i} f={f} />
        ) : null,
      )}
    </group>
  );
}

function Bridge({ x, y, alongX }: { x: number; y: number; alongX: boolean }) {
  const obj = useModel('bridge_wood');
  return <primitive object={obj} position={[x + 0.5, -0.02, y + 0.5]} rotation-y={alongX ? Math.PI / 2 : 0} scale={1} />;
}

/** Kendi evin: tıklayınca karakter kapıya yürür, içeri girer */
function House({ f, onClick }: { f: FixedTile; onClick: () => void }) {
  const w = f.w ?? 1;
  const d = f.h ?? 1;
  const roof = useMemo(() => {
    const s = new Shape();
    s.moveTo(-d / 2 - 0.25, 0);
    s.lineTo(0, 1.2);
    s.lineTo(d / 2 + 0.25, 0);
    s.lineTo(-d / 2 - 0.25, 0);
    const g = new ExtrudeGeometry(s, { depth: w + 0.4, bevelEnabled: false });
    g.translate(0, 0, -(w + 0.4) / 2);
    return g;
  }, [w, d]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    onClick();
  };
  const door = CFG.world.garden.fixed.find((x) => x.kind === 'door')!;
  return (
    <group position={[f.x + w / 2, 0, f.y + d / 2]} onClick={click}>
      <mesh position={[0, 0.95, 0]} castShadow receiveShadow>
        <boxGeometry args={[w - 0.2, 1.9, d - 0.2]} />
        <meshStandardMaterial color="#fff1d6" />
      </mesh>
      <mesh geometry={roof} position={[0, 1.9, 0]} rotation-y={Math.PI / 2} castShadow>
        <meshStandardMaterial color="#e86b5a" flatShading />
      </mesh>
      <mesh position={[w / 2 - 0.9, 2.7, -0.4]} castShadow>
        <boxGeometry args={[0.35, 0.8, 0.35]} />
        <meshStandardMaterial color="#b0563f" />
      </mesh>
      {/* Kapı (öndeki karonun hizasında) ve pencereler */}
      <mesh position={[door.x + 0.5 - (f.x + w / 2), 0.62, d / 2 - 0.09]}>
        <boxGeometry args={[0.7, 1.24, 0.06]} />
        <meshStandardMaterial color="#a8693f" />
      </mesh>
      {[-0.3, 1.2].map((dx) => (
        <mesh key={dx} position={[dx, 1.15, d / 2 - 0.09]}>
          <boxGeometry args={[0.55, 0.5, 0.05]} />
          <meshStandardMaterial color="#a8dcff" emissive="#ffe7a3" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function Hill({ f }: { f: FixedTile }) {
  const w = f.w ?? 1;
  const d = f.h ?? 1;
  return (
    <group position={[f.x + w / 2, 0, f.y + d / 2]}>
      <mesh position={[0, 0.45, 0]} scale={[w / 2, 1, d / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[0.75, 1, 0.9, 9]} />
        <meshStandardMaterial color="#6fbf55" flatShading />
      </mesh>
      <mesh position={[0, 1.1, 0]} scale={[w / 3, 1, d / 3]} castShadow>
        <cylinderGeometry args={[0.6, 0.95, 0.5, 9]} />
        <meshStandardMaterial color="#7fcf62" flatShading />
      </mesh>
    </group>
  );
}

function GroveTree({ x, z }: { x: number; z: number }) {
  const obj = useModel('tree_plateau', { leaf: '#b47cff', glow: true });
  return <primitive object={obj} position={[x, 0, z]} scale={1.4} />;
}

function Grove({ f }: { f: FixedTile }) {
  const w = f.w ?? 1;
  const d = f.h ?? 1;
  return (
    <group>
      {[
        [0.6, 0.6],
        [w - 0.6, 0.8],
        [w / 2, d / 2],
        [0.8, d - 0.6],
        [w - 0.5, d - 0.5],
      ].map(([x, z], i) => (
        <GroveTree key={i} x={f.x + x} z={f.y + z} />
      ))}
      <pointLight position={[f.x + w / 2, 1.5, f.y + d / 2]} color="#c9a6ff" intensity={4} distance={5} />
    </group>
  );
}

// ---------- Ağaçlar ----------
interface TreeSpot {
  t: WorldTree;
  x: number;
  y: number;
  rot: number;
  s: number;
}

function Trees({ map, growId, onTree }: { map: OutdoorMap; growId: string | null; onTree: OutdoorProps['onTree'] }) {
  const byKind = useMemo(() => {
    const out = new Map<string, TreeSpot[]>();
    for (const r of map.regions) {
      for (const t of r.trees) {
        const s = r.spots.get(t.id);
        if (!s || t.id === growId) continue;
        const rand = rng(`gorunus:${t.id}`);
        if (!out.has(t.kind)) out.set(t.kind, []);
        out.get(t.kind)!.push({ t, x: r.ox + s.x, y: r.oy + s.y, rot: rand() * Math.PI * 2, s: 0.9 + rand() * 0.2 });
      }
    }
    return out;
  }, [map, growId]);
  return (
    <group>
      {[...byKind].map(([kind, spots]) => (
        <InstancedKind key={kind} kind={kind} spots={spots} onTree={onTree} />
      ))}
    </group>
  );
}

/** Bir türün bütün ağaçları: modelin her parçası için tek InstancedMesh */
function InstancedKind({ kind, spots, onTree }: { kind: string; spots: TreeSpot[]; onTree: OutdoorProps['onTree'] }) {
  const look = TREE_LOOK[kind] ?? TREE_LOOK.genc;
  const obj = useModel(look.model, look.colors);
  const parts = useMemo(() => {
    obj.updateMatrixWorld(true);
    const out: { geometry: BufferGeometry; material: Material | Material[]; matrix: Matrix4 }[] = [];
    obj.traverse((o) => {
      if (o instanceof Mesh) out.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
    });
    return out;
  }, [obj]);
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const o = new Object3D();
    const m = new Matrix4();
    parts.forEach((p, j) => {
      const im = refs.current[j];
      if (!im) return;
      spots.forEach((s, i) => {
        o.position.set(s.x + 0.5, 0, s.y + 0.5);
        o.rotation.set(0, s.rot, 0);
        o.scale.setScalar(look.scale * s.s);
        o.updateMatrix();
        im.setMatrixAt(i, m.multiplyMatrices(o.matrix, p.matrix));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    });
    invalidate();
  }, [parts, spots, look.scale, invalidate]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e) || e.instanceId == null) return;
    e.stopPropagation();
    const s = spots[e.instanceId];
    if (s) onTree(s.t, { x: s.x, y: s.y });
  };
  return (
    <group>
      {parts.map((p, j) => (
        <instancedMesh
          key={j}
          ref={(r) => {
            refs.current[j] = r;
          }}
          args={[p.geometry, p.material, spots.length]}
          castShadow
          receiveShadow
          onClick={click}
        />
      ))}
    </group>
  );
}

/** Yeni ağaç: 0 → 1 elastik büyüme ve yaprak parçacıkları (bir kez) */
function Growing({ map, id, onDone }: { map: OutdoorMap; id: string; onDone: () => void }) {
  const spot = useMemo(() => {
    for (const r of map.regions) {
      const s = r.spots.get(id);
      const t = r.trees.find((x) => x.id === id);
      if (s && t) return { t, x: r.ox + s.x + 0.5, z: r.oy + s.y + 0.5 };
    }
    return null;
  }, [map, id]);
  const look = TREE_LOOK[spot?.t.kind ?? 'genc'] ?? TREE_LOOK.genc;
  const obj = useModel(look.model, look.colors);
  const group = useRef<Group>(null);
  const leaves = useRef<Group>(null);
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const bits = useMemo(() => {
    const r = rng(`yaprak:${id}`);
    return Array.from({ length: 16 }, () => ({ a: r() * Math.PI * 2, v: 0.8 + r() * 1.2, up: 1.5 + r() * 2 }));
  }, [id]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame(({ clock }) => {
    if (!group.current || done.current) return;
    if (start.current == null) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    const p = Math.min(1, t / 1.3);
    // Elastik: biraz taşar, yerine oturur
    const e = p === 1 ? 1 : 1 - Math.pow(2, -9 * p) * Math.cos(p * Math.PI * 4.5);
    group.current.scale.setScalar(look.scale * Math.max(0.001, e));
    leaves.current?.children.forEach((c, i) => {
      const b = bits[i];
      c.position.set(Math.cos(b.a) * b.v * t, 0.4 + b.up * t - 2.4 * t * t, Math.sin(b.a) * b.v * t);
      c.scale.setScalar(Math.max(0, 1 - t / 1.4) * 0.09);
    });
    if (t > 1.5) {
      done.current = true;
      onDone();
    }
    invalidate();
  });
  if (!spot) return null;
  return (
    <group position={[spot.x, 0, spot.z]}>
      <group ref={group} scale={0.001}>
        <primitive object={obj} />
      </group>
      <group ref={leaves}>
        {bits.map((_, i) => (
          <mesh key={i}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i % 3 ? '#7fd36a' : '#ffd54a'} emissive="#ffe08a" emissiveIntensity={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------- Canlılar ----------
/** Canlılar "kıpırdama anlarında" hareket eder; sahne boşken kare çizilmez (frameloop="demand") */
let ambientUntil = 0;

function Creatures({ list, map }: { list: typeof CFG.world.creatures; map: OutdoorMap }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!list.length) return;
    const wake = () => {
      ambientUntil = performance.now() + 2600;
      invalidate();
    };
    wake();
    const id = setInterval(wake, 7000);
    return () => clearInterval(id);
  }, [list.length, invalidate]);
  const area = useMemo(() => {
    const r = map.regions[0];
    // Bahçe ve bu ayın bölgesi
    return { x0: 0.6, x1: (r ? r.ox + r.size : map.garden.w) - 0.6, y0: CFG.world.garden.pathRow + 1.2, y1: map.garden.h - 0.6 };
  }, [map]);
  return (
    <group>
      {list.map((c, i) =>
        c.model ? (
          <Critter key={c.id} model={c.model} fly={!!c.fly} seed={`${c.id}:${i}`} area={area} />
        ) : c.id === 'kelebek' ? (
          [0, 1, 2].map((k) => <Butterfly key={`${c.id}${k}`} seed={`kelebek${k}`} area={area} />)
        ) : (
          [0, 1].map((k) => <Bird key={`${c.id}${k}`} seed={`kus${k}`} area={area} />)
        ),
      )}
    </group>
  );
}

type Area = { x0: number; x1: number; y0: number; y1: number };

function useWander(seed: string, area: Area) {
  const r = useMemo(() => rng(seed), [seed]);
  const pos = useRef({ x: area.x0 + r() * (area.x1 - area.x0), z: area.y0 + r() * (area.y1 - area.y0), tx: 0, tz: 0, face: 0 });
  useEffect(() => {
    pos.current.tx = pos.current.x;
    pos.current.tz = pos.current.z;
  }, []);
  const invalidate = useThree((s) => s.invalidate);
  return (dt: number) => {
    const p = pos.current;
    const active = performance.now() < ambientUntil;
    if (!active) return { p, moving: false };
    if (Math.hypot(p.tx - p.x, p.tz - p.z) < 0.1) {
      p.tx = Math.min(area.x1, Math.max(area.x0, p.x + (r() - 0.5) * 3));
      p.tz = Math.min(area.y1, Math.max(area.y0, p.z + (r() - 0.5) * 3));
    }
    const dx = p.tx - p.x;
    const dz = p.tz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, dt * 1.1);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    p.face = Math.atan2(dx, dz);
    invalidate();
    return { p, moving: true };
  };
}

function Critter({ model, fly, seed, area }: { model: string; fly: boolean; seed: string; area: Area }) {
  const { scene, animations } = useGLTF(modelUrl(model));
  const obj = useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse((c) => (c.castShadow = true));
    return o;
  }, [scene]);
  const group = useRef<Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const [anim, setAnim] = useState<string | null>(null);
  const step = useWander(seed, area);
  useEffect(() => {
    const walk = names.find((n) => /walk|run|fly/i.test(n)) ?? names[0];
    const idle = names.find((n) => /idle/i.test(n)) ?? names[0];
    const a = actions[anim === 'move' ? walk : idle];
    a?.reset().fadeIn(0.2).play();
    return () => {
      a?.fadeOut(0.2);
    };
  }, [anim, actions, names]);
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const { p, moving } = step(Math.min(dt, 0.05));
    if ((moving ? 'move' : 'idle') !== anim) setAnim(moving ? 'move' : 'idle');
    g.position.set(p.x, fly ? 0.9 + Math.sin(clock.elapsedTime * 3) * 0.12 : 0, p.z);
    g.rotation.y = p.face;
  });
  return (
    <group ref={group} scale={fly ? 0.3 : 0.42}>
      <primitive object={obj} />
    </group>
  );
}

function Butterfly({ seed, area }: { seed: string; area: Area }) {
  const group = useRef<Group>(null);
  const wingL = useRef<Mesh>(null);
  const wingR = useRef<Mesh>(null);
  const step = useWander(seed, area);
  const color = useMemo(() => new Color(['#ff9ecb', '#ffd54a', '#9ad0ff'][Math.floor(rng(seed)() * 3)]), [seed]);
  useFrame(({ clock }, dt) => {
    const { p, moving } = step(Math.min(dt, 0.05));
    const g = group.current;
    if (!g) return;
    g.position.set(p.x, 0.8 + Math.sin(clock.elapsedTime * 2 + p.x) * 0.25, p.z);
    g.rotation.y = p.face;
    const flap = moving ? Math.sin(clock.elapsedTime * 22) * 0.9 : 0.4;
    if (wingL.current) wingL.current.rotation.z = flap;
    if (wingR.current) wingR.current.rotation.z = -flap;
  });
  return (
    <group ref={group}>
      <mesh ref={wingL} position={[0.05, 0, 0]}>
        <planeGeometry args={[0.12, 0.09]} />
        <meshStandardMaterial color={color} side={2} />
      </mesh>
      <mesh ref={wingR} position={[-0.05, 0, 0]}>
        <planeGeometry args={[0.12, 0.09]} />
        <meshStandardMaterial color={color} side={2} />
      </mesh>
    </group>
  );
}

function Bird({ seed, area }: { seed: string; area: Area }) {
  const group = useRef<Group>(null);
  const r = useMemo(() => rng(seed), [seed]);
  const c = useMemo(() => ({ x: area.x0 + r() * (area.x1 - area.x0), z: area.y0 + r() * (area.y1 - area.y0), rad: 2 + r() * 2, ph: r() * 6 }), [r, area]);
  const angle = useRef(c.ph);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (performance.now() < ambientUntil) {
      angle.current += Math.min(dt, 0.05) * 0.8;
      invalidate();
    }
    const a = angle.current;
    g.position.set(c.x + Math.cos(a) * c.rad, 2.6 + Math.sin(a * 2) * 0.2, c.z + Math.sin(a) * c.rad);
    g.rotation.y = -a;
  });
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#5a7dd8" />
      </mesh>
      <mesh position={[0, 0, 0.1]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.035, 0.08, 6]} />
        <meshStandardMaterial color="#ffb347" />
      </mesh>
      <mesh position={[0, 0.02, 0]} scale={[1, 0.15, 0.6]}>
        <boxGeometry args={[0.36, 0.05, 0.12]} />
        <meshStandardMaterial color="#7b98e8" />
      </mesh>
    </group>
  );
}
