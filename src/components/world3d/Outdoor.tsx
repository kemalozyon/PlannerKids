// Dış mekân sahneleri (hepsi tek dünyada yan yana, worldPlan.ts):
// - Terrain: dünyanın altındaki zemin ve çevresindeki manzara (aşamanın teması).
// - Yard: evin önündeki bahçe (dere, tepe, göl, koru, deniz; doğu kenarında orman yoluna kapı).
// - Trail: bahçe kapısından ay bahçelerine giden orman yolu.
// - MonthGarden: bir ayın ağaç bahçesi. Takvim düzeni: sütun haftanın günü, satır ayın haftası; çalışılan her
//   günün yerinde o günün ağacı (türü tarihten, büyüklüğü günün toplamından), çalışılmayan günde numaralı taş.
//   Günü gelmemiş ay kilitli görünür. Aynı türdeki ağaçlar tek çizimde (InstancedMesh) çizilir.
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Color, Matrix4, Mesh, Object3D, SRGBColorSpace, type BufferGeometry, type Group, type InstancedMesh, type Material } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CFG, type FixedTile, type MapDef, type SpeciesDef } from '../../lib/config';
import { formatMonth } from '../../lib/forest';
import { rng } from '../../lib/rng';
import { daysIn, plotOf, type DayTree } from '../../lib/world';
import { modelUrl, useModel } from '../forest3d/models';
import { isTap } from './light';

const MG = CFG.world.monthGarden;

// ---------- Ortak parçalar ----------
export function Ground({ x, y, w, h, color, side = '#8a6a43', low }: { x: number; y: number; w: number; h: number; color: string; side?: string; low?: boolean }) {
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
          <meshStandardMaterial color={side} />
        </mesh>
      )}
    </group>
  );
}

/** Tabela: tuvale çizilmiş yazı, her zaman kameraya dönük (DOM etiketi değil) */
export function Sign({ x, z, y = 1.9, text, scale = 1.2 }: { x: number; z: number; y?: number; text: string; scale?: number }) {
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
    <sprite position={[x, y, z]} scale={[scale * aspect * 0.5, scale * 0.5, 1]}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  );
}

const tap = (f: () => void) => (e: ThreeEvent<MouseEvent>) => {
  if (!isTap(e)) return;
  e.stopPropagation();
  f();
};

// ---------- Evin bahçesi ----------
export interface YardProps {
  map: MapDef;
  fixed: Map<string, FixedTile>;
  onGate: () => void;
  /** Tabelalar (gezintide kapalı: kameranın önüne düşer) */
  labels?: boolean;
}

export function Yard({ map, fixed, onGate, labels = true }: YardProps) {
  const { w, h } = map.garden;
  const th = map.theme;
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
    return { water: [...water, ...bridge], bridge, rects };
  }, [fixed]);
  return (
    <group>
      <Ground x={0} y={0} w={w} h={h} color={th.ground} side={th.side} low />
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
        f.kind === 'hill' ? (
          <Hill key={i} f={f} />
        ) : f.kind === 'grove' ? (
          <Grove key={i} f={f} />
        ) : f.kind === 'gate' ? (
          <Gate key={i} x={f.x} y={f.y} side onClick={onGate} label={labels ? '🌳 Ağaç bahçeleri' : null} />
        ) : f.kind === 'door' ? (
          <mesh key={i} position={[f.x + 0.5, 0.015, f.y + 0.5]} rotation-x={-Math.PI / 2} receiveShadow>
            <planeGeometry args={[0.9, 0.9]} />
            <meshStandardMaterial color="#d9b27a" />
          </mesh>
        ) : null,
      )}
    </group>
  );
}

function Bridge({ x, y, alongX }: { x: number; y: number; alongX: boolean }) {
  const obj = useModel('bridge_wood');
  return <primitive object={obj} position={[x + 0.5, -0.02, y + 0.5]} rotation-y={alongX ? Math.PI / 2 : 0} scale={1} />;
}

