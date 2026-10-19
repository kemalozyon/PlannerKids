// Habbo'daki gibi oyun eşyaları (kodla çizilir; bkz. Sets.tsx): havuz parçaları (su, kenar, köşe, merdiven) ve atlama
// tahtası, ışınlayıcı, dev zar, yürüyen bant, futbol topu, müzik karosu. Havuz parçaları zemin katmanındadır (yan yana
// döşenince tek havuz olur); suya giren karakter batıp yüzer (Avatar.tsx). Zar yalnızca atılınca, top yalnızca
// yuvarlanırken kare ister; geri kalan her şey durağandır.
import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector3, type Group } from 'three';
import { B, C, S, type Piece, type V3 } from './setParts';
import { reducedMotion } from './motion';

/** Havuz suyu: koyu taban, üstünde hafif parlayan yarı saydam su */
function Water({ a }: { a: string }) {
  return (
    <>
      <mesh position={[0, 0.012, 0]} receiveShadow>
        <boxGeometry args={[1, 0.024, 1]} />
        <meshStandardMaterial color="#1f6f9f" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.032, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color={a} transparent opacity={0.82} roughness={0.15} metalness={0.1} emissive={a} emissiveIntensity={0.25} />
      </mesh>
      {/* Su yüzündeki ışık çizgileri */}
      {[-0.28, 0.06, 0.32].map((z, i) => (
        <mesh key={i} position={[(i - 1) * 0.18, 0.034, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.34, 0.025]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.45} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** Havuz kenarı (taş bordür): karonun arka (−z) ya da sol (−x) kenarında */
const Coping = ({ side, c }: { side: 'back' | 'left'; c: string }) =>
  side === 'back' ? <B p={[0, 0.06, -0.41]} s={[1, 0.12, 0.18]} c={c} /> : <B p={[-0.41, 0.06, 0]} s={[0.18, 0.12, 1]} c={c} />;

// Zarın yüzleri: hangi yüz üstteyse (1…6) küpün dönüşü; karşılıklı yüzlerin toplamı 7
const FACE_ROT: Record<number, V3> = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] };
const PIP_AT: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
// Her yüzün normali ve iki yüzey yönü (n, u, v)
const FACES: Record<number, [V3, V3, V3]> = {
  1: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  6: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  2: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  5: [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
  3: [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
  4: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
};
const DIE = 0.5;
const PIPS = Object.entries(PIP_AT).flatMap(([f, list]) => {
  const [n, u, v] = FACES[+f];
  return list.map(([a, b]): V3 => [0, 1, 2].map((k) => n[k] * (DIE / 2 - 0.012) + (u[k] * a + v[k] * b) * 0.13) as V3);
});

/** Dev zar: atış sayacı değişince 0.8 sn yuvarlanır, sonra `value` yüzü üstte durur */
function Dice({ value = 1, tick = 0, a, b }: { value?: number; tick?: number; a: string; b: string }) {
  const g = useRef<Group>(null);
  const last = useRef(tick);
  const t0 = useRef(-1);
  const invalidate = useThree((s) => s.invalidate);
  const rot = FACE_ROT[value] ?? FACE_ROT[1];
  useFrame(({ clock }) => {
    const m = g.current;
    if (!m) return;
    if (last.current !== tick) {
      last.current = tick;
      t0.current = reducedMotion() ? -1 : clock.elapsedTime;
    }
    if (t0.current < 0) return;
    const k = (clock.elapsedTime - t0.current) / 0.8;
    if (k >= 1) {
      t0.current = -1;
      m.rotation.set(...rot);
      m.position.y = DIE / 2;
    } else {
      const e = (1 - k) ** 2;
      m.rotation.set(rot[0] + e * 9, e * 6, rot[2] + e * 7);
      m.position.y = DIE / 2 + Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 0.45;
    }
    invalidate();
  });
  return (
    <group ref={g} position={[0, DIE / 2, 0]} rotation={rot}>
      <B p={[0, 0, 0]} s={[DIE, DIE, DIE]} c={a} />
      {PIPS.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.042, 10, 8]} />
          <meshStandardMaterial color={b} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

const BALL_R = 0.17;
/** Futbol topu: yeri değişince (vurulunca kayarak gider) gittiği yöne yuvarlanır */
function Football({ a, b }: { a: string; b: string }) {
  const g = useRef<Group>(null);
  const prev = useRef<Vector3 | null>(null);
  const now = useRef(new Vector3());
  useFrame(() => {
    const m = g.current;
    if (!m) return;
    m.getWorldPosition(now.current);
    if (prev.current) {
      const dx = now.current.x - prev.current.x;
      const dz = now.current.z - prev.current.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
        m.rotation.x += dz / BALL_R;
        m.rotation.z -= dx / BALL_R;
      }
      prev.current.copy(now.current);
    } else prev.current = now.current.clone();
  });
  return (
    <group ref={g} position={[0, BALL_R, 0]}>
      <S p={[0, 0, 0]} r={BALL_R} c={a} />
      {/* Siyah beşgen lekeler */}
      {[
        [0, 1, 0],
        [0, -1, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x * BALL_R * 0.93, y * BALL_R * 0.93, z * BALL_R * 0.93]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color={b} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export const PLAY_PIECES: Record<string, Piece> = {
  // ---------- Havuz (parçalar yan yana döşenir) ----------
  poolwater: {
    top: 0.04,
    draw: ({ a }) => <Water a={a} />,
  },
  pooledge: {
    top: 0.04,
    draw: ({ a, b }) => (
      <>
        <Water a={a} />
        <Coping side="back" c={b} />
      </>
    ),
  },
  poolcorner: {
    top: 0.04,
    draw: ({ a, b }) => (
      <>
        <Water a={a} />
        <Coping side="back" c={b} />
        <Coping side="left" c={b} />
      </>
    ),
  },
  poolladder: {
    top: 0.04,
    draw: ({ a, b, c }) => (
      <>
        <Water a={a} />
        <Coping side="back" c={b} />
        {[-0.2, 0.2].map((x) => (
          <group key={x}>
            <C p={[x, 0.42, -0.3]} r={0.025} h={0.84} c={c} />
            <B p={[x, 0.84, -0.4]} s={[0.05, 0.05, 0.2]} c={c} />
          </group>
        ))}
        {[0.2, 0.42, 0.64].map((y) => (
          <B key={y} p={[0, y, -0.3]} s={[0.4, 0.035, 0.05]} c={c} />
        ))}
      </>
    ),
  },
  divingboard: {
    top: 0.56,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.26, -0.22]} s={[0.5, 0.52, 0.46]} c={b} />
        {/* Tahta önündeki havuzun üstüne uzanır */}
        <B p={[0, 0.55, 0.28]} s={[0.36, 0.06, 1.3]} c={a} />
        <B p={[0, 0.585, 0.88]} s={[0.36, 0.012, 0.1]} c="#ffffff" line={false} />
      </>
    ),
  },
  // ---------- Işınlayıcı ----------
  teleporter: {
    top: 0,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.06, 0]} r={0.44} h={0.12} c={b} />
        <mesh position={[0, 0.125, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.36, 24]} />
          <meshStandardMaterial color={a} emissive={a} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
        {/* Cam tüp */}
        <mesh position={[0, 1.02, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 1.8, 24, 1, true]} />
          <meshStandardMaterial color="#bfefff" transparent opacity={0.22} roughness={0.05} depthWrite={false} side={2} />
        </mesh>
        {[-1, 1].map((s) => (
          <B key={s} p={[s * 0.4, 1.02, 0]} s={[0.06, 1.8, 0.06]} c={b} />
        ))}
        <C p={[0, 1.98, 0]} r={0.46} h={0.16} c={b} />
        <mesh position={[0, 1.88, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.4, 0.035, 8, 28]} />
          <meshStandardMaterial color={a} emissive={a} emissiveIntensity={1.2} toneMapped={false} />
        </mesh>
      </>
    ),
  },
  // ---------- Oyunlar ----------
  dice: {
    top: 0.5,
    draw: ({ a, b, value, tick }) => <Dice value={value} tick={tick} a={a} b={b} />,
  },
  conveyor: {
    top: 0.12,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.05, 0]} s={[0.96, 0.1, 0.96]} c={c} />
        {[-1, 1].map((s) => (
          <B key={s} p={[s * 0.44, 0.1, 0]} s={[0.08, 0.06, 0.96]} c={b} />
        ))}
        <mesh position={[0, 0.102, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.8, 0.94]} />
          <meshStandardMaterial color="#3a3f47" roughness={0.9} />
        </mesh>
        {/* Gidiş yönü (+z, önü) okları */}
        {[-0.28, 0.04, 0.36].map((z) => (
          <group key={z} position={[0, 0.106, z]}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.11, 0, -0.04]} rotation={[-Math.PI / 2, 0, s * 0.8]}>
                <planeGeometry args={[0.05, 0.3]} />
                <meshBasicMaterial color={a} toneMapped={false} />
              </mesh>
            ))}
          </group>
        ))}
      </>
    ),
  },
  football: {
    top: 0,
    draw: ({ a, b }) => <Football a={a} b={b} />,
  },
  soundtile: {
    top: 0.06,
    draw: ({ a }) => (
      <>
        <B p={[0, 0.02, 0]} s={[0.96, 0.04, 0.96]} c="#2b2622" line={false} />
        <mesh position={[0, 0.045, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.84, 0.84]} />
          <meshStandardMaterial color={a} emissive={a} emissiveIntensity={0.55} />
        </mesh>
        {/* Nota işareti */}
        <mesh position={[-0.06, 0.05, 0.1]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.09, 16]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh position={[0.02, 0.05, -0.06]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.035, 0.32]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      </>
    ),
  },
};
