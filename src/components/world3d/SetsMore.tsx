// Kataloğun ikinci yarısının set parçaları (Habbo tarzı, kodla çizilir; bkz. Sets.tsx): oturma ve yatak çeşitleri,
// depolar (sandık, gardırop, çekmece: kapakları açılır), ışıklar (avize, mum, neon, disko topu, lav lambası),
// ikram makineleri, eğlence (bilardo, arcade, dans pisti, piyano, müzik kutusu, davul, langırt, gitar), bahçe
// (havuz, çeşme, şemsiye, hamak), evcil köşe, mimari ve bitkiler.
// Hareketli parçalar (PLAY_ANIMATION) yalnızca açıkken (`on`) oynar ve o sırada kare ister; kapalıyken sahne
// "istek üzerine" çizilmeye devam eder.
import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import { B, C, legs, S, type Piece } from './setParts';

/** Açıkken her karede çalışan hareket; kare ister (frameloop="demand") */
function useTick(on: boolean, f: (t: number) => void) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    if (!on) return;
    f(clock.elapsedTime);
    invalidate();
  });
}

/** Açıkken döner */
function Spin({ on, speed = 1, children, y = 0 }: { on: boolean; speed?: number; children: ReactNode; y?: number }) {
  const g = useRef<Group>(null);
  useTick(on, (t) => g.current && (g.current.rotation.y = t * speed));
  return (
    <group ref={g} position-y={y}>
      {children}
    </group>
  );
}

/** Açıkken aşağı yukarı gider */
function Bob({ on, amp = 0.05, freq = 2, phase = 0, children }: { on: boolean; amp?: number; freq?: number; phase?: number; children: ReactNode }) {
  const g = useRef<Group>(null);
  useTick(on, (t) => g.current && (g.current.position.y = Math.sin(t * freq + phase) * amp));
  return <group ref={g}>{children}</group>;
}

/** Açıkken rengi sırayla değişen parlak kutu (dans pisti, arcade ekranı) */
function Cycle({ on, colors, p, s, phase = 0, speed = 2 }: { on: boolean; colors: string[]; p: [number, number, number]; s: [number, number, number]; phase?: number; speed?: number }) {
  const m = useRef<MeshStandardMaterial>(null);
  useTick(on, (t) => {
    const c = colors[Math.floor(t * speed + phase) % colors.length];
    m.current?.color.set(c);
    m.current?.emissive.set(c);
  });
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial ref={m} color={colors[phase % colors.length]} emissive={on ? colors[phase % colors.length] : '#000000'} emissiveIntensity={on ? 0.7 : 0} />
    </mesh>
  );
}

/** Açıkken masada gidip gelen top (bilardo) */
function Roll({ on, w, d, c }: { on: boolean; w: number; d: number; c: string }) {
  const m = useRef<Mesh>(null);
  useTick(on, (t) => m.current?.position.set(Math.sin(t * 1.3) * (w / 2 - 0.25), 0.84, Math.sin(t * 1.9) * (d / 2 - 0.25)));
  return (
    <mesh ref={m} position={[0.2, 0.84, 0]}>
      <sphereGeometry args={[0.05, 10, 8]} />
      <meshStandardMaterial color={c} />
    </mesh>
  );
}

const NEON = ['#ff4fa3', '#4fd8ff', '#b6ff4f', '#ffd84f', '#b07cff'];