/** Ağaç bahçelerine (ya da eve) götüren kemerli kapı */
export function Gate({ x, y, side, onClick, label }: { x: number; y: number; side?: boolean; onClick: () => void; label: string | null }) {
  return (
    <group position={[x + 0.5, 0, y + 0.5]} rotation-y={side ? Math.PI / 2 : 0} onClick={tap(onClick)}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.45, 0.7, 0]} castShadow>
          <boxGeometry args={[0.12, 1.4, 0.12]} />
          <meshStandardMaterial color="#8a5a2a" />
        </mesh>
      ))}
      <mesh position={[0, 1.45, 0]} castShadow>
        <boxGeometry args={[1.15, 0.14, 0.16]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      {[-0.3, 0, 0.3].map((dx) => (
        <mesh key={dx} position={[dx, 1.55, 0]}>
          <icosahedronGeometry args={[0.13, 0]} />
          <meshStandardMaterial color="#5fae4f" flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshStandardMaterial color="#d9b27a" />
      </mesh>
      {label && <Sign x={0} z={0} y={2} text={label} scale={1} />}
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

// ---------- Arazi ve manzara (yalnızca görüntü, yürünmez) ----------
/** Bütün dünyanın altındaki zemin ve çevresindeki manzara; w × h dünyanın ölçüsü */
export function Terrain({ map, w, h }: { map: MapDef; w: number; h: number }) {
  const kind = map.theme.scenery;
  const ring = useMemo(() => {
    // Dünyanın çevresinde 2–8 karo uzaklıkta rastgele ama sabit noktalar (ön kameraya dönük kenar seyrek)
    const r = rng(`manzara:${map.id}:${w}x${h}`);
    const out: { x: number; z: number; s: number; rot: number }[] = [];
    const n = Math.round((w + h) * 1.1);
    for (let i = 0; i < n; i++) {
      const side = Math.floor(r() * 4);
      const off = 1.5 + r() * 6.5;
      const along = r();
      const p =
        side === 0
          ? { x: -3 + along * (w + 6), z: -off }
          : side === 1
            ? { x: -off, z: along * h }
            : side === 2
              ? { x: w + off, z: along * h }
              : { x: along * w, z: h + off + 2 };
      if (side === 3 && r() < 0.6) continue;
      out.push({ ...p, s: 0.8 + r() * 0.7, rot: r() * Math.PI * 2 });
    }
    return out;
  }, [map.id, w, h]);
  const groundColor = kind === 'beach' ? '#ecd9a0' : kind === 'mountain' ? '#9fc58a' : new Color(map.theme.ground).multiplyScalar(0.9).getStyle();
  return (
    <group>
      <mesh position={[w / 2, -0.03, h / 2]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w + 160, h + 160]} />
        <meshStandardMaterial color={groundColor} />
      </mesh>
      {kind === 'lake' && (
        <mesh position={[-9, -0.01, h / 2]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[7, 24]} />
          <meshStandardMaterial color="#5cb8f2" emissive="#2f7fc0" emissiveIntensity={0.2} />
        </mesh>
      )}
      {kind === 'beach' && (
        <mesh position={[w / 2, -0.01, h + 12]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w + 60, 16]} />
          <meshStandardMaterial color="#3fa6e0" emissive="#1d6fa8" emissiveIntensity={0.25} />
        </mesh>
      )}
      {kind === 'mountain' &&
        [
          [-6, -9, 7],
          [8, -11, 9],
          [w * 0.45, -10, 8],
          [w * 0.75, -13, 11],
          [w + 4, -8, 7],
        ].map(([x, z, s], i) => (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, s / 2, 0]} castShadow>
              <coneGeometry args={[s * 0.7, s, 6]} />
              <meshStandardMaterial color="#7d8a99" flatShading />
            </mesh>
            <mesh position={[0, s * 0.82, 0]}>
              <coneGeometry args={[s * 0.26, s * 0.37, 6]} />
              <meshStandardMaterial color="#ffffff" flatShading />
            </mesh>
          </group>
        ))}
      <SceneryTrees spots={ring} kind={kind} />
    </group>
  );
}

