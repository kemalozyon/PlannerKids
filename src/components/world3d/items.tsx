// Odaya, duvara ve bahçeye yerleştirilen eşyaların 3D görünüşü.
// - Model eşyalar (Kenney): karo ayak izinin ortasına oturtulur, items.json'daki ölçekle büyütülür; kumaş/lamba
//   renkleri `tint` ile boyanır, `glow` malzemesi ışık saçar.
// - Duvar eşyaları: arka duvarda (y = -1) ya da sol duvarda (x = -1), sırtı duvara yaslı.
// - Kodla çizilenler: posterler/tablolar (art), kitaplık, salıncak ve şömine (proc).
// - İşlevli eşyalar (use): ışık açıkken parlar (yakındakiler gerçek ışık saçar), ateş yanar, TV açıkken ekranda
//   çalışma istatistiği ya da bu ayın ormanı görünür.
// - Küçük eşya bir yüzeyin üstündeyse (masa, sehpa) o yüzeyin yüksekliğine kalkar (OnSurface).
// Yerleştirme modunda aynı görünüş yarı saydam yeşil (konabilir) ya da kırmızı (konamaz) önizleme olur.
import { useGLTF } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, Vector3, type Material, type Texture } from 'three';
import type { Item } from '../../lib/catalog';
import type { Book } from '../../lib/types';
import { footSize, wallSlots } from '../../lib/world';
import { modelUrl } from '../forest3d/models';
import { ART_HEIGHT, artTexture, clockTexture } from './art';
import { Bookcase } from './Books';
import { Fireplace, Flame, Swing } from './Proc';

/** Duvar eşyalarının orta yüksekliği */
const WALL_Y = 1.45;

/** Model + boya için hazırlanmış şablon ve ayak izine oturtma bilgisi (bir kez hesaplanır) */
const templates = new Map<string, { obj: Object3D; center: Vector3; minY: number; maxY: number; minZ: number; size: Vector3 }>();

function paint(m: Material, item: Item, on: boolean): Material {
  if (!(m instanceof MeshStandardMaterial)) return m;
  const color = item.tint?.[m.name];
  const glow = on && item.glow === m.name;
  if (!color && !glow) return m;
  const out = m.clone();
  if (color) out.color = new Color(color);
  if (glow) {
    out.emissive = new Color(color ?? '#ffe7a3');
    out.emissiveIntensity = 0.9;
  }
  return out;
}

/** Eşyanın şablonu; ışık kapalıyken parlamayan ayrı bir şablon */
function useTemplate(item: Item, on = true) {
  const { scene } = useGLTF(modelUrl(item.model!));
  return useMemo(() => {
    const k = `${item.id}:${on ? 1 : 0}`;
    let t = templates.get(k);
    if (!t) {
      const obj = scene.clone(true);
      obj.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.material = Array.isArray(o.material) ? o.material.map((m) => paint(m, item, on)) : paint(o.material, item, on);
        }
      });
      const box = new Box3().setFromObject(obj);
      t = { obj, center: box.getCenter(new Vector3()), minY: box.min.y, maxY: box.max.y, minZ: box.min.z, size: box.getSize(new Vector3()) };
      templates.set(k, t);
      // Yüzey yüksekliği (surfaceTop) ışık durumundan bağımsız
      if (!templates.has(item.id)) templates.set(item.id, t);
    }
    return t;
  }, [scene, item, on]);
}

const GHOST = {
  ok: new MeshStandardMaterial({ color: '#3fcf6b', transparent: true, opacity: 0.55, depthWrite: false }),
  bad: new MeshStandardMaterial({ color: '#ef4b4b', transparent: true, opacity: 0.55, depthWrite: false }),
};

const ghostify = (o: Object3D, ghost?: 'ok' | 'bad') => {
  if (!ghost) return o;
  o.traverse((c) => {
    if (c instanceof Mesh) {
      c.material = GHOST[ghost];
      c.castShadow = false;
    }
  });
  return o;
};

/** Ayak izinin merkezi (alanın yerel koordinatında) */
export function footCenter(item: Item, x: number, y: number, rot: number): [number, number] {
  const [w, h] = footSize(item, rot);
  return [x + w / 2, y + h / 2];
}

