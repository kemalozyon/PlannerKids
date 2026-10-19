// Odaya, duvara ve bahçeye yerleştirilen eşyaların 3D görünüşü.
// - Model eşyalar (Kenney): karo ayak izinin ortasına oturtulur, items.json'daki ölçekle büyütülür; kumaş/lamba
//   renkleri `tint` ile boyanır, `glow` malzemesi ışık saçar.
// - Duvar eşyaları: arka duvarda (y = -1) ya da sol duvarda (x = -1), sırtı duvara yaslı.
// - Kodla çizilenler: posterler/tablolar (art), kitaplık, salıncak, şömine ve Habbo tarzı set parçaları (proc).
// - İşlevli eşyalar (use): ışık açıkken parlar (yakındakiler gerçek ışık saçar), ateş yanar, TV açıkken ekranda
//   çalışma istatistiği ya da bu ayın ormanı görünür.
// - Küçük eşya bir yüzeyin üstündeyse (masa, sehpa) o yüzeyin yüksekliğine kalkar (OnSurface).
// Yerleştirme modunda aynı görünüş yarı saydam yeşil (konabilir) ya da kırmızı (konamaz) önizleme olur.
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, Vector3, type Group, type Material, type Texture } from 'three';
import { has, type Item } from '../../lib/catalog';
import type { Book } from '../../lib/types';
import { footSize, subOffset, wallSlots } from '../../lib/world';
import { modelUrl } from '../forest3d/models';
import { ART_HEIGHT, artTexture, clockTexture } from './art';
import { Bookcase } from './Books';
import { WALL_ART } from './WallArts';
import { Fireplace, Flame, Steam, Swing } from './Proc';
import { damp, dampAngle, Hinge, useReducedMotion } from './motion';
import { pieceTop, SetPiece } from './Sets';

/** Duvar eşyalarının orta yüksekliği */
export const WALL_Y = 1.45;

/** Model + boya için hazırlanmış şablon ve ayak izine oturtma bilgisi (bir kez hesaplanır) */
const templates = new Map<string, { obj: Object3D; center: Vector3; minY: number; maxY: number; minZ: number; size: Vector3 }>();

/** Malzemeyi boya: tint, açıkken ışık saçan malzeme; seçili renk (CHANGE_COLOR) ışık saçanın ya da kumaşın yerine */
function paint(m: Material, item: Item, on: boolean, pick?: string): Material {
  if (!(m instanceof MeshStandardMaterial)) return m;
  const target = item.glow ?? Object.keys(item.tint ?? {})[0];
  const color = pick && m.name === target ? pick : item.tint?.[m.name];
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

/** Eşyanın şablonu; ışık kapalıyken parlamayan ve her renk için ayrı bir şablon */
function useTemplate(item: Item, on = true, pick?: string) {
  const { scene } = useGLTF(modelUrl(item.model!));
  return useMemo(() => {
    const k = `${item.id}:${on ? 1 : 0}:${pick ?? ''}`;
    let t = templates.get(k);
    if (!t) {
      const obj = scene.clone(true);
      obj.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.material = Array.isArray(o.material) ? o.material.map((m) => paint(m, item, on, pick)) : paint(o.material, item, on, pick);
        }
      });
      const box = new Box3().setFromObject(obj);
      t = { obj, center: box.getCenter(new Vector3()), minY: box.min.y, maxY: box.max.y, minZ: box.min.z, size: box.getSize(new Vector3()) };
      templates.set(k, t);
      // Yüzey yüksekliği (surfaceTop) ışık durumundan bağımsız
      if (!templates.has(item.id)) templates.set(item.id, t);
    }
    return t;
  }, [scene, item, on, pick]);
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
  if (item.proc === 'set') return pieceTop(item);
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
  /** TOGGLE açık mı (verilmezse lamba açık, TV/ateş/hareket kapalı) */
  on?: boolean;
  /** OPEN_CLOSE / GATE açık mı */
  open?: boolean;
  /** CHANGE_COLOR: seçili renk */
  color?: string;
  /** ROLL: zarın üstteki yüzü ve atış sayacı (değişince yuvarlanır) */
  value?: number;
  tick?: number;
  /** Yeni kondu: yukarıdan düşüp yerine oturur */
  appear?: boolean;
  /** Açık TV'nin ekranı */
  screen?: Texture | null;
  /** Salıncakta biri sallanıyor */
  active?: boolean;
  /** Masa üstünde karonun bir çeyreğinde (küçültülmüş) */
  sub?: number;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export function ItemModel(p: ItemModelProps) {
  const { item } = p;
  if (item.placement === 'wall') return <WallItem {...p} />;
  const [fx, fz] = footCenter(item, p.x, p.y, p.rot);
  const [ox, oz] = p.sub === undefined ? [0, 0] : subOffset(p.sub);
  const cx = fx + ox;
  const cz = fz + oz;
  const [fw, fh] = footSize(item, 0);
  const on = p.on ?? (has(item, 'TOGGLE') && item.fx === 'light');
  const inner =
    item.proc === 'bookcase' ? (
      <group position={[0, 0, -(item.h ?? 1) / 2 + 0.41]}>
        {p.ghost ? <GhostBox w={fw} h={1.7} d={0.36} ok={p.ghost === 'ok'} /> : <Bookcase w={fw} books={p.books ?? []} onBook={p.onBook} />}
      </group>
    ) : item.proc === 'set' ? (
      p.ghost ? (
        <group position={[0, 0, fh / 2 - 0.05]}>
          <GhostBox w={fw - 0.1} h={Math.max(0.3, pieceTop(item))} d={fh - 0.1} ok={p.ghost === 'ok'} />
        </group>
      ) : (
        <SetPiece item={item} on={on} open={!!p.open} color={p.color} value={p.value} tick={p.tick} />
      )
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
      <FloorModel item={item} ghost={p.ghost} on={on} screen={p.screen ?? null} color={p.color} />
    );
  return (
    <Motion x={cx} y={p.lift ?? 0} z={cz} rot={(-p.rot * Math.PI) / 180} lifted={!!p.lift} appear={p.appear} ghost={!!p.ghost} onPointerDown={p.onPointerDown} onClick={p.onClick}>
      {/* Açık kapı (GATE) menteşesinden döner */}
      {has(item, 'GATE') && item.model ? (
        <Hinge open={!!p.open} to={1.35} position={[-fw / 2, 0, 0]}>
          <group position={[fw / 2, 0, 0]}>{inner}</group>
        </Hinge>
      ) : p.sub !== undefined ? (
        <group scale={SUB_SCALE}>{inner}</group>
      ) : (
        inner
      )}
      {/* Kahve makinesi açıkken buhar tüter */}
      {on && item.fx === 'steam' && !p.ghost && <Steam y={surfaceTop(item) * (p.sub !== undefined ? SUB_SCALE : 1) * 0.9} scale={p.sub !== undefined ? SUB_SCALE : 1} />}
    </Motion>
  );
}

