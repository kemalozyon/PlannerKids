// Kodla çizilen işlevli eşyalar: salıncak (karakter oturunca sallanır), şömine ve ateş alevi (yakınca titrer,
// sıcak bir ışık saçar). Ayak izinin ortasında, önleri yerel +z'ye bakar (items.tsx → ItemModel döndürür).
// Sahne istek üzerine çizildiğinden (frameloop="demand") alev yanarken ~12 kare/sn kare istenir.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { Group, PointLight } from 'three';

/** Salıncağın ipi (kirişten oturağa) */
export const SWING_ROPE = 1.5;
const BEAM = 2.05;

/** Sallanma açısı: karakter ve oturak aynı saati kullanır */
export const swingAngle = (t: number) => Math.sin(t * 2.4) * 0.5;

export function Swing({ active }: { active?: boolean }) {
  const seat = useRef<Group>(null);
  const wood = '#a8743f';
  useFrame(({ clock }) => {
    if (!seat.current) return;
    seat.current.rotation.x = active ? -swingAngle(clock.elapsedTime) : 0;
  });
  return (
    <group>
      {/* A biçimli iki ayak ve kiriş */}
      {[-0.92, 0.92].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, BEAM / 2, s * 0.22]} rotation-x={s * 0.22} castShadow>
              <boxGeometry args={[0.1, BEAM + 0.1, 0.1]} />
              <meshStandardMaterial color={wood} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, BEAM, 0]} castShadow>
        <boxGeometry args={[1.95, 0.1, 0.12]} />
        <meshStandardMaterial color={wood} />
      </mesh>
      {/* İpler ve oturak: kirişten sarkar */}
      <group ref={seat} position={[0, BEAM, 0]}>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, -SWING_ROPE / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.012, SWING_ROPE, 5]} />
            <meshStandardMaterial color="#e8dcc0" />
          </mesh>
        ))}
        <mesh position={[0, -SWING_ROPE, 0]} castShadow>
          <boxGeometry args={[0.7, 0.06, 0.3]} />
          <meshStandardMaterial color="#ef476f" />
        </mesh>
      </group>
    </group>
  );
}

export function Fireplace({ on }: { on: boolean }) {
  const stone = '#b9aa98';
  const mat = (c: string) => <meshStandardMaterial color={c} flatShading />;
  return (
    <group position={[0, 0, -0.18]}>
      {/* Gövde: iki yan, üst, arka */}
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.45, 1.2, 0.6]} />
          {mat(stone)}
        </mesh>
      ))}
      <mesh position={[0, 1.02, 0]} castShadow>
        <boxGeometry args={[1.05, 0.36, 0.6]} />
        {mat(stone)}
      </mesh>
      <mesh position={[0, 0.45, -0.25]}>
        <boxGeometry args={[1.05, 0.9, 0.1]} />
        {mat('#3a2e28')}
      </mesh>
      {/* Ocak tabanı ve rafı */}
      <mesh position={[0, 0.04, 0.05]} receiveShadow>
        <boxGeometry args={[1.9, 0.08, 0.75]} />
        {mat('#8f8274')}
      </mesh>
      <mesh position={[0, 1.24, 0.03]} castShadow>
        <boxGeometry args={[2.05, 0.1, 0.72]} />
        {mat('#7a5230')}
      </mesh>
      {/* Baca */}
      <mesh position={[0, 1.9, -0.12]} castShadow>
        <boxGeometry args={[0.85, 1.2, 0.36]} />
        {mat(stone)}
      </mesh>
      {/* Odunlar */}
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 0.14, 0]} rotation={[0, x * 2, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.5, 6]} />
          {mat('#6b4a2f')}
        </mesh>
      ))}
      {on && <Flame y={0.16} light />}
    </group>
  );
}

/**
 * Titreyen alev: üç koni, sıcak renkli; `light` açıksa sıcak bir nokta ışığı. Görünürken ~12 kare/sn kare ister.
 */
export function Flame({ y = 0.1, scale = 1, light }: { y?: number; scale?: number; light?: boolean }) {
  const g = useRef<Group>(null);
  const lamp = useRef<PointLight>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && invalidate(), 80);
    return () => clearInterval(id);
  }, [invalidate]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    g.current?.children.forEach((c, i) => {
      const k = 1 + Math.sin(t * (9 + i * 3) + i * 2) * 0.16;
      c.scale.set(1, k, 1);
    });
    if (lamp.current) lamp.current.intensity = 3.2 + Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.4;
  });
  return (
    <group position={[0, y, 0]} scale={scale}>
      <group ref={g}>
        {[
          ['#ff7a1a', 0.17, 0.42, 0],
          ['#ffb347', 0.12, 0.34, 0.06],
          ['#ffe08a', 0.07, 0.24, -0.05],
        ].map(([c, r, h, dx], i) => (
          <mesh key={i} position={[dx as number, (h as number) / 2, 0]}>
            <coneGeometry args={[r as number, h as number, 7]} />
            <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={1.4} toneMapped={false} transparent opacity={0.92} />
          </mesh>
        ))}
      </group>
      {light && <pointLight ref={lamp} position={[0, 0.5, 0.3]} color="#ff9a3c" intensity={3.2} distance={5} decay={1.6} />}
    </group>
  );
}