/** Bir yüzeyin (masa, sehpa…) üst yüksekliği */
export function surfaceTop(item: Item): number {
  if (item.proc === 'bookcase') return 1.7;
  const t = templates.get(item.id);
  return t ? (t.maxY - t.minY) * (item.scale ?? 1) : 0.6;
}

/** Yüzeyin şablonunu yükler, sonra çocuklarını yüzeyin üstüne kaldırır */
export function OnSurface({ support, children }: { support: Item; children: ReactNode }) {
  return support.model ? <SurfaceModel support={support}>{children}</SurfaceModel> : <group position-y={surfaceTop(support)}>{children}</group>;
}

function SurfaceModel({ support, children }: { support: Item; children: ReactNode }) {
  const t = useTemplate(support);
  return <group position-y={(t.maxY - t.minY) * (support.scale ?? 1) - 0.005}>{children}</group>;
}

export interface ItemModelProps {
  item: Item;
  x: number;
  y: number;
  rot: number;
  /** Yerleştirme önizlemesi */
  ghost?: 'ok' | 'bad';
  /** Seçili eşya biraz havalanır */
  lift?: number;
  /** Kitaplıktaki kitaplar */
  books?: Book[];
  onBook?: (b: Book) => void;
  /** Işık/TV/ateş açık mı (verilmezse lamba açık, TV ve ateş kapalı) */
  on?: boolean;
  /** Açık lamba gerçek bir ışık da saçsın (sahnede sınırlı sayıda) */
  lit?: boolean;
  /** Açık TV'nin ekranı */
  screen?: Texture | null;
  /** Salıncakta biri sallanıyor */
  active?: boolean;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export function ItemModel(p: ItemModelProps) {
  const { item } = p;
  if (item.placement === 'wall') return <WallItem {...p} />;
  const [cx, cz] = footCenter(item, p.x, p.y, p.rot);
  const [fw, fh] = footSize(item, 0);
  const on = p.on ?? item.use === 'light';
  const inner =
    item.proc === 'bookcase' ? (
      <group position={[0, 0, -(item.h ?? 1) / 2 + 0.41]}>
        {p.ghost ? <GhostBox w={fw} h={1.7} d={0.36} ok={p.ghost === 'ok'} /> : <Bookcase w={fw} books={p.books ?? []} onBook={p.onBook} />}
      </group>
    ) : item.proc === 'swing' || item.proc === 'fireplace' ? (
      p.ghost ? (
        <group position={[0, 0, fh / 2 - 0.05]}>
          <GhostBox w={fw - 0.1} h={item.proc === 'swing' ? 2.1 : 1.3} d={fh - 0.1} ok={p.ghost === 'ok'} />
        </group>
      ) : (
        <group>
          {item.proc === 'swing' ? <Swing active={p.active} /> : <Fireplace on={on} />}
          {/* İnce direklere dokunmak zor: bütün ayak izi dokunulur */}
          <mesh position={[0, 0.9, 0]}>
            <boxGeometry args={[fw - 0.1, 1.8, fh - 0.1]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      )
    ) : (
      <FloorModel item={item} ghost={p.ghost} on={on} lit={!!p.lit} screen={p.screen ?? null} />
    );
  return (
    <group position={[cx, p.lift ?? 0, cz]} rotation-y={(-p.rot * Math.PI) / 180} onPointerDown={p.onPointerDown} onClick={p.onClick}>
      {inner}
    </group>
  );
}

function FloorModel({ item, ghost, on, lit, screen }: { item: Item; ghost?: 'ok' | 'bad'; on: boolean; lit: boolean; screen: Texture | null }) {
  const t = useTemplate(item, ghost ? true : on);
  const obj = useMemo(() => ghostify(t.obj.clone(true), ghost), [t, ghost]);
  const s = item.scale ?? 1;
  const top = (t.maxY - t.minY) * s;
  return (
    <group>
      <primitive object={obj} scale={s} position={[-t.center.x * s, -t.minY * s + 0.01, -t.center.z * s]} />
      {!ghost && on && item.use === 'light' && lit && <pointLight position={[0, top * 0.85, 0.15]} color="#ffd9a0" intensity={2.6} distance={4.5} decay={1.5} />}
      {!ghost && on && item.use === 'fire' && <Flame y={0.06} scale={0.9} light />}
      {!ghost && on && screen && <Screen item={item} size={t.size} s={s} z={(t.size.z * s) / 2} y={t.size.y * s * (item.screen?.[2] ?? 0.6)} map={screen} />}
    </group>
  );
}

/** Açık TV'nin ekranı: modelin ön yüzünde, items.json → screen oranlarıyla */
function Screen({ item, size, s, z, y, map }: { item: Item; size: Vector3; s: number; z: number; y: number; map: Texture }) {
  const [fw, fh] = item.screen ?? [0.86, 0.62];
  return (
    <mesh position={[0, y, z + 0.006]}>
      <planeGeometry args={[size.x * s * fw, size.y * s * fh]} />
      <meshBasicMaterial map={map} toneMapped={false} />
    </mesh>
  );
}

function GhostBox({ w, h, d, ok }: { w: number; h: number; d: number; ok: boolean }) {
  return (
    <mesh position={[0, h / 2, -d / 2]} material={GHOST[ok ? 'ok' : 'bad']}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

/** Duvar eşyası: arka duvarda x boyunca, sol duvarda z boyunca; sırtı duvara yaslı */
function WallItem(p: ItemModelProps) {
  const { item } = p;
  const n = item.w ?? 1;
  const back = p.y === -1 && p.x >= 0;
  const along = n / 2;
  const pos: [number, number, number] = back ? [p.x + along, WALL_Y, 0.02 + (p.lift ?? 0)] : [0.02 + (p.lift ?? 0), WALL_Y, p.y + along];
  return (
    <group position={pos} rotation-y={back ? 0 : Math.PI / 2} onPointerDown={p.onPointerDown} onClick={p.onClick}>
      {item.model ? <WallModel item={item} ghost={p.ghost} on={p.on ?? item.use === 'light'} lit={!!p.lit} screen={p.screen ?? null} /> : <WallArt item={item} ghost={p.ghost} on={p.on ?? true} />}
    </group>
  );
}

function WallModel({ item, ghost, on, lit, screen }: { item: Item; ghost?: 'ok' | 'bad'; on: boolean; lit: boolean; screen: Texture | null }) {
  const t = useTemplate(item, ghost ? true : on);
  const obj = useMemo(() => ghostify(t.obj.clone(true), ghost), [t, ghost]);
  const s = item.scale ?? 1;
  return (
    <group>
      <primitive object={obj} scale={s} position={[-t.center.x * s, -t.center.y * s, -t.minZ * s]} />
      {!ghost && on && item.use === 'light' && lit && <pointLight position={[0, 0, 0.5]} color="#ffd9a0" intensity={2.2} distance={4} decay={1.5} />}
      {!ghost && on && screen && <Screen item={item} size={t.size} s={s} z={t.size.z * s} y={t.size.y * s * ((item.screen?.[2] ?? 0.5) - 0.5)} map={screen} />}
    </group>
  );
}

/** Kodla çizilen resim ya da süs: çerçeveli tuval, saat, raf, ışık zinciri */
function WallArt({ item, ghost, on }: { item: Item; ghost?: 'ok' | 'bad'; on: boolean }) {
  const n = item.w ?? 1;
  const w = n - 0.16;
  const h = ART_HEIGHT;
  if (ghost) {
    return (
      <mesh position={[0, 0, 0.03]} material={GHOST[ghost]}>
        <boxGeometry args={[w, item.art === 'raf' ? 0.1 : h, 0.05]} />
      </mesh>
    );
  }
  if (item.art === 'saat') return <WallClock />;
  if (item.art === 'raf') return <WallShelf w={w} />;
  if (item.art === 'isiklar') return <StringLights w={n - 0.1} on={on} />;
  return <Framed art={item.art!} w={w} h={h} n={n} />;
}

function Framed({ art, w, h, n }: { art: string; w: number; h: number; n: number }) {
  const map = useMemo(() => artTexture(art, n), [art, n]);
  return (
    <group>
      <mesh position={[0, 0, 0.015]} castShadow>
        <boxGeometry args={[w + 0.06, h + 0.06, 0.03]} />
        <meshStandardMaterial color={art === 'pano' ? '#8a5a2a' : '#5a3d1f'} />
      </mesh>
      <mesh position={[0, 0, 0.032]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={map} />
      </mesh>
    </group>
  );
}

/** Gerçek saati gösteren duvar saati: dakikada bir yeniden çizilir */
function WallClock() {
  const [map, setMap] = useState(clockTexture);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => {
      setMap(clockTexture());
      invalidate();
    }, 30_000);
    return () => clearInterval(id);
  }, [invalidate]);
  return (
    <group>
      <mesh position={[0, 0, 0.02]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 24]} />
        <meshStandardMaterial color="#2b2d42" />
      </mesh>
      <mesh position={[0, 0, 0.041]}>
        <circleGeometry args={[0.27, 24]} />
        <meshStandardMaterial map={map} />
      </mesh>
    </group>
  );
}

function WallShelf({ w }: { w: number }) {
  return (
    <group position={[0, -0.2, 0]}>
      <mesh position={[0, 0, 0.1]} castShadow>
        <boxGeometry args={[w, 0.04, 0.2]} />
        <meshStandardMaterial color="#a8743f" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.1), -0.07, 0.03]}>
          <boxGeometry args={[0.04, 0.12, 0.06]} />
          <meshStandardMaterial color="#7a5230" />
        </mesh>
      ))}
      {['#ef476f', '#118ab2', '#ffd166', '#06d6a0'].map((c, i) => (
        <mesh key={c} position={[-w / 2 + 0.15 + i * 0.07, 0.11, 0.1]} castShadow>
          <boxGeometry args={[0.06, 0.18 + (i % 2) * 0.03, 0.14]} />
          <meshStandardMaterial color={c} />
        </mesh>
      ))}
      <mesh position={[w / 2 - 0.2, 0.08, 0.1]} castShadow>
        <cylinderGeometry args={[0.06, 0.05, 0.12, 8]} />
        <meshStandardMaterial color="#d98b6a" />
      </mesh>
      <mesh position={[w / 2 - 0.2, 0.2, 0.1]}>
        <icosahedronGeometry args={[0.08, 0]} />
        <meshStandardMaterial color="#5fae4f" flatShading />
      </mesh>
    </group>
  );
}

