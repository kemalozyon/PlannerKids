// Evin dış kabuğu (Sims gibi): oda ve kütüphane bu kabuğun gerçek içidir (worldPlan.ts → kütüphane | oda); eklenen
// odalar doğuda tek katlı, düz çatılı ekler. Dış duvarlar evin karolarının güney ve doğu kenarlarını izler (şekilli
// odada kesiklerin kenarından döner). Dışarıdayken dış duvarlar, üst kat ve çatı görünür. Karakter içeri girince
// (ya da içerisi düzenlenirken) çatı silikleşir, dış duvarlar kısa bir basamağa iner; içerisi görünür.
// İç duvarlar (arka ve sol) Room.tsx'tedir; burası yalnızca dışarıdan görünen yüzleri çizer.
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { ExtrudeGeometry, MeshStandardMaterial, Shape, type Group } from 'three';
import type { MapDef } from '../../lib/config';
import { isTap } from './light';
import { WALL_H } from './Room';

const T = 0.14;
/** İçerisi görünürken ön duvarların yüksekliği */
const LOW = 0.32;
const FLOOR_H = 1.6;

export interface HouseShellProps {
  /** Ana evin dünyadaki ölçüsü: kütüphane + oda genişliği, odanın derinliği (üst kat ve beşik çatı bunun üstünde) */
  w: number;
  h: number;
  /** Evin bütün karoları ("x,y", dünya): dış duvarlar bunların kenarından */
  cells: Set<string>;
  /** Evin en doğusu (arka duvarın dış yüzü buraya kadar) */
  houseW: number;
  /** Eklenen odaların zemin parçaları (dünya): düz çatı */
  annex: [number, number, number, number][];
  /** Ön kapının x'i (dünya, karo) */
  doorX: number;
  theme: MapDef['theme'];
  /** İçerisi görünsün mü (karakter evde ya da içerisi düzenleniyor) */
  open: boolean;
  night: boolean;
  /** Kapalı eve dokununca (karakter kapıya yürür) */
  onClick: () => void;
}

/** Dış duvarlar: karoların güney ve doğu kenarları, birleşik parçalar (ön kapının karosu boş) */
function outerWalls(cells: Set<string>, door: { x: number; y: number }) {
  const has = (x: number, y: number) => cells.has(`${x},${y}`);
  const south = new Map<number, number[]>();
  const east = new Map<number, number[]>();
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number);
    if (!has(x, y + 1) && !(x === door.x && y === door.y)) south.set(y + 1, [...(south.get(y + 1) ?? []), x]);
    if (!has(x + 1, y)) east.set(x + 1, [...(east.get(x + 1) ?? []), y]);
  }
  const runs = (m: Map<number, number[]>) => {
    const out: { at: number; a: number; b: number }[] = [];
    for (const [at, list] of m) {
      const xs = [...list].sort((p, q) => p - q);
      let a = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === xs[i - 1] + 1) continue;
        out.push({ at, a, b: xs[i - 1] + 1 });
        a = xs[i];
      }
    }
    return out;
  };
  return { south: runs(south), east: runs(east) };
}

