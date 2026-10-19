// Odanın içi (Habbo gibi boşlukta yüzen ada): kalın desenli zemin, yalnızca arkadaki iki duvar (kaplama rengi ve
// deseniyle), kapılar ve pencereler. Kamera hep güneydoğudan bakar, ön ve doğu tarafta duvar yoktur.
// Kenarı 'w' ya da 'n' olan kapı duvarda bir açıklıktır; doğu/güney kenarındaki kapı yerde bir paspastır. Kapıya
// dokununca karakter oraya yürür ve sayfa kapının götürdüğü odayı açar.
// Kütüphane odasında arka duvar boyunca gömme raflar ve bitirilen kitaplar durur.
// Eklenen odaların şekli olabilir (L, basamak, blok düzenleyici): zemin dikdörtgen parçalardan çizilir (`rects`).
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { Color, type Texture } from 'three';
import type { Item } from '../../lib/catalog';
import type { FixedTile } from '../../lib/config';
import type { Book } from '../../lib/types';
import { patternTexture } from './art';
import { Bookcase, ReadingStack } from './Books';
import { isTap } from './light';

export const WALL_H = 2.6;
const T = 0.14;

export interface RoomProps {
  w: number;
  h: number;
  floor: Item | undefined;
  wall: Item | undefined;
  fixed: FixedTile[];
  onDoor: (d: FixedTile) => void;
  /** Kütüphane: gömme raflardaki kitaplar */
  shelfBooks?: Book[];
  reading?: Book[];
  onBook?: (b: Book) => void;
  /** Pencereden görünen dış dünya (art.ts → windowTexture: gerçek saate göre) */
  view?: Texture;
  /** Şekilli odanın zemin parçaları [x, y, en, boy]; yoksa bütün w×h */
  rects?: [number, number, number, number][];
}

/** Zeminin kalınlığı (Habbo'daki gibi adanın kenarı görünür) */
const SLAB = 0.42;