function StringLights({ w, on }: { w: number; on: boolean }) {
  const bulbs = 9;
  return (
    <group position={[0, 0.2, 0.04]}>
      {Array.from({ length: bulbs }, (_, i) => {
        const t = i / (bulbs - 1);
        const x = -w / 2 + t * w;
        const y = -Math.sin(t * Math.PI) * 0.18;
        const c = ['#ffd166', '#ff8ac2', '#7ee0ff', '#b6f37a'][i % 4];
        return (
          <mesh key={i} position={[x, y, 0]}>
            <sphereGeometry args={[0.035, 8, 6]} />
            <meshStandardMaterial color={on ? c : '#d8d8d8'} emissive={c} emissiveIntensity={on ? 1.2 : 0} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Ayak izi karoları (yerleştirmede yeşil/kırmızı zemin); duvar eşyasında duvardaki şerit */
export function FootTiles({ item, x, y, rot, ok }: { item: Item; x: number; y: number; rot: number; ok: boolean }) {
  const color = ok ? '#3fcf6b' : '#ef4b4b';
  if (item.placement === 'wall') {
    const slots = wallSlots(item, x, y);
    return (
      <group>
        {slots.map((t) => (
          <mesh key={`${t.x},${t.y}`} position={t.y === -1 ? [t.x + 0.5, 0.03, 0.15] : [0.15, 0.03, t.y + 0.5]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={t.y === -1 ? [0.94, 0.3] : [0.3, 0.94]} />
            <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        ))}
      </group>
    );
  }
  const [w, h] = footSize(item, rot);
  return (
    <mesh position={[x + w / 2, 0.02, y + h / 2]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[w - 0.06, h - 0.06]} />
      <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

/** Imlecin altındaki karo: Habbo gibi vurgulu çerçeve */
export function HoverTile({ x, y }: { x: number; y: number }) {
  return (
    <mesh position={[x + 0.5, 0.025, y + 0.5]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.42, 0.5, 4, 1, Math.PI / 4]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} />
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