// ---------- Orman yolu ----------
/** Bahçe kapısından ay bahçelerine giden toprak yol; kenarlarında seyrek çalılar */
export function Trail({ rects, seed }: { rects: { x: number; y: number; w: number; h: number }[]; seed: string }) {
  const bushes = useMemo(() => {
    const r = rng(`yol:${seed}`);
    const out: { x: number; z: number; rot: number; s: number }[] = [];
    for (const q of rects) {
      const along = q.w >= q.h;
      const n = Math.floor((along ? q.w : q.h) / 3);
      for (let i = 0; i < n; i++) {
        if (r() < 0.45) continue;
        const t = (i + 0.5) * 3;
        out.push(along ? { x: q.x + t, z: q.y + q.h + 0.25, rot: r() * 6, s: 0.6 + r() * 0.4 } : { x: q.x - 0.25, z: q.y + t, rot: r() * 6, s: 0.6 + r() * 0.4 });
      }
    }
    return out;
  }, [rects, seed]);
  return (
    <group>
      {rects.map((q, i) => (
        <mesh key={i} position={[q.x + q.w / 2, 0.006 + i * 0.001, q.y + q.h / 2]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[q.w, q.h]} />
          <meshStandardMaterial color="#d9b27a" />
        </mesh>
      ))}
      <InstancedModel model="plant_bush" colors={{ leaf: '#5fb85a' }} items={bushes} />
    </group>
  );
}

const SCENERY_TREE: Record<MapDef['theme']['scenery'], { model: string; leaf: string; extra?: { model: string; leaf: string } }> = {
  meadow: { model: 'tree_default', leaf: '#6cc24a', extra: { model: 'plant_bushLarge', leaf: '#5fb85a' } },
  lake: { model: 'tree_oak', leaf: '#4fae4c', extra: { model: 'tree_tall', leaf: '#9ccc65' } },
  forest: { model: 'tree_pineRoundA', leaf: '#2f9d63', extra: { model: 'tree_pineTallA_detailed', leaf: '#2d8a57' } },
  mountain: { model: 'tree_pineDefaultA', leaf: '#2e7d4f', extra: { model: 'rock_tallA', leaf: '#888888' } },
  beach: { model: 'tree_palmTall', leaf: '#5fbf4a', extra: { model: 'rock_largeA', leaf: '#999999' } },
};

function SceneryTrees({ spots, kind }: { spots: { x: number; z: number; s: number; rot: number }[]; kind: MapDef['theme']['scenery'] }) {
  const look = SCENERY_TREE[kind];
  const a = spots.filter((_, i) => i % 3);
  const b = spots.filter((_, i) => !(i % 3));
  return (
    <group>
      <InstancedModel model={look.model} colors={{ leaf: look.leaf }} items={a.map((s) => ({ x: s.x, z: s.z, rot: s.rot, s: s.s * 1.5 }))} />
      {look.extra && <InstancedModel model={look.extra.model} colors={{ leaf: look.extra.leaf }} items={b.map((s) => ({ x: s.x, z: s.z, rot: s.rot, s: s.s * 1.3 }))} />}
    </group>
  );
}

// ---------- Aylık ağaç bahçesi ----------
export interface MonthGardenProps {
  month: string;
  trees: DayTree[];
  locked: boolean;
  today: string;
  /** Bir kez büyüme animasyonu oynatılacak ağaç (gün) */
  growId: string | null;
  onGrown: () => void;
  onTree: (t: DayTree, tile: { x: number; y: number }) => void;
  onGate: () => void;
  labels?: boolean;
  /** Uzaktayken yalnızca zemin, çit ve ağaçlar çizilir (taşlar, tabela yok) */
  detail?: boolean;
}