export default function Room({ w, h, floor, wall, fixed, onDoor, shelfBooks = [], reading = [], onBook, view, rects }: RoomProps) {
  const c1 = floor?.color ?? '#c89a6a';
  const c2 = floor?.color2 ?? c1;
  const wc = wall?.color ?? '#f3e6cf';
  const wc2 = wall?.color2 ?? wc;
  const parts = useMemo(() => rects ?? [[0, 0, w, h] as [number, number, number, number]], [rects, w, h]);
  // Her parçanın deseni aynı ızgaraya oturur (parçalar arasında desen kaymaz)
  const floorMaps = useMemo(() => {
    const base = patternTexture(floor?.pattern ?? (floor?.color2 ? 'checker' : 'plain'), c1, c2, 'floor');
    const k = floor?.pattern ? 1 : 2;
    return parts.map(([x, y, pw, ph]) => {
      const t = base.clone();
      t.repeat.set(pw / k, ph / k);
      t.offset.set(x / k, -(y + ph) / k);
      t.needsUpdate = true;
      return t;
    });
  }, [floor, c1, c2, parts]);
  // Duvarlardaki açıklıklar: arka duvarda kenarı 'n', sol duvarda 'w' olan kapılar
  const gapsBack = fixed.filter((f) => f.kind === 'door' && f.edge === 'n' && f.y === 0).map((f) => f.x);
  const gapsLeft = fixed.filter((f) => f.kind === 'door' && f.edge === 'w' && f.x === 0).map((f) => f.y);
  // Eski tip (kenarsız) kapılar duvara çizilir; kenarlı kapılardan yalnızca açıklık olanlar kasa ister
  const doors = fixed.filter((f) => f.kind === 'door' && !f.edge);
  const openings = fixed.filter((f) => f.kind === 'door' && ((f.edge === 'n' && f.y === 0) || (f.edge === 'w' && f.x === 0)));
  const mats = fixed.filter((f) => f.kind === 'door' && (f.edge === 'e' || f.edge === 's'));
  const windows = fixed.filter((f) => f.kind === 'window');
  const side = new Color(c2).multiplyScalar(0.55).getStyle();
  const shelves = fixed.filter((f) => f.kind === 'shelf');
  return (
    <group>
      {/* Zemin (şekilli odada parça parça) */}
      {parts.map(([x, y, pw, ph], i) => (
        <group key={`${x},${y}`}>
          <mesh position={[x + pw / 2, -SLAB / 2, y + ph / 2]} receiveShadow>
            <boxGeometry args={[pw, SLAB, ph]} />
            <meshStandardMaterial color={side} />
          </mesh>
          <mesh position={[x + pw / 2, 0.001, y + ph / 2]} rotation-x={-Math.PI / 2} receiveShadow>
            <planeGeometry args={[pw, ph]} />
            <meshStandardMaterial map={floorMaps[i]} roughness={0.82} polygonOffset polygonOffsetFactor={-1} />
          </mesh>
        </group>
      ))}
      {/* Arka duvar (z = 0) ve sol duvar (x = 0), kapı açıklıklarıyla parça parça */}
      <WallStrip len={w} gaps={gapsBack} side="back" wall={wall} c1={wc} c2={wc2} />
      <mesh position={[w / 2 - T / 2, WALL_H + 0.03, -T / 2]}>
        <boxGeometry args={[w + T * 2, 0.06, T + 0.04]} />
        <meshStandardMaterial color="#8a6a4a" />
      </mesh>
      <WallStrip len={h} gaps={gapsLeft} side="left" wall={wall} c1={wc} c2={wc2} />
      <mesh position={[-T / 2, WALL_H + 0.03, h / 2]}>
        <boxGeometry args={[T + 0.04, 0.06, h]} />
        <meshStandardMaterial color="#8a6a4a" />
      </mesh>
      {windows.map((f) => (
        <Window key={`${f.x},${f.y}`} f={f} view={view} />
      ))}
      {doors.map((d) => (
        <Door key={`${d.x},${d.y}`} d={d} onDoor={onDoor} />
      ))}
      {openings.map((d) => (
        <Doorway key={`o${d.x},${d.y}`} d={d} onDoor={onDoor} />
      ))}
      {mats.map((d) => (
        <DoorMat key={`m${d.x},${d.y}`} d={d} onDoor={onDoor} />
      ))}
      {shelves.map((f) => (
        <group key={`${f.x},${f.y}`} position={[f.x + (f.w ?? 1) / 2, 0, 0.42]}>
          <Bookcase w={f.w ?? 1} books={shelfBooks} onBook={onBook} />
          {reading.length > 0 && (
            <group position={[(f.w ?? 1) / 2 - 0.5, 1.72, -0.18]}>
              <ReadingStack books={reading} onBook={onBook} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/** Bir duvarın parçaları: [0, len) boyunca, açıklıkların (1 karo) dışında; açıklığın üstünde lento */
function WallStrip({ len, gaps, side, wall, c1, c2 }: { len: number; gaps: number[]; side: 'back' | 'left'; wall: Item | undefined; c1: string; c2: string }) {
  const parts = useMemo(() => {
    const out: [number, number][] = [];
    let at = 0;
    for (const g of [...gaps].sort((a, b) => a - b)) {
      if (g > at) out.push([at, g]);
      at = g + 1;
    }
    if (at < len) out.push([at, len]);
    return out;
  }, [len, gaps]);
  const maps = useMemo(
    () =>
      parts.map(([a, b]) => {
        const t = patternTexture(wall?.pattern ?? (wall?.stars ? 'stars' : 'plain'), c1, c2, 'wall').clone();
        t.repeat.set(b - a, 1);
        t.needsUpdate = true;
        return t;
      }),
    [parts, wall, c1, c2],
  );
  const back = side === 'back';
  const shade = new Color(c1).multiplyScalar(back ? 0.95 : 0.85);
  const LINTEL = 2.05;
  // Duvar boyunca a…b parçasını yerleştir (arka duvar x boyunca, sol duvar z boyunca)
  const at = (a: number, b: number, y: number, off: number): [number, number, number] => (back ? [(a + b) / 2, y, off] : [off, y, (a + b) / 2]);
  return (
    <group>
      {parts.map(([a, b], i) => {
        const n = b - a;
        // Köşede iki duvar üst üste biner (boşluk kalmasın)
        const s0 = a === 0 ? -T : a;
        return (
          <group key={a}>
            <mesh position={at(s0, b, WALL_H / 2, -T / 2)} receiveShadow>
              <boxGeometry args={back ? [b - s0, WALL_H, T] : [T, WALL_H, b - s0]} />
              <meshStandardMaterial color={shade} />
            </mesh>
            <mesh position={at(a, b, WALL_H / 2, 0.001)} rotation-y={back ? 0 : Math.PI / 2} receiveShadow>
              <planeGeometry args={[n, WALL_H]} />
              <meshStandardMaterial map={maps[i]} color={back ? '#ffffff' : '#e6e6e6'} polygonOffset polygonOffsetFactor={-1} />
            </mesh>
            {/* Süpürgelik */}
            <mesh position={at(a, b, 0.06, 0.012)}>
              <boxGeometry args={back ? [n, 0.12, 0.03] : [0.03, 0.12, n]} />
              <meshStandardMaterial color="#8a6a4a" />
            </mesh>
          </group>
        );
      })}
      {gaps.map((g) => (
        <group key={`l${g}`}>
          <mesh position={at(g, g + 1, (LINTEL + WALL_H) / 2, -T / 2)}>
            <boxGeometry args={back ? [1, WALL_H - LINTEL, T] : [T, WALL_H - LINTEL, 1]} />
            <meshStandardMaterial color={shade} />
          </mesh>
          <mesh position={at(g, g + 1, (LINTEL + WALL_H) / 2, 0.001)} rotation-y={back ? 0 : Math.PI / 2}>
            <planeGeometry args={[1, WALL_H - LINTEL]} />
            <meshStandardMaterial color={c1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Duvardaki açıklık: kasa ve eşikte paspas (kapı kanadı yok, içinden yürünür) */
function Doorway({ d, onDoor }: { d: FixedTile; onDoor: (d: FixedTile) => void }) {
  const back = d.edge === 'n';
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    onDoor(d);
  };
  const color = d.to === 'library' ? '#8b5cf6' : d.to === 'room' ? '#d9a35f' : '#b07a4a';
  return (
    <group position={back ? [d.x + 0.5, 0, 0] : [0, 0, d.y + 0.5]} rotation-y={back ? 0 : Math.PI / 2} onClick={click}>
      {[-0.5, 0.5].map((s) => (
        <mesh key={s} position={[s, 1.03, 0]}>
          <boxGeometry args={[0.08, 2.06, T + 0.06]} />
          <meshStandardMaterial color="#6b4a2f" />
        </mesh>
      ))}
      <mesh position={[0, 2.08, 0]}>
        <boxGeometry args={[1.08, 0.08, T + 0.06]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <mesh position={[0, 2.3, 0.01]}>
        <circleGeometry args={[0.13, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.006, 0.35]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial color={d.to === 'library' ? '#c9b6ff' : '#9fd39a'} />
      </mesh>
    </group>
  );
}

/**
 * Duvarı olmayan kenardaki kapı (doğu/güney, terasta hepsi): yerde ok işaretli bir paspas. Dokununca karakter oraya
 * yürür, sayfa kapının götürdüğü odayı açar.
 */
export function DoorMat({ d, onDoor }: { d: FixedTile; onDoor: (d: FixedTile) => void }) {
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    onDoor(d);
  };
  // Okun yönü: kapının açıldığı kenar
  const rot = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 }[d.edge ?? 's'];
  return (
    <group position={[d.x + 0.5, 0.012, d.y + 0.5]} onClick={click}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.86, 0.86]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004}>
        <planeGeometry args={[0.74, 0.74]} />
        <meshStandardMaterial color="#9fd39a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, rot]} position-y={0.008}>
        <circleGeometry args={[0.22, 3]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

function Window({ f, view }: { f: FixedTile; view?: Texture }) {
  const back = f.y === -1;
  const len = back ? (f.w ?? 1) : (f.h ?? 1);
  const pos: [number, number, number] = back ? [f.x + len / 2, 1.45, 0.02] : [0.02, 1.45, f.y + len / 2];
  const ww = len - 0.2;
  return (
    <group position={pos} rotation-y={back ? 0 : Math.PI / 2}>
      <mesh>
        <boxGeometry args={[ww + 0.12, 1.1, 0.05]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[ww, 0.96]} />
        {view ? <meshBasicMaterial map={view} toneMapped={false} /> : <meshStandardMaterial color="#a8dcff" emissive="#a8dcff" emissiveIntensity={0.35} />}
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.05, 0.96, 0.02]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[ww, 0.05, 0.02]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, -0.58, 0.08]}>
        <boxGeometry args={[ww + 0.2, 0.05, 0.16]} />
        <meshStandardMaterial color="#e8e0d4" />
      </mesh>
    </group>
  );
}

function Door({ d, onDoor }: { d: FixedTile; onDoor: (d: FixedTile) => void }) {
  const onBack = d.y === 0; // arka duvardaki kapı; değilse sol duvarda
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    onDoor(d);
  };
  const pos: [number, number, number] = onBack ? [d.x + 0.5, 0.95, 0.02] : [0.02, 0.95, d.y + 0.5];
  const color = d.to === 'library' ? '#8b5cf6' : d.to === 'room' ? '#d9a35f' : '#b07a4a';
  return (
    <group position={pos} rotation-y={onBack ? 0 : Math.PI / 2} onClick={click}>
      <mesh>
        <boxGeometry args={[0.96, 1.9, 0.05]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[0.82, 1.78, 0.03]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0.3, -0.05, 0.06]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#ffd54a" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Kapının üstündeki işaret ve önündeki paspas */}
      <mesh position={[0, 1.15, 0.03]}>
        <circleGeometry args={[0.13, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 1.15, 0.035]}>
        <circleGeometry args={[0.09, d.to === 'library' ? 4 : 3]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, -0.93, 0.5]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial color={d.to === 'library' ? '#c9b6ff' : '#9fd39a'} />
      </mesh>
    </group>
  );
}
