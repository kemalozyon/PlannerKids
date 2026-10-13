// Odaya ve bahçeye yerleştirilen eşyaların 3D modeli. Model karo ayak izinin ortasına oturtulur ve
// items.json'daki ölçekle büyütülür; kumaş/lamba renkleri `tint` ile boyanır, `glow` malzemesi ışık saçar.
// Yerleştirme modunda aynı model yarı saydam yeşil (konabilir) ya da kırmızı (konamaz) önizleme olur.
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, Vector3, type Material } from 'three';
import type { Item } from '../../lib/catalog';
import { footSize } from '../../lib/world';
import { modelUrl } from '../forest3d/models';

/** Model + boya için hazırlanmış şablon ve ayak izine oturtma bilgisi (bir kez hesaplanır) */
const templates = new Map<string, { obj: Object3D; center: Vector3; minY: number }>();

function paint(m: Material, item: Item): Material {
  if (!(m instanceof MeshStandardMaterial)) return m;
  const color = item.tint?.[m.name];
  const glow = item.glow === m.name;
  if (!color && !glow) return m;
  const out = m.clone();
  if (color) out.color = new Color(color);
  if (glow) {
    out.emissive = new Color(color ?? '#ffe7a3');
    out.emissiveIntensity = 0.9;
  }
  return out;
}

function useTemplate(item: Item) {
  const { scene } = useGLTF(modelUrl(item.model!));
  return useMemo(() => {
    let t = templates.get(item.id);
    if (!t) {
      const obj = scene.clone(true);
      obj.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.material = Array.isArray(o.material) ? o.material.map((m) => paint(m, item)) : paint(o.material, item);
        }
      });
      const box = new Box3().setFromObject(obj);
      t = { obj, center: box.getCenter(new Vector3()), minY: box.min.y };
      templates.set(item.id, t);
    }
    return t;
  }, [scene, item]);
}

const GHOST = {
  ok: new MeshStandardMaterial({ color: '#3fcf6b', transparent: true, opacity: 0.55, depthWrite: false }),
  bad: new MeshStandardMaterial({ color: '#ef4b4b', transparent: true, opacity: 0.55, depthWrite: false }),
};

/** Ayak izinin merkezi (alanın yerel koordinatında) */
export function footCenter(item: Item, x: number, y: number, rot: number): [number, number] {
  const [w, h] = footSize(item, rot);
  return [x + w / 2, y + h / 2];
}

export function ItemModel({
  item,
  x,
  y,
  rot,
  ghost,
  lift = 0,
  onPointerDown,
  onClick,
}: {
  item: Item;
  x: number;
  y: number;
  rot: number;
  /** Yerleştirme önizlemesi */
  ghost?: 'ok' | 'bad';
  /** Seçili eşya biraz havalanır */
  lift?: number;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const t = useTemplate(item);
  const obj = useMemo(() => {
    const o = t.obj.clone(true);
    if (ghost) {
      o.traverse((c) => {
        if (c instanceof Mesh) {
          c.material = GHOST[ghost];
          c.castShadow = false;
        }
      });
    }
    return o;
  }, [t, ghost]);
  const [cx, cz] = footCenter(item, x, y, rot);
  const s = item.scale ?? 1;
  return (
    <group position={[cx, lift, cz]} rotation-y={(-rot * Math.PI) / 180} onPointerDown={onPointerDown} onClick={onClick}>
      <primitive object={obj} scale={s} position={[-t.center.x * s, -t.minY * s + 0.01, -t.center.z * s]} />
    </group>
  );
}

/** Ayak izi karoları (yerleştirmede yeşil/kırmızı zemin) */
export function FootTiles({ item, x, y, rot, ok }: { item: Item; x: number; y: number; rot: number; ok: boolean }) {
  const [w, h] = footSize(item, rot);
  return (
    <mesh position={[x + w / 2, 0.02, y + h / 2]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[w - 0.06, h - 0.06]} />
      <meshBasicMaterial color={ok ? '#3fcf6b' : '#ef4b4b'} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

/** Yerleştirme modunda karo çizgileri */
export function GridLines({ w, h, ox = 0, oy = 0, color = '#ffffff' }: { w: number; h: number; ox?: number; oy?: number; color?: string }) {
  const positions = useMemo(() => {
    const p: number[] = [];
    for (let x = 0; x <= w; x++) p.push(ox + x, 0.03, oy, ox + x, 0.03, oy + h);
    for (let y = 0; y <= h; y++) p.push(ox, 0.03, oy + y, ox + w, 0.03, oy + y);
    return new Float32Array(p);
  }, [w, h, ox, oy]);
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={0.55} />
    </lineSegments>
  );
}