export function MonthGarden({ month, trees, locked, today, growId, onGrown, onTree, onGate, labels = true, detail = true }: MonthGardenProps) {
  const n = daysIn(month);
  const byDay = useMemo(() => new Map(trees.map((t) => [Number(t.date.slice(8, 10)), t])), [trees]);
  const todayDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : 0;
  const ground = locked ? '#a9b8a0' : '#7ccf5a';
  return (
    <group>
      <Ground x={0} y={0} w={MG.w} h={MG.h} color={ground} low />
      <Fence />
      {/* Ekim yerleri ve gün taşları */}
      {detail && Array.from({ length: n }, (_, i) => {
        const day = i + 1;
        const t = plotOf(month, day);
        const tree = byDay.get(day);
        return (
          <group key={day} position={[t.x + 0.5, 0, t.y + 0.5]}>
            <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} receiveShadow>
              <circleGeometry args={[0.42, 10]} />
              <meshStandardMaterial color={tree ? '#8a5a3a' : '#a07a55'} />
            </mesh>
            {!tree && !locked && <DayStone day={day} />}
            {day === todayDay && (
              <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
                <ringGeometry args={[0.44, 0.5, 20]} />
                <meshBasicMaterial color="#ffd23f" />
              </mesh>
            )}
            {tree?.flowers && <Flowers seed={tree.id} />}
          </group>
        );
      })}
      {!locked && <DayTrees month={month} trees={trees.filter((t) => t.id !== growId)} onTree={onTree} />}
      {!locked && growId && byDay.get(Number(growId.slice(8, 10))) && (
        <Growing tree={byDay.get(Number(growId.slice(8, 10)))!} month={month} onDone={onGrown} />
      )}
      <Gate x={MG.gate.x} y={MG.gate.y} onClick={onGate} label={null} />
      {labels && detail && <Sign x={MG.w / 2} z={MG.h + 0.4} y={1.3} text={`🌳 ${formatMonth(month)}${locked ? ' · 🔒' : ` · ${trees.filter((t) => !t.dry).length} ağaç`}`} scale={1.6} />}
      {locked && <LockedFog />}
    </group>
  );
}

function Fence() {
  const posts = useMemo(() => {
    const out: { x: number; z: number; rot: number }[] = [];
    for (let x = 0; x < MG.w; x++) {
      out.push({ x: x + 0.5, z: 0.05, rot: 0 });
      if (Math.abs(x - MG.gate.x) > 0) out.push({ x: x + 0.5, z: MG.h - 0.05, rot: 0 });
    }
    for (let y = 0; y < MG.h; y++) {
      out.push({ x: 0.05, z: y + 0.5, rot: Math.PI / 2 });
      out.push({ x: MG.w - 0.05, z: y + 0.5, rot: Math.PI / 2 });
    }
    return out;
  }, []);
  return <InstancedModel model="fence_simple" items={posts.map((p) => ({ ...p, s: 1 }))} />;
}

const stoneTex = new Map<number, CanvasTexture>();
function dayTexture(day: number) {
  let t = stoneTex.get(day);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d8d2c4';
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6b5a45';
    g.font = '800 30px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(day), 32, 34);
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    stoneTex.set(day, t);
  }
  return t;
}

/** Çalışılmamış günün taşı: gün numarası */
function DayStone({ day }: { day: number }) {
  const map = useMemo(() => dayTexture(day), [day]);
  return (
    <mesh position={[0, 0.05, 0]} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[0.2, 14]} />
      <meshStandardMaterial map={map} />
    </mesh>
  );
}

function Flowers({ seed }: { seed: string }) {
  const bits = useMemo(() => {
    const r = rng(`cicek:${seed}`);
    return Array.from({ length: 6 }, () => ({ a: r() * Math.PI * 2, d: 0.25 + r() * 0.12, c: ['#ff8ac2', '#ffd166', '#ffffff', '#b388ff'][Math.floor(r() * 4)] }));
  }, [seed]);
  return (
    <group>
      {bits.map((b, i) => (
        <mesh key={i} position={[Math.cos(b.a) * b.d, 0.06, Math.sin(b.a) * b.d]}>
          <icosahedronGeometry args={[0.045, 0]} />
          <meshStandardMaterial color={b.c} />
        </mesh>
      ))}
    </group>
  );
}