/** Çeyreğe konan eşyanın ölçeği */
export const SUB_SCALE = 0.55;

/** Düşüş süresi (sn): düşüş + ezilip esneyen yaylanma */
const APPEAR_S = 0.7;
/** Düşüşün süreye oranı (sonrası yaylanma) */
const FALL = 0.4;

/**
 * Eşyanın yeri ve dönüşü yumuşakça değişir: seçilince havalanıp hafifçe salınır, döndürülünce en kısa yoldan
 * döner, önizleme karodan karoya kayar; yeni konan eşya yukarıdan düşüp esneyerek yerine oturur.
 */
function Motion({
  x,
  y,
  z,
  rot,
  lifted,
  appear,
  ghost,
  children,
  onPointerDown,
  onClick,
}: {
  x: number;
  y: number;
  z: number;
  rot: number;
  lifted: boolean;
  appear?: boolean;
  ghost: boolean;
  children: ReactNode;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const g = useRef<Group>(null);
  const reduced = useReducedMotion();
  const invalidate = useThree((s) => s.invalidate);
  const st = useRef({ x, y, z, rot, t: appear && !reduced ? 0 : 1, wob: 0 });
  useFrame((_, rawDt) => {
    const o = g.current;
    if (!o) return;
    const dt = Math.min(rawDt, 0.05);
    const S = st.current;
    const fast = reduced ? 60 : ghost ? 28 : 16;
    S.x = damp(S.x, x, fast, dt);
    S.z = damp(S.z, z, fast, dt);
    S.y = damp(S.y, y, reduced ? 60 : 14, dt);
    S.rot = dampAngle(S.rot, rot, reduced ? 60 : 14, dt);
    let busy = Math.abs(S.x - x) + Math.abs(S.z - z) + Math.abs(S.y - y) + Math.abs(S.rot - rot) > 0.001;
    let dy = 0;
    let sx = 1;
    let sy = 1;
    if (S.t < 1) {
      S.t = Math.min(1, S.t + dt / APPEAR_S);
      // Hızlanarak düşerken boyuna uzar (stretch); yere değince ezilir (squash), sönen bir yay gibi birkaç kez
      // esneyip yerine oturur. Hacim korunur gibi: boy kısalınca en genişler.
      const f = Math.min(1, S.t / FALL);
      dy = (1 - f * f) * 0.9;
      const k = S.t < FALL ? 0.1 * f * f : -0.22 * Math.exp(-5 * ((S.t - FALL) / (1 - FALL))) * Math.cos(3 * Math.PI * ((S.t - FALL) / (1 - FALL)));
      sy = S.t >= 1 ? 1 : 1 + k;
      sx = S.t >= 1 ? 1 : 1 - k * 0.5;
      busy = true;
    }
    // Seçiliyken hafif nefes (yalnızca o sırada kare ister)
    if (lifted && !reduced) {
      S.wob += dt;
      dy += Math.sin(S.wob * 3.2) * 0.025;
      busy = true;
    } else S.wob = 0;
    o.position.set(S.x, S.y + dy, S.z);
    o.rotation.y = S.rot;
    o.scale.set(sx, sy, sx);
    if (busy) invalidate();
  });
  const S = st.current;
  return (
    <group ref={g} position={[S.x, S.y + (S.t < 1 ? 0.9 : 0), S.z]} rotation-y={S.rot} onPointerDown={onPointerDown} onClick={onClick}>
      {children}
    </group>
  );
}

function FloorModel({ item, ghost, on, screen, color }: { item: Item; ghost?: 'ok' | 'bad'; on: boolean; screen: Texture | null; color?: string }) {
  const t = useTemplate(item, ghost ? true : on, color);
  const obj = useMemo(() => ghostify(t.obj.clone(true), ghost), [t, ghost]);
  const s = item.scale ?? 1;
  return (
    <group>
      <primitive object={obj} scale={s} position={[-t.center.x * s, -t.minY * s + 0.01, -t.center.z * s]} />
      {!ghost && on && item.fx === 'fire' && <Flame y={0.06} scale={0.9} />}
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
  const lift = p.lift ? 0.12 : 0;
  const pos: [number, number, number] = back ? [p.x + along, WALL_Y, 0.02 + lift] : [0.02 + lift, WALL_Y, p.y + along];
  return (
    <Motion x={pos[0]} y={pos[1]} z={pos[2]} rot={back ? 0 : Math.PI / 2} lifted={false} appear={p.appear} ghost={!!p.ghost} onPointerDown={p.onPointerDown} onClick={p.onClick}>
      {item.model ? (
        <WallModel item={item} ghost={p.ghost} on={p.on ?? item.fx === 'light'} screen={p.screen ?? null} color={p.color} />
      ) : (
        <WallArt item={item} ghost={p.ghost} on={p.on ?? true} color={p.color} screen={p.screen ?? null} />
      )}
    </Motion>
  );
}

function WallModel({ item, ghost, on, screen, color }: { item: Item; ghost?: 'ok' | 'bad'; on: boolean; screen: Texture | null; color?: string }) {
  const t = useTemplate(item, ghost ? true : on, color);
  const obj = useMemo(() => ghostify(t.obj.clone(true), ghost), [t, ghost]);
  const s = item.scale ?? 1;
  return (
    <group>
      <primitive object={obj} scale={s} position={[-t.center.x * s, -t.center.y * s, -t.minZ * s]} />
      {!ghost && on && screen && <Screen item={item} size={t.size} s={s} z={t.size.z * s} y={t.size.y * s * ((item.screen?.[2] ?? 0.5) - 0.5)} map={screen} />}
    </group>
  );
}

/** Kodla çizilen resim ya da süs: çerçeveli tuval, saat, raf, ışık zinciri; mantar panoda gerçek notlar (screen) */
function WallArt({ item, ghost, on, color, screen }: { item: Item; ghost?: 'ok' | 'bad'; on: boolean; color?: string; screen?: Texture | null }) {
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
  const Extra = WALL_ART[item.art ?? ''];
  if (Extra) return <Extra w={w} n={n} on={on} color={color ?? item.palette?.[0] ?? item.colors?.[0] ?? '#ff4fa3'} />;
  return <Framed art={item.art!} w={w} h={h} n={n} map={screen && has(item, 'NOTES') ? screen : undefined} />;
}

function Framed({ art, w, h, n, map: given }: { art: string; w: number; h: number; n: number; map?: Texture }) {
  const drawn = useMemo(() => artTexture(art, n), [art, n]);
  const map = given ?? drawn;
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
export function FootTiles({ item, x, y, rot, ok, sub }: { item: Item; x: number; y: number; rot: number; ok: boolean; sub?: number }) {
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
  if (sub !== undefined) {
    const [ox, oy] = subOffset(sub);
    return (
      <mesh position={[x + 0.5 + ox, 0.02, y + 0.5 + oy]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.46, 0.46]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} />
      </mesh>
    );
  }
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
    // Habbo gibi sarı karo çerçevesi, içi hafif dolu
    <group position={[x + 0.5, 0.025, y + 0.5]} rotation-x={-Math.PI / 2}>
      <mesh>
        <ringGeometry args={[0.4, 0.5, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color="#ffd23f" transparent opacity={0.95} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial color="#ffd23f" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
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
