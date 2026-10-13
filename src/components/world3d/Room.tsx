// Odanın kabuğu: dama zemin, arkadaki iki duvar (kaplama rengiyle), kapılar ve pencere.
// Kamera öndeki köşeden baktığı için yalnızca arka duvarlar çizilir (izometrik oda).
import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import type { Item } from '../../lib/catalog';
import type { FixedTile } from '../../lib/config';
import { rng } from '../../lib/rng';
import { isTap } from './light';

const WALL_H = 2.4;
const T = 0.14;

export default function Room({
  w,
  h,
  floor,
  wall,
  doors,
  onDoor,
}: {
  w: number;
  h: number;
  floor: Item | undefined;
  wall: Item | undefined;
  doors: FixedTile[];
  onDoor: (d: FixedTile) => void;
}) {
  const c1 = floor?.color ?? '#c89a6a';
  const c2 = floor?.color2 ?? c1;
  const wc = wall?.color ?? '#f3e6cf';
  const leftDoor = doors.some((d) => d.x === 0);
  return (
    <group>
      <Checker w={w} h={h} c1={c1} c2={c2} />
      {/* Arka duvar (z = 0) ve sol duvar (x = 0) */}
      <mesh position={[w / 2, WALL_H / 2, -T / 2]} receiveShadow>
        <boxGeometry args={[w + T, WALL_H, T]} />
        <meshStandardMaterial color={wc} />
      </mesh>
      <mesh position={[-T / 2, WALL_H / 2, h / 2]} receiveShadow>
        <boxGeometry args={[T, WALL_H, h]} />
        <meshStandardMaterial color={new Color(wc).multiplyScalar(0.9)} />
      </mesh>
      {/* Süpürgelik */}
      <mesh position={[w / 2, 0.06, 0.01]}>
        <boxGeometry args={[w, 0.12, 0.03]} />
        <meshStandardMaterial color="#8a6a4a" />
      </mesh>
      <mesh position={[0.01, 0.06, h / 2]}>
        <boxGeometry args={[0.03, 0.12, h]} />
        <meshStandardMaterial color="#8a6a4a" />
      </mesh>
      {wall?.stars && <WallStars w={w} h={h} />}
      {/* Pencere (sol duvarda, kapı yoksa ortada) */}
      <group position={[0.02, 1.35, leftDoor ? 2 : h / 2]}>
        <mesh>
          <boxGeometry args={[0.04, 1, 1.4]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.02, 0, 0]}>
          <boxGeometry args={[0.03, 0.86, 1.26]} />
          <meshStandardMaterial color="#a8dcff" emissive="#a8dcff" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0.04, 0, 0]}>
          <boxGeometry args={[0.02, 0.86, 0.05]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>
      {doors.map((d) => (
        <Door key={`${d.x},${d.y}`} d={d} onDoor={onDoor} />
      ))}
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
  const pos: [number, number, number] = onBack ? [d.x + 0.5, 0.9, 0.02] : [0.02, 0.9, d.y + 0.5];
  return (
    <group position={pos} rotation-y={onBack ? 0 : Math.PI / 2} onClick={click}>
      <mesh>
        <boxGeometry args={[0.92, 1.8, 0.05]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[0.78, 1.68, 0.03]} />
        <meshStandardMaterial color={d.to === 'library' ? '#8b5cf6' : '#b07a4a'} />
      </mesh>
      <mesh position={[0.28, -0.05, 0.06]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#ffd54a" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Kapının önündeki paspas: dışarıya ya da kütüphaneye götürür */}
      <mesh position={[0, -0.88, 0.5]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial color={d.to === 'library' ? '#c9b6ff' : '#9fd39a'} />
      </mesh>
    </group>
  );
}

function Checker({ w, h, c1, c2 }: { w: number; h: number; c1: string; c2: string }) {
  const ref = useRef<InstancedMesh>(null);
  const count = Math.ceil((w * h) / 2);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    let i = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if ((x + y) % 2) continue;
        o.position.set(x + 0.5, 0.001, y + 0.5);
        o.rotation.x = -Math.PI / 2;
        o.updateMatrix();
        m.setMatrixAt(i++, o.matrix);
      }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
  }, [w, h]);
  return (
    <group>
      <mesh position={[w / 2, -0.05, h / 2]} receiveShadow>
        <boxGeometry args={[w, 0.1, h]} />
        <meshStandardMaterial color={c2} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, count]} receiveShadow>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color={c1} />
      </instancedMesh>
    </group>
  );
}

/** Yıldızlı gece duvarı */
function WallStars({ w, h }: { w: number; h: number }) {
  const stars = useMemo(() => {
    const r = rng('duvar-yildiz');
    return Array.from({ length: 26 }, (_, i) =>
      i % 2 ? ([r() * w, 0.4 + r() * (WALL_H - 0.6), 0.015] as const) : ([0.015, 0.4 + r() * (WALL_H - 0.6), r() * h] as const),
    );
  }, [w, h]);
  return (
    <group>
      {stars.map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <sphereGeometry args={[0.035, 6, 4]} />
          <meshBasicMaterial color="#fff6c8" />
        </mesh>
      ))}
    </group>
  );
}