export default function HouseShell({ w, h, cells, houseW, annex, doorX, theme, open, night, onClick }: HouseShellProps) {
  const k = useRef(open ? 1 : 0);
  const front = useRef<Group>(null);
  const top = useRef<Group>(null);
  // Çatılar ve üst kat aynı malzemeyi paylaşır (birlikte silikleşir)
  const roofMat = useMemo(() => new MeshStandardMaterial({ color: theme.roof, flatShading: true, transparent: true }), [theme.roof]);
  const upperMat = useMemo(() => new MeshStandardMaterial({ color: theme.wall, transparent: true }), [theme.wall]);
  const invalidate = useThree((s) => s.invalidate);
  const floors = Math.max(1, theme.floors);
  const upper = (floors - 1) * FLOOR_H;
  const roofH = Math.min(3, h * 0.3);
  const roof = useMemo(() => {
    const s = new Shape();
    s.moveTo(-h / 2 - 0.35, 0);
    s.lineTo(0, roofH);
    s.lineTo(h / 2 + 0.35, 0);
    s.lineTo(-h / 2 - 0.35, 0);
    const g = new ExtrudeGeometry(s, { depth: w + 0.5, bevelEnabled: false });
    g.translate(0, 0, -(w + 0.5) / 2);
    return g;
  }, [w, h, roofH]);

  // Açılıp kapanma: ~300 ms'de yumuşak geçiş, bitince kare istemez
  useFrame((_, dt) => {
    const want = open ? 1 : 0;
    const d = want - k.current;
    if (Math.abs(d) > 0.001) {
      k.current += Math.sign(d) * Math.min(Math.abs(d), Math.min(dt, 0.05) * 3.5);
      invalidate();
    } else k.current = want;
    const v = k.current;
    if (front.current) front.current.scale.y = 1 - v * (1 - LOW / WALL_H);
    if (top.current) top.current.visible = v < 0.98;
    roofMat.opacity = 1 - v;
    upperMat.opacity = 1 - v;
  });

  const tap = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e) || open) return;
    e.stopPropagation();
    onClick();
  };

  const glass = night ? '#ffd98a' : '#a8dcff';
  const walls = useMemo(() => outerWalls(cells, { x: doorX, y: h - 1 }), [cells, doorX, h]);
  // Ön duvarlarda pencereler (kapının yanı hariç)
  const frontWindows = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    for (const r of walls.south) for (let x = r.a + 1.5; x < r.b - 1; x += 3) if (r.at !== h || Math.abs(x - (doorX + 0.5)) > 1.2) out.push({ x, z: r.at });
    return out;
  }, [walls, doorX, h]);

  return (
    <group onClick={tap}>
      {/* Arka ve sol duvarın dış yüzü */}
      <mesh position={[houseW / 2, WALL_H / 2, -T - 0.02]} castShadow>
        <boxGeometry args={[houseW + T * 2, WALL_H, 0.04]} />
        <meshStandardMaterial color={theme.wall} />
      </mesh>
      <mesh position={[-T - 0.02, WALL_H / 2, h / 2]} castShadow>
        <boxGeometry args={[0.04, WALL_H, h + T * 2]} />
        <meshStandardMaterial color={theme.wall} />
      </mesh>
      {/* Güney ve doğu dış duvarları (karoların kenarından): içerisi görünürken alçalır */}
      <group ref={front}>
        {walls.south.map((r) => (
          <mesh key={`s${r.at},${r.a}`} position={[(r.a + r.b) / 2, WALL_H / 2, r.at + T / 2]} castShadow receiveShadow>
            <boxGeometry args={[r.b - r.a, WALL_H, T]} />
            <meshStandardMaterial color={theme.wall} />
          </mesh>
        ))}
        {walls.east.map((r) => (
          <mesh key={`e${r.at},${r.a}`} position={[r.at + T / 2, WALL_H / 2, (r.a + r.b + T) / 2]} castShadow receiveShadow>
            <boxGeometry args={[T, WALL_H, r.b - r.a + T]} />
            <meshStandardMaterial color={theme.wall} />
          </mesh>
        ))}
        {/* Kapı kasası */}
        {[doorX, doorX + 1].map((x) => (
          <mesh key={x} position={[x, WALL_H / 2, h + T / 2]}>
            <boxGeometry args={[0.1, WALL_H, T + 0.04]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
        ))}
        {frontWindows.map(({ x, z }) => (
          <mesh key={`${x},${z}`} position={[x, 1.45, z + T + 0.01]}>
            <boxGeometry args={[0.9, 0.8, 0.04]} />
            <meshStandardMaterial color={glass} emissive={glass} emissiveIntensity={night ? 0.6 : 0.2} />
          </mesh>
        ))}
      </group>
      <group ref={top}>
        {/* Kapının üstü (lento) ve aralık kapı kanadı */}
        <mesh position={[doorX + 0.5, WALL_H - 0.3, h + T / 2]}>
          <boxGeometry args={[1, 0.6, T]} />
          <meshStandardMaterial color={theme.wall} />
        </mesh>
        <mesh position={[doorX + 0.08, 0.95, h + 0.4]} rotation-y={-1.25}>
          <boxGeometry args={[0.82, 1.9, 0.06]} />
          <meshStandardMaterial color="#a8693f" />
        </mesh>
        {/* Üst katlar ve çatı */}
        {upper > 0 && (
          <mesh position={[w / 2, WALL_H + upper / 2, h / 2]} material={upperMat} castShadow>
            <boxGeometry args={[w + T * 2, upper, h + T * 2]} />
          </mesh>
        )}
        <mesh geometry={roof} position={[w / 2, WALL_H + upper, h / 2]} rotation-y={Math.PI / 2} material={roofMat} castShadow />
        {/* Eklenen odaların düz çatısı */}
        {annex.map(([x, y, aw, ah]) => (
          <mesh key={`${x},${y}`} position={[x + aw / 2, WALL_H + 0.09, y + ah / 2]} material={roofMat} castShadow>
            <boxGeometry args={[aw + T * 2, 0.18, ah + T * 2]} />
          </mesh>
        ))}
        <mesh position={[w * 0.75, WALL_H + upper + roofH * 0.6, h * 0.3]} castShadow>
          <boxGeometry args={[0.5, 1.2, 0.5]} />
          <meshStandardMaterial color="#b0563f" />
        </mesh>
      </group>
    </group>
  );
}