export const MORE_PIECES: Record<string, Piece> = {
  // ---------- Oturma ve yatak ----------
  pouf: {
    top: 0.42,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.2, 0]} r={0.34} r2={0.3} h={0.4} c={a} />
        <C p={[0, 0.41, 0]} r={0.31} h={0.04} c={b} />
      </>
    ),
  },
  throne: {
    top: 0.5,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.06, 0]} s={[0.9, 0.12, 0.9]} c={c} />
        <B p={[0, 0.3, 0.04]} s={[0.78, 0.36, 0.74]} c={b} />
        <B p={[0, 0.5, 0.08]} s={[0.6, 0.08, 0.56]} c={a} />
        <B p={[0, 1.05, -0.33]} s={[0.78, 1.2, 0.14]} c={b} />
        <B p={[0, 1.0, -0.25]} s={[0.5, 0.9, 0.04]} c={a} />
        {[-0.3, 0, 0.3].map((x) => (
          <S key={x} p={[x, 1.72, -0.33]} r={0.07} c={c} />
        ))}
        {[-1, 1].map((s) => (
          <B key={s} p={[s * 0.36, 0.62, 0.04]} s={[0.1, 0.26, 0.7]} c={c} />
        ))}
      </>
    ),
  },
  cornersofa: {
    top: 0.45,
    draw: ({ w, d, a, b }) => (
      <>
        <B p={[0, 0.22, -d / 2 + 0.42]} s={[w - 0.1, 0.32, 0.8]} c={a} />
        <B p={[-w / 2 + 0.42, 0.22, 0.2]} s={[0.8, 0.32, d - 0.9]} c={a} />
        <B p={[0.15, 0.42, -d / 2 + 0.46]} s={[w - 0.6, 0.1, 0.62]} c={b} />
        <B p={[-w / 2 + 0.46, 0.42, 0.25]} s={[0.62, 0.1, d - 1.1]} c={b} />
        <B p={[0, 0.62, -d / 2 + 0.11]} s={[w - 0.1, 0.62, 0.2]} c={a} />
        <B p={[-w / 2 + 0.11, 0.62, 0.05]} s={[0.2, 0.62, d - 0.3]} c={a} />
      </>
    ),
  },
  deskchair: {
    top: 0.5,
    draw: ({ a, b }) => (
      <>
        {[0, 1, 2, 3, 4].map((i) => (
          <B key={i} p={[Math.sin((i * 2 * Math.PI) / 5) * 0.18, 0.04, Math.cos((i * 2 * Math.PI) / 5) * 0.18]} s={[0.07, 0.06, 0.07]} c={b} />
        ))}
        <C p={[0, 0.25, 0]} r={0.04} h={0.4} c={b} />
        <B p={[0, 0.48, 0]} s={[0.56, 0.1, 0.54]} c={a} />
        <B p={[0, 0.86, -0.25]} s={[0.5, 0.6, 0.08]} c={a} />
      </>
    ),
  },
  lounger: {
    top: 0.35,
    draw: ({ d, a, b }) => (
      <>
        {legs(0.6, d - 0.3, 0.2, b, 0.05)}
        <B p={[0, 0.25, 0.15]} s={[0.66, 0.08, d - 0.6]} c={a} />
        <group position={[0, 0.28, -d / 2 + 0.45]} rotation-x={0.6}>
          <B p={[0, 0, -0.15]} s={[0.66, 0.08, 0.6]} c={a} />
        </group>
      </>
    ),
  },
  bunk: {
    top: 0.5,
    draw: ({ d, a, b, c }) => (
      <>
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} p={[sx * 0.44, 0.95, sz * (d / 2 - 0.06)]} s={[0.08, 1.9, 0.08]} c={a} />))}
        {[0.3, 1.3].map((y) => (
          <group key={y}>
            <B p={[0, y, 0]} s={[0.84, 0.14, d - 0.16]} c={a} />
            <B p={[0, y + 0.11, 0.05]} s={[0.78, 0.1, d - 0.3]} c={b} />
            <B p={[0, y + 0.18, -d / 2 + 0.3]} s={[0.56, 0.08, 0.26]} c="#ffffff" />
            <B p={[0, y + 0.17, 0.3]} s={[0.8, 0.05, d / 2]} c={c} />
          </group>
        ))}
        <B p={[0.47, 1.58, 0]} s={[0.04, 0.2, d - 0.2]} c={a} />
        {[0.5, 0.8, 1.1].map((y) => (
          <B key={y} p={[0.5, y, d / 2 - 0.2]} s={[0.04, 0.04, 0.3]} c={a} />
        ))}
      </>
    ),
  },
  dbed: {
    top: 0.5,
    draw: ({ w, d, a, b, c }) => (
      <>
        <B p={[0, 0.17, 0]} s={[w - 0.1, 0.3, d - 0.08]} c={a} />
        <B p={[0, 0.38, 0.06]} s={[w - 0.16, 0.14, d - 0.24]} c={b} />
        {[-1, 1].map((s) => (
          <B key={s} p={[s * (w / 4), 0.48, -d / 2 + 0.3]} s={[w / 2 - 0.2, 0.1, 0.3]} c="#ffffff" />
        ))}
        <B p={[0, 0.46, 0.35]} s={[w - 0.14, 0.06, d / 2 + 0.1]} c={c} />
        <B p={[0, 0.6, -d / 2 + 0.06]} s={[w - 0.02, 0.9, 0.1]} c={a} />
      </>
    ),
  },
  hammock: {
    top: 0.6,
    draw: ({ w, a, b }) => (
      <>
        {[-1, 1].map((s) => (
          <group key={s}>
            <C p={[(s * (w - 0.1)) / 2, 0.7, 0]} r={0.05} h={1.4} c={b} />
            <B p={[(s * (w - 0.6)) / 2, 0.85, 0]} s={[0.5, 0.03, 0.03]} c="#d9c6a3" line={false} />
          </group>
        ))}
        <mesh position={[0, 0.62, 0]} rotation-z={Math.PI / 2} scale={[1, 1, 0.55]}>
          <cylinderGeometry args={[0.18, 0.18, w - 0.6, 16, 1, true, Math.PI, Math.PI]} />
          <meshStandardMaterial color={a} side={2} />
        </mesh>
      </>
    ),
  },
  // ---------- Depolama (kapaklar açılır) ----------
  chest: {
    top: 0.6,
    draw: ({ w, a, b, c, open }) => (
      <>
        <B p={[0, 0.25, 0]} s={[w - 0.16, 0.46, 0.6]} c={a} />
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.3)) / 2, 0.25, 0.31]} s={[0.06, 0.46, 0.02]} c={b} line={false} />
        ))}
        {open && <B p={[0, 0.44, 0]} s={[w - 0.26, 0.04, 0.5]} c="#5a3a20" line={false} />}
        <group position={[0, 0.48, -0.3]} rotation-x={open ? -1.9 : 0}>
          <B p={[0, 0.06, 0.3]} s={[w - 0.14, 0.12, 0.62]} c={a} />
          <B p={[0, 0.03, 0.61]} s={[0.12, 0.12, 0.04]} c={c} />
        </group>
      </>
    ),
  },
  wardrobe: {
    top: 1.95,
    draw: ({ w, a, b, c, open }) => (
      <>
        <B p={[0, 0.98, -0.04]} s={[w - 0.08, 1.95, 0.66]} c={a} />
        <B p={[0, 1.98, -0.04]} s={[w, 0.06, 0.72]} c={b} />
        {open && (
          <>
            <B p={[0, 0.98, 0.28]} s={[w - 0.2, 1.8, 0.02]} c="#3a2a1c" line={false} />
            <C p={[0, 1.6, 0.2]} r={0.02} h={w - 0.3} c={c} />
            {['#ef476f', '#118ab2', '#ffd166'].map((col, i) => (
              <B key={col} p={[-0.4 + i * 0.4, 1.25, 0.2]} s={[0.3, 0.6, 0.06]} c={col} />
            ))}
          </>
        )}
        {[-1, 1].map((s) => (
          <group key={s} position={[(s * (w - 0.08)) / 2, 0, 0.3]} rotation-y={open ? s * 1.7 : 0}>
            <B p={[(-s * (w - 0.08)) / 4, 0.98, 0.02]} s={[(w - 0.1) / 2, 1.85, 0.04]} c={a} />
            <B p={[(-s * (w - 0.2)) / 2 + s * 0.02, 1.0, 0.06]} s={[0.04, 0.24, 0.04]} c={c} />
          </group>
        ))}
      </>
    ),
  },
  drawers: {
    top: 0.95,
    draw: ({ w, a, b, c, open }) => (
      <>
        <B p={[0, 0.47, -0.04]} s={[w - 0.08, 0.92, 0.66]} c={a} />
        <B p={[0, 0.95, -0.04]} s={[w, 0.05, 0.7]} c={b} />
        {[0.18, 0.45, 0.72].map((y, i) => (
          <group key={y} position={[0, y, open && i === 1 ? 0.25 : 0]}>
            <B p={[0, 0, 0.3]} s={[w - 0.18, 0.22, 0.04]} c={b} />
            <B p={[0, 0, 0.34]} s={[0.2, 0.04, 0.04]} c={c} />
          </group>
        ))}
      </>
    ),
  },
  // ---------- Işıklar ----------
  chandelier: {
    top: 0,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 2.35, 0]} r={0.015} h={0.5} c={b} />
        <C p={[0, 2.1, 0]} r={0.36} r2={0.12} h={0.12} c={a} />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const x = Math.cos((i * Math.PI) / 3) * 0.34;
          const z = Math.sin((i * Math.PI) / 3) * 0.34;
          return (
            <group key={i}>
              <C p={[x, 2.16, z]} r={0.035} h={0.12} c="#fff8e6" />
              <S p={[x, 2.27, z]} r={0.035} c={on ? '#ffd27a' : '#c9c2b4'} />
            </group>
          );
        })}
        {on && (
          <mesh position={[0, 2.0, 0]}>
            <sphereGeometry args={[0.1, 10, 8]} />
            <meshStandardMaterial color="#fff2c0" emissive="#ffd27a" emissiveIntensity={1.2} />
          </mesh>
        )}
      </>
    ),
  },
  candle: {
    top: 0.3,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.03, 0]} r={0.12} h={0.04} c={b} />
        <C p={[0, 0.15, 0]} r={0.05} h={0.22} c={a} />
        {on && (
          <mesh position={[0, 0.3, 0]} scale={[1, 1.8, 1]}>
            <sphereGeometry args={[0.025, 8, 6]} />
            <meshStandardMaterial color="#ffd27a" emissive="#ff9f2c" emissiveIntensity={1.6} toneMapped={false} />
          </mesh>
        )}
      </>
    ),
  },
  neonlamp: {
    top: 1.3,
    draw: ({ a, b, on }) => (
      <>
        <B p={[0, 0.03, 0]} s={[0.4, 0.06, 0.4]} c={b} />
        <B p={[0, 0.65, 0]} s={[0.1, 1.2, 0.1]} c={on ? a : '#d8d8d8'} glow={on} line={false} />
      </>
    ),
  },
  discoball: {
    top: 0,
    draw: ({ a, on }) => (
      <>
        <C p={[0, 2.4, 0]} r={0.012} h={0.4} c="#9aa5ad" />
        <Spin on={on} speed={1.4} y={2.05}>
          <mesh>
            <icosahedronGeometry args={[0.24, 1]} />
            <meshStandardMaterial color="#e8eef2" metalness={0.9} roughness={0.15} flatShading emissive={on ? a : '#000000'} emissiveIntensity={on ? 0.35 : 0} />
          </mesh>
        </Spin>
      </>
    ),
  },
  lavalamp: {
    top: 0.5,
    draw: ({ a, b, c, on }) => (
      <>
        <C p={[0, 0.06, 0]} r={0.1} r2={0.06} h={0.12} c={c} />
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.05, 0.08, 0.36, 12]} />
          <meshStandardMaterial color={b} transparent opacity={0.6} emissive={on ? b : '#000000'} emissiveIntensity={on ? 0.4 : 0} />
        </mesh>
        <Bob on={on} amp={0.09} freq={1.1}>
          <S p={[0, 0.3, 0]} r={0.035} c={a} />
        </Bob>
        <Bob on={on} amp={0.07} freq={0.8} phase={2}>
          <S p={[0.01, 0.24, 0]} r={0.025} c={a} />
        </Bob>
        <C p={[0, 0.51, 0]} r={0.04} r2={0.05} h={0.06} c={c} />
      </>
    ),
  },
  // ---------- İkram makineleri ----------
  coffeemaker: {
    top: 0.4,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.2, -0.08]} s={[0.3, 0.4, 0.2]} c={a} />
        <B p={[0, 0.36, 0.04]} s={[0.3, 0.08, 0.2]} c={a} />
        <B p={[0, 0.02, 0.06]} s={[0.24, 0.04, 0.2]} c={b} />
        <C p={[0, 0.09, 0.07]} r={0.05} r2={0.04} h={0.1} c="#ffffff" />
      </>
    ),
  },
  icecream: {
    top: 1.0,
    draw: ({ a, b, open }) => (
      <>
        <B p={[0, 0.45, 0]} s={[0.86, 0.9, 0.7]} c={a} />
        <B p={[0, 0.92, 0]} s={[0.8, 0.06, 0.64]} c={open ? '#cfefff' : b} />
        {open &&
          ['#ff9ecb', '#fff3c4', '#8b5a2b', '#9be7a4'].map((col, i) => <C key={col} p={[-0.27 + i * 0.18, 0.93, 0]} r={0.07} h={0.04} c={col} />)}
        <B p={[0, 0.5, 0.36]} s={[0.6, 0.3, 0.02]} c="#ff9ecb" line={false} />
      </>
    ),
  },
  popcorn: {
    top: 1.3,
    draw: ({ a, b, on }) => (
      <>
        <B p={[0, 0.3, 0]} s={[0.66, 0.6, 0.6]} c={a} />
        {legs(0.6, 0.54, 0.06, '#2b2622', 0.06)}
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[0.6, 0.6, 0.56]} />
          <meshStandardMaterial color="#e8f6ff" transparent opacity={0.45} />
        </mesh>
        <B p={[0, 1.3, 0]} s={[0.66, 0.1, 0.62]} c={b} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Bob key={i} on={on} amp={0.12} freq={6 + i} phase={i}>
            <S p={[-0.2 + i * 0.1, 0.78, (i % 2) * 0.1 - 0.05]} r={0.04} c="#fff6c9" />
          </Bob>
        ))}
      </>
    ),
  },
  cookiejar: {
    top: 0.3,
    draw: ({ a, b }) => (
      <>
        <mesh position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.11, 0.11, 0.24, 12]} />
          <meshStandardMaterial color="#eaf6ff" transparent opacity={0.55} />
        </mesh>
        {[0.05, 0.11, 0.17].map((y) => (
          <C key={y} p={[0, y, 0]} r={0.08} h={0.03} c={a} />
        ))}
        <C p={[0, 0.27, 0]} r={0.12} h={0.04} c={b} />
      </>
    ),
  },
  watercooler: {
    top: 1.4,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.45, 0]} s={[0.44, 0.9, 0.44]} c={a} />
        <B p={[0.08, 0.7, 0.23]} s={[0.06, 0.06, 0.04]} c="#4f8bff" />
        <mesh position={[0, 1.15, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.42, 14]} />
          <meshStandardMaterial color={b} transparent opacity={0.65} />
        </mesh>
      </>
    ),
  },
  // ---------- Eğlence ----------
  billiard: {
    top: 0.82,
    draw: ({ w, d, a, b, on }) => (
      <>
        {legs(w - 0.3, d - 0.3, 0.6, b, 0.12)}
        <B p={[0, 0.68, 0]} s={[w - 0.04, 0.16, d - 0.04]} c={b} />
        <B p={[0, 0.77, 0]} s={[w - 0.24, 0.02, d - 0.24]} c={a} line={false} />
        <Roll on={on} w={w - 0.3} d={d - 0.3} c="#ffffff" />
        {['#e53935', '#ffd23f', '#1e88e5'].map((col, i) => (
          <mesh key={col} position={[-0.4 + i * 0.12, 0.83, (i - 1) * 0.08]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color={col} />
          </mesh>
        ))}
      </>
    ),
  },
  arcade: {
    top: 1.8,
    draw: ({ a, b, on }) => (
      <>
        <B p={[0, 0.9, -0.05]} s={[0.7, 1.8, 0.6]} c={a} />
        <B p={[0, 1.75, 0.05]} s={[0.66, 0.16, 0.5]} c={b} glow={on} />
        <Cycle on={on} colors={NEON} p={[0, 1.3, 0.26]} s={[0.5, 0.4, 0.02]} speed={3} />
        <B p={[0, 0.95, 0.2]} s={[0.66, 0.08, 0.3]} c={b} />
        <C p={[-0.12, 1.02, 0.25]} r={0.03} h={0.1} c="#e53935" />
        {[0.05, 0.15].map((x) => (
          <C key={x} p={[x, 1.0, 0.27]} r={0.025} h={0.03} c="#ffd23f" />
        ))}
      </>
    ),
  },
  dancefloor: {
    top: 0.06,
    draw: ({ on }) => (
      <>
        <B p={[0, 0.02, 0]} s={[0.98, 0.04, 0.98]} c="#2b2622" line={false} />
        {[0, 1, 2, 3].map((i) => (
          <Cycle key={i} on={on} colors={NEON} phase={i} p={[(i % 2) * 0.48 - 0.24, 0.045, Math.floor(i / 2) * 0.48 - 0.24]} s={[0.44, 0.02, 0.44]} />
        ))}
      </>
    ),
  },
  piano: {
    top: 1.1,
    draw: ({ w, a, b }) => (
      <>
        <B p={[0, 0.7, -0.15]} s={[w - 0.1, 1.3, 0.5]} c={a} />
        <B p={[0, 0.75, 0.2]} s={[w - 0.1, 0.1, 0.3]} c={a} />
        <B p={[0, 0.82, 0.2]} s={[w - 0.3, 0.03, 0.24]} c="#ffffff" line={false} />
        {Array.from({ length: 9 }, (_, i) => (
          <B key={i} p={[-(w - 0.4) / 2 + i * ((w - 0.4) / 8), 0.85, 0.15]} s={[0.04, 0.03, 0.12]} c="#1f2226" line={false} />
        ))}
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.2)) / 2, 0.35, 0.25]} s={[0.08, 0.7, 0.08]} c={b} />
        ))}
      </>
    ),
  },
  jukebox: {
    top: 1.5,
    draw: ({ a, b, on }) => (
      <>
        <B p={[0, 0.6, 0]} s={[0.8, 1.2, 0.6]} c={a} />
        <mesh position={[0, 1.2, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.4, 0.4, 0.6, 20, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color={a} />
        </mesh>
        <B p={[0, 1.15, 0.31]} s={[0.56, 0.36, 0.02]} c={on ? b : '#cfd6db'} glow={on} line={false} />
        {[0.45, 0.6, 0.75].map((y) => (
          <B key={y} p={[0, y, 0.31]} s={[0.6, 0.04, 0.02]} c="#ffd23f" line={false} />
        ))}
      </>
    ),
  },
  drums: {
    top: 0.6,
    draw: ({ a, b }) => (
      <>
        <mesh position={[0, 0.3, -0.05]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.28, 0.28, 0.3, 16]} />
          <meshStandardMaterial color={a} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <C p={[s * 0.32, 0.5, 0.15]} r={0.13} h={0.14} c={a} />
            <C p={[s * 0.32, 0.58, 0.15]} r={0.13} h={0.01} c={b} />
            <C p={[s * 0.32, 0.25, 0.15]} r={0.015} h={0.5} c="#9aa5ad" />
          </group>
        ))}
        <C p={[0.3, 0.95, -0.25]} r={0.2} h={0.01} c="#ffd23f" />
        <C p={[0.3, 0.5, -0.25]} r={0.012} h={0.9} c="#9aa5ad" />
      </>
    ),
  },
  foosball: {
    top: 0.9,
    draw: ({ w, d, a, b, on }) => (
      <>
        {legs(w - 0.3, d - 0.3, 0.7, b, 0.1)}
        <B p={[0, 0.78, 0]} s={[w - 0.1, 0.2, d - 0.1]} c={a} />
        <B p={[0, 0.88, 0]} s={[w - 0.3, 0.01, d - 0.3]} c="#3faa52" line={false} />
        {[-0.45, -0.15, 0.15, 0.45].map((x, i) => (
          <Bob key={x} on={on} amp={0.06} freq={5 + i} phase={i}>
            <group position={[x, 0.95, 0]}>
              <C p={[0, 0, 0]} r={0.015} h={d + 0.1} c="#c9ced4" />
              <B p={[0, -0.05, 0]} s={[0.05, 0.1, 0.05]} c={i % 2 ? '#e53935' : '#1e88e5'} line={false} />
            </group>
          </Bob>
        ))}
      </>
    ),
  },
  guitar: {
    top: 1.0,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.04, 0]} s={[0.3, 0.08, 0.3]} c="#2b2622" />
        <group position={[0, 0.1, 0]} rotation-x={-0.15}>
          <S p={[0, 0.25, 0]} r={0.17} c={a} sy={0.5} />
          <S p={[0, 0.45, 0]} r={0.13} c={a} sy={0.5} />
          <B p={[0, 0.8, 0]} s={[0.06, 0.5, 0.03]} c={b} />
          <B p={[0, 1.08, 0]} s={[0.09, 0.1, 0.03]} c={b} />
        </group>
      </>
    ),
  },
  // ---------- Bahçe ----------
  pool: {
    top: 0.2,
    draw: ({ w, d, a, b, on }) => (
      <>
        <B p={[0, 0.1, 0]} s={[w - 0.04, 0.2, d - 0.04]} c={b} />
        <Bob on={on} amp={0.012} freq={2.5}>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[w - 0.3, 0.02, d - 0.3]} />
            <meshStandardMaterial color={a} transparent opacity={0.85} emissive={a} emissiveIntensity={0.15} />
          </mesh>
        </Bob>
        <S p={[w / 2 - 0.5, 0.26, d / 2 - 0.5]} r={0.12} c="#ff9f43" sy={0.4} />
      </>
    ),
  },
  fountain: {
    top: 0.6,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.15, 0]} r={0.46} r2={0.42} h={0.3} c={b} />
        <C p={[0, 0.29, 0]} r={0.4} h={0.02} c={a} />
        <C p={[0, 0.55, 0]} r={0.06} h={0.5} c={b} />
        <C p={[0, 0.82, 0]} r={0.2} r2={0.08} h={0.08} c={b} />
        {on &&
          [0, 1, 2].map((i) => (
            <Bob key={i} on={on} amp={0.08} freq={4} phase={i * 2}>
              <mesh position={[0, 1.0 + i * 0.08, 0]}>
                <sphereGeometry args={[0.05 - i * 0.01, 8, 6]} />
                <meshStandardMaterial color={a} transparent opacity={0.7} />
              </mesh>
            </Bob>
          ))}
      </>
    ),
  },
  parasol: {
    top: 0,
    draw: ({ a, b, open }) => (
      <>
        <C p={[0, 0.05, 0]} r={0.18} h={0.1} c="#9aa5ad" />
        <C p={[0, 1.1, 0]} r={0.03} h={2.1} c={b} />
        {open ? (
          <mesh position={[0, 2.05, 0]}>
            <coneGeometry args={[0.95, 0.4, 8]} />
            <meshStandardMaterial color={a} flatShading />
          </mesh>
        ) : (
          <mesh position={[0, 1.6, 0]}>
            <coneGeometry args={[0.12, 0.9, 8]} />
            <meshStandardMaterial color={a} flatShading />
          </mesh>
        )}
      </>
    ),
  },
  // ---------- Evcil köşe ----------
  petbowl: {
    top: 0.12,
    draw: ({ a }) => (
      <>
        <C p={[0, 0.05, 0]} r={0.2} r2={0.15} h={0.1} c={a} />
        <C p={[0, 0.095, 0]} r={0.15} h={0.01} c="#b97a3c" />
      </>
    ),
  },
  petbed: {
    top: 0.2,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.08, 0]} r={0.42} r2={0.4} h={0.16} c={a} />
        <C p={[0, 0.12, 0]} r={0.32} h={0.1} c={b} />
      </>
    ),
  },
  kennel: {
    top: 1.0,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.35, 0]} s={[0.8, 0.7, 0.8]} c={a} />
        <B p={[0, 0.25, 0.41]} s={[0.36, 0.44, 0.02]} c="#2b2622" line={false} />
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.22, 0.85, 0]} rotation-z={-s * 0.75}>
            <B p={[0, 0, 0]} s={[0.62, 0.06, 0.9]} c={b} />
          </group>
        ))}
      </>
    ),
  },
  scratchpost: {
    top: 1.0,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.04, 0]} s={[0.6, 0.08, 0.6]} c={b} />
        <C p={[0, 0.5, 0]} r={0.09} h={0.9} c="#d9b48a" />
        <B p={[0, 0.98, 0]} s={[0.46, 0.06, 0.46]} c={b} />
        <S p={[0.22, 0.6, 0.1]} r={0.05} c={a} />
      </>
    ),
  },
  petball: {
    top: 0.2,
    draw: ({ a, b }) => (
      <>
        <S p={[0, 0.12, 0]} r={0.12} c={a} />
        <mesh position={[0, 0.12, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.12, 0.012, 6, 16]} />
          <meshStandardMaterial color={b} />
        </mesh>
      </>
    ),
  },
  // ---------- Mimari ----------
  column: {
    top: 2.2,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.06, 0]} s={[0.7, 0.12, 0.7]} c={b} />
        <C p={[0, 1.1, 0]} r={0.24} h={2.0} c={a} seg={12} />
        <B p={[0, 2.16, 0]} s={[0.7, 0.12, 0.7]} c={b} />
      </>
    ),
  },
  arch: {
    top: 0,
    draw: ({ w, a, b }) => (
      <>
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.3)) / 2, 1.0, 0]} s={[0.3, 2.0, 0.4]} c={a} />
        ))}
        <mesh position={[0, 2.0, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[(w - 0.3) / 2, 0.15, 8, 16, Math.PI]} />
          <meshStandardMaterial color={b} flatShading />
        </mesh>
      </>
    ),
  },
  lowwall: {
    top: 0.8,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.38, 0]} s={[0.98, 0.76, 0.3]} c={a} />
        <B p={[0, 0.79, 0]} s={[1.0, 0.06, 0.36]} c={b} />
      </>
    ),
  },
  platform: {
    top: 0.1,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.05, 0]} s={[0.98, 0.1, 0.98]} c={a} />
        <B p={[0, 0.101, 0]} s={[0.8, 0.002, 0.8]} c={b} line={false} />
      </>
    ),
  },
  stairs: {
    top: 0,
    draw: ({ d, a, b }) => (
      <>
        {[0, 1, 2, 3].map((i) => (
          <B key={i} p={[0, 0.15 + i * 0.3, d / 2 - 0.25 - i * ((d - 0.5) / 4)]} s={[0.9, 0.3 + i * 0.6, (d - 0.2) / 4]} c={i % 2 ? b : a} />
        ))}
      </>
    ),
  },
  turnstile: {
    top: 1.0,
    draw: ({ a, b, open }) => (
      <>
        <B p={[-0.38, 0.5, 0]} s={[0.2, 1.0, 0.7]} c={a} />
        <B p={[-0.38, 1.02, 0]} s={[0.2, 0.04, 0.7]} c={open ? '#3fcf6b' : '#ef4b4b'} glow line={false} />
        {[0, 1, 2].map((i) => (
          <group key={i} position={[-0.28, 0.75, 0]} rotation-x={(i * 2 * Math.PI) / 3 + (open ? 0.5 : 0)}>
            <B p={[0.28, 0.2, 0]} s={[0.56, 0.04, 0.04]} c={b} />
          </group>
        ))}
      </>
    ),
  },
  // ---------- Bitkiler ----------
  palm: {
    top: 2.0,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.12, 0]} r={0.2} r2={0.16} h={0.24} c={c} />
        <C p={[0, 0.95, 0]} r={0.06} r2={0.09} h={1.5} c={b} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <group key={i} position={[0, 1.7, 0]} rotation-y={(i * Math.PI) / 3}>
            <group rotation-z={0.9}>
              <B p={[0, 0.35, 0]} s={[0.04, 0.7, 0.2]} c={a} line={false} />
            </group>
          </group>
        ))}
      </>
    ),
  },
  cactus: {
    top: 1.3,
    draw: ({ a, c }) => (
      <>
        <C p={[0, 0.12, 0]} r={0.2} r2={0.16} h={0.24} c={c} />
        <C p={[0, 0.7, 0]} r={0.12} h={1.0} c={a} />
        <S p={[0, 1.2, 0]} r={0.12} c={a} />
        <C p={[0.2, 0.75, 0]} r={0.06} h={0.3} c={a} />
        <B p={[0.13, 0.62, 0]} s={[0.14, 0.08, 0.08]} c={a} line={false} />
        <C p={[-0.18, 0.95, 0]} r={0.05} h={0.25} c={a} />
        <B p={[-0.12, 0.85, 0]} s={[0.12, 0.07, 0.07]} c={a} line={false} />
      </>
    ),
  },
  monstera: {
    top: 1.1,
    draw: ({ a, c }) => (
      <>
        <C p={[0, 0.15, 0]} r={0.22} r2={0.18} h={0.3} c={c} />
        {[0, 1, 2, 3, 4].map((i) => (
          <group key={i} position={[0, 0.4, 0]} rotation-y={(i * 2 * Math.PI) / 5}>
            <group rotation-z={0.5 + (i % 2) * 0.3}>
              <C p={[0, 0.25, 0]} r={0.012} h={0.5} c="#3a7a3a" />
              <mesh position={[0, 0.55, 0]} rotation-x={Math.PI / 2} scale={[1, 1.3, 1]}>
                <circleGeometry args={[0.16, 10]} />
                <meshStandardMaterial color={a} side={2} />
              </mesh>
            </group>
          </group>
        ))}
      </>
    ),
  },
  sunflower: {
    top: 1.2,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.12, 0]} r={0.18} r2={0.14} h={0.24} c={c} />
        <C p={[0, 0.65, 0]} r={0.02} h={0.9} c="#4f9a3a" />
        <group position={[0, 1.12, 0.02]} rotation-x={-0.3}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.2, 0.2, 0.03, 14]} />
            <meshStandardMaterial color={a} />
          </mesh>
          <mesh position={[0, 0, 0.02]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.09, 0.09, 0.03, 12]} />
            <meshStandardMaterial color={b} />
          </mesh>
        </group>
      </>
    ),
  },
};