function LockedFog() {
  return (
    <group>
      <mesh position={[MG.w / 2, 1.2, MG.h / 2]}>
        <boxGeometry args={[MG.w + 0.2, 2.4, MG.h + 0.2]} />
        <meshStandardMaterial color="#e8eef2" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <group position={[MG.w / 2, 1.6, MG.h / 2]}>
        <mesh position={[0, 0.35, 0]}>
          <torusGeometry args={[0.35, 0.1, 8, 16, Math.PI]} />
          <meshStandardMaterial color="#9aa5b1" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh>
          <boxGeometry args={[1, 0.8, 0.3]} />
          <meshStandardMaterial color="#f2c230" metalness={0.4} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

// ---------- Ağaçlar ----------
interface TreeSpot {
  t: DayTree;
  x: number;
  y: number;
  rot: number;
  s: number;
}

const treeKey = (s: Pick<SpeciesDef, 'id'>, glow: boolean) => `${s.id}${glow ? ':isilti' : ''}`;

function DayTrees({ month, trees, onTree }: { month: string; trees: DayTree[]; onTree: MonthGardenProps['onTree'] }) {
  const byKind = useMemo(() => {
    const out = new Map<string, { species: SpeciesDef; glow: boolean; spots: TreeSpot[] }>();
    for (const t of trees) {
      const tile = plotOf(month, Number(t.date.slice(8, 10)));
      const r = rng(`gorunus:${t.id}`);
      const k = treeKey(t.species, t.glow);
      if (!out.has(k)) out.set(k, { species: t.species, glow: t.glow, spots: [] });
      out.get(k)!.spots.push({ t, x: tile.x, y: tile.y, rot: r() * Math.PI * 2, s: (0.92 + r() * 0.16) * t.stage.scale });
    }
    return [...out.values()];
  }, [month, trees]);
  return (
    <group>
      {byKind.map((g) => (
        <InstancedTrees key={treeKey(g.species, g.glow)} species={g.species} glow={g.glow} spots={g.spots} onTree={onTree} />
      ))}
      {/* Dokunma alanı: ince gövdeyi tutturmak zor, ağacın bütün karosu dokunulur */}
      {byKind.flatMap((g) =>
        g.spots.map((s) => (
          <mesh
            key={s.t.id}
            position={[s.x + 0.5, 0.6 * Math.max(0.6, s.s), s.y + 0.5]}
            onClick={tap(() => onTree(s.t, { x: s.x, y: s.y }))}
          >
            <cylinderGeometry args={[0.45, 0.45, 1.2 * Math.max(0.6, s.s), 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Bir modelin parçaları: her parça için bir InstancedMesh */
function useParts(model: string, colors: Parameters<typeof useModel>[1]) {
  const obj = useModel(model, colors);
  return useMemo(() => {
    obj.updateMatrixWorld(true);
    const out: { geometry: BufferGeometry; material: Material | Material[]; matrix: Matrix4 }[] = [];
    obj.traverse((o) => {
      if (o instanceof Mesh) out.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
    });
    return out;
  }, [obj]);
}

function InstancedModel({
  model,
  colors = {},
  items,
  onPick,
}: {
  model: string;
  colors?: Parameters<typeof useModel>[1];
  items: { x: number; z: number; rot: number; s: number }[];
  onPick?: (i: number) => void;
}) {
  const parts = useParts(model, colors);
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const o = new Object3D();
    const m = new Matrix4();
    parts.forEach((p, j) => {
      const im = refs.current[j];
      if (!im) return;
      items.forEach((s, i) => {
        o.position.set(s.x, 0, s.z);
        o.rotation.set(0, s.rot, 0);
        o.scale.setScalar(s.s);
        o.updateMatrix();
        im.setMatrixAt(i, m.multiplyMatrices(o.matrix, p.matrix));
      });
      im.count = items.length;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    });
    invalidate();
  }, [parts, items, invalidate]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || !isTap(e) || e.instanceId == null) return;
    e.stopPropagation();
    onPick(e.instanceId);
  };
  if (!items.length) return null;
  return (
    <group>
      {parts.map((p, j) => (
        <instancedMesh
          key={`${j}:${items.length}`}
          ref={(r) => {
            refs.current[j] = r;
          }}
          args={[p.geometry, p.material, items.length]}
          castShadow
          receiveShadow
          onClick={click}
        />
      ))}
    </group>
  );
}

/** Ağaç boyu: modelin ~1.3 birim olduğu varsayılır, evreye göre 0.45–1.3 kat (üstüne 1.4 genel büyütme) */
const TREE_SCALE = 1.45;

function InstancedTrees({ species, glow, spots, onTree }: { species: SpeciesDef; glow: boolean; spots: TreeSpot[]; onTree: MonthGardenProps['onTree'] }) {
  const items = useMemo(() => spots.map((s) => ({ x: s.x + 0.5, z: s.y + 0.5, rot: s.rot, s: s.s * TREE_SCALE })), [spots]);
  const fruit = species.fruit ? spots.filter((s) => s.t.stageIndex >= 2) : [];
  return (
    <group>
      <InstancedModel
        model={species.model}
        colors={{ leaf: species.leaf, wood: species.wood, glow }}
        items={items}
        onPick={(i) => onTree(spots[i].t, { x: spots[i].x, y: spots[i].y })}
      />
      {fruit.length > 0 && <Fruit spots={fruit} color={species.fruit!} />}
    </group>
  );
}

/** Meyve ağaçlarında taçta birkaç meyve */
function Fruit({ spots, color }: { spots: TreeSpot[]; color: string }) {
  const ref = useRef<InstancedMesh>(null);
  const per = 5;
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    spots.forEach((s, i) => {
      const r = rng(`meyve:${s.t.id}`);
      for (let k = 0; k < per; k++) {
        const a = r() * Math.PI * 2;
        const sc = s.s * TREE_SCALE;
        o.position.set(s.x + 0.5 + Math.cos(a) * 0.3 * sc, (0.7 + r() * 0.35) * sc, s.y + 0.5 + Math.sin(a) * 0.3 * sc);
        o.scale.setScalar(0.06 * Math.max(0.8, sc));
        o.updateMatrix();
        m.setMatrixAt(i * per + k, o.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh key={spots.length} ref={ref} args={[undefined, undefined, spots.length * per]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={color} flatShading />
    </instancedMesh>
  );
}

/** Yeni ağaç (ya da büyüyen ağaç): 0 → 1 elastik büyüme ve yaprak parçacıkları (bir kez) */
function Growing({ tree, month, onDone }: { tree: DayTree; month: string; onDone: () => void }) {
  const tile = plotOf(month, Number(tree.date.slice(8, 10)));
  const obj = useModel(tree.species.model, { leaf: tree.species.leaf, wood: tree.species.wood, glow: tree.glow });
  const scale = tree.stage.scale * TREE_SCALE;
  const group = useRef<Group>(null);
  const leaves = useRef<Group>(null);
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const bits = useMemo(() => {
    const r = rng(`yaprak:${tree.id}`);
    return Array.from({ length: 16 }, () => ({ a: r() * Math.PI * 2, v: 0.8 + r() * 1.2, up: 1.5 + r() * 2 }));
  }, [tree.id]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame(({ clock }) => {
    if (!group.current) return;
    if (start.current == null) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    if (done.current) return;
    const p = Math.min(1, t / 1.3);
    const e = p === 1 ? 1 : 1 - Math.pow(2, -9 * p) * Math.cos(p * Math.PI * 4.5);
    group.current.scale.setScalar(scale * Math.max(0.001, e));
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
  return (
    <group position={[tile.x + 0.5, 0, tile.y + 0.5]}>
      <group ref={group} scale={0.001}>
        <primitive object={obj} />
      </group>
      <group ref={leaves}>
        {bits.map((_, i) => (
          <mesh key={i}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i % 3 ? tree.species.leaf : '#ffd54a'} emissive="#ffe08a" emissiveIntensity={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------- Canlılar ----------
/** Canlılar "kıpırdama anlarında" hareket eder; sahne boşken kare çizilmez (frameloop="demand") */
let ambientUntil = 0;

export type Area = { x0: number; x1: number; y0: number; y1: number };

/** Canlılar; `attract` verilirse (bugün mama konan kap, yatak) onun çevresinde dolaşırlar */
export function Creatures({ list, area: all, attract }: { list: typeof CFG.world.creatures; area: Area; attract?: { x: number; z: number } | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const R = 1.6;
  const area = attract
    ? { x0: Math.max(all.x0, attract.x - R), x1: Math.min(all.x1, attract.x + R), y0: Math.max(all.y0, attract.z - R), y1: Math.min(all.y1, attract.z + R) }
    : all;
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
