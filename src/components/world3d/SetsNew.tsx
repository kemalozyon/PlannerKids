// Yeni set parçaları (Habbo tarzı, kodla çizilir; bkz. Sets.tsx): 🚀 Uzay, 🐠 Okyanus, 🎸 Müzik stüdyosu,
// ❄️ Kış kulübesi, 🏯 Japon bahçesi, desenli halılar, bahçe ışıkları, oyun parkı ve 🌟 nadir ağaç ödülleri. Habbo'nun çizimleri
// kopyalanmadı; yalnızca tarzından (tıknaz kutular, ince koyu kontur, canlı renk) ilham alındı.
// Parça ayak izinin ortasında, önü yerel +z'ye bakar, y = 0 zemin; renkler [a, b, c] (a: CHANGE_COLOR ile değişir).
import type { ReactNode } from 'react';
import { Flame } from './Proc';
import { B, C, S, type Piece, type V3 } from './setParts';
import { Bob, Spin } from './SetsMore';

/** Parlayan küre (lamba, yıldız): açıkken ışık saçar gibi */
function Glow({ p, r, c, on, dim = '#d8d4cc' }: { p: V3; r: number; c: string; on: boolean; dim?: string }) {
  return (
    <mesh position={p}>
      <sphereGeometry args={[r, 14, 10]} />
      <meshStandardMaterial color={on ? c : dim} emissive={c} emissiveIntensity={on ? 1.3 : 0} />
    </mesh>
  );
}

/** Yatay silindir (x boyunca) */
function Hx({ p, r, h, c, r2 }: { p: V3; r: number; h: number; c: string; r2?: number }) {
  return (
    <mesh position={p} rotation-z={Math.PI / 2} castShadow>
      <cylinderGeometry args={[r2 ?? r, r, h, 14]} />
      <meshStandardMaterial color={c} roughness={0.6} />
    </mesh>
  );
}

/** Halka (yatay) */
function Ring({ p, r, t, c, tilt = 0 }: { p: V3; r: number; t: number; c: string; tilt?: number }) {
  return (
    <mesh position={p} rotation-x={Math.PI / 2 + tilt}>
      <torusGeometry args={[r, t, 8, 28]} />
      <meshStandardMaterial color={c} roughness={0.5} />
    </mesh>
  );
}

/** Yere serili ince halı tabanı (üstüne desen çizilir) */
const rugBase = (w: number, d: number, c: string, inset = 0.06): ReactNode => <B p={[0, 0.012, 0]} s={[w - inset, 0.024, d - inset]} c={c} line={false} />;

/** Halı deseni için yere yatık düz parça */
function Flat({ p, s, c, glow }: { p: [number, number]; s: [number, number]; c: string; glow?: boolean }) {
  return <B p={[p[0], 0.027, p[1]]} s={[s[0], 0.008, s[1]]} c={c} glow={glow} line={false} />;
}

export const NEW_PIECES: Record<string, Piece> = {
  // ---------- 🚀 Uzay ----------
  capsulebed: {
    top: 0.5,
    draw: ({ w, d, a, b, c, on }) => (
      <>
        <B p={[0, 0.2, 0]} s={[w - 0.1, 0.36, d - 0.1]} c={a} />
        <B p={[0, 0.42, 0.05]} s={[w - 0.2, 0.1, d - 0.3]} c={b} />
        {/* Başucu kapsülü ve lombozu */}
        <B p={[0, 0.7, -d / 2 + 0.22]} s={[w - 0.1, 0.9, 0.34]} c={a} />
        <B p={[0, 1.16, -d / 2 + 0.36]} s={[w - 0.1, 0.1, 0.62]} c={a} />
        <mesh position={[0, 0.78, -d / 2 + 0.4]}>
          <circleGeometry args={[0.16, 20]} />
          <meshStandardMaterial color={on ? '#9be7ff' : '#3b4f7a'} emissive="#4fd8ff" emissiveIntensity={on ? 0.9 : 0.15} />
        </mesh>
        <B p={[0, 0.47, d / 2 - 0.25]} s={[w - 0.22, 0.04, 0.4]} c={c} line={false} />
      </>
    ),
  },
  telescope: {
    top: 0,
    draw: ({ a, b, on }) => (
      <>
        {[0, 1, 2].map((i) => {
          const ang = (i * Math.PI * 2) / 3;
          return (
            <mesh key={i} position={[Math.sin(ang) * 0.18, 0.4, Math.cos(ang) * 0.18]} rotation={[Math.cos(ang) * 0.35, 0, -Math.sin(ang) * 0.35]}>
              <cylinderGeometry args={[0.022, 0.022, 0.82, 6]} />
              <meshStandardMaterial color={b} />
            </mesh>
          );
        })}
        <Spin on={on} speed={0.25} y={0.82}>
          <group rotation-x={-0.6}>
            <mesh position={[0, 0.12, 0]} rotation-x={Math.PI / 2} castShadow>
              <cylinderGeometry args={[0.11, 0.15, 0.95, 14]} />
              <meshStandardMaterial color={a} roughness={0.4} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0.12, 0.48]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.16, 0.16, 0.06, 14]} />
              <meshStandardMaterial color={b} />
            </mesh>
          </group>
        </Spin>
      </>
    ),
  },
  planetlamp: {
    top: 1.0,
    draw: ({ a, b, c, on }) => (
      <>
        <C p={[0, 0.04, 0]} r={0.2} h={0.08} c={b} />
        <C p={[0, 0.35, 0]} r={0.025} h={0.6} c={b} />
        <Glow p={[0, 0.82, 0]} r={0.24} c={a} on={on} dim={a} />
        <Ring p={[0, 0.82, 0]} r={0.36} t={0.025} c={c} tilt={0.35} />
      </>
    ),
  },
  rocketshelf: {
    top: 1.7,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.8, 0]} r={0.34} h={1.5} c={b} />
        <mesh position={[0, 1.8, 0]} castShadow>
          <coneGeometry args={[0.34, 0.5, 16]} />
          <meshStandardMaterial color={c} />
        </mesh>
        {[0.45, 0.85, 1.25].map((y) => (
          <B key={y} p={[0, y, 0.2]} s={[0.5, 0.04, 0.3]} c={a} line={false} />
        ))}
        {[-1, 1].map((s) => (
          <B key={s} p={[s * 0.4, 0.25, 0]} s={[0.14, 0.5, 0.36]} c={c} />
        ))}
        <mesh position={[0, 1.45, 0.31]}>
          <circleGeometry args={[0.1, 16]} />
          <meshStandardMaterial color="#9be7ff" emissive="#4fd8ff" emissiveIntensity={0.4} />
        </mesh>
      </>
    ),
  },
  astrochair: {
    top: 0.45,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.08, 0]} r={0.26} r2={0.1} h={0.16} c={c} />
        <S p={[0, 0.55, -0.05]} r={0.42} c={a} sy={1.05} />
        <B p={[0, 0.42, 0.1]} s={[0.56, 0.14, 0.5]} c={b} />
        <B p={[0, 0.66, -0.2]} s={[0.5, 0.36, 0.1]} c={b} line={false} />
      </>
    ),
  },
  ufolamp: {
    top: 0,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 2.4, 0]} r={0.012} h={0.4} c="#9aa5ad" />
        <C p={[0, 2.16, 0]} r={0.42} r2={0.18} h={0.12} c={a} />
        <C p={[0, 2.08, 0]} r={0.2} r2={0.42} h={0.06} c={b} />
        <Glow p={[0, 2.26, 0]} r={0.14} c="#9be7ff" on={on} dim="#cfd8e3" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Glow key={i} p={[Math.cos(i) * 0.33, 2.07, Math.sin(i) * 0.33]} r={0.03} c="#ffd23f" on={on} />
        ))}
      </>
    ),
  },
  spacedesk: {
    top: 0.76,
    draw: ({ w, a, b, c, on }) => (
      <>
        <B p={[0, 0.74, 0]} s={[w - 0.06, 0.06, 0.8]} c={b} />
        <B p={[0, 0.775, 0.37]} s={[w - 0.1, 0.012, 0.04]} c={c} glow={on} line={false} />
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.3)) / 2, 0.36, 0]} s={[0.24, 0.72, 0.7]} c={a} />
        ))}
      </>
    ),
  },
  starrug: {
    top: 0,
    draw: ({ w, d, a, b }) => (
      <>
        {rugBase(w, d, a)}
        {[
          [-0.6, -0.5],
          [0.4, -0.7],
          [0.7, 0.2],
          [-0.3, 0.1],
          [-0.7, 0.6],
          [0.2, 0.65],
          [0, -0.2],
        ].map(([x, z], i) => (
          <Flat key={i} p={[(x * w) / 2, (z * d) / 2]} s={[i % 2 ? 0.08 : 0.14, i % 2 ? 0.08 : 0.14]} c={b} glow />
        ))}
        <Flat p={[0.25 * w, -0.1 * d]} s={[0.34, 0.34]} c="#ffb347" />
      </>
    ),
  },

  // ---------- 🐠 Okyanus ----------
  aquatable: {
    top: 0.82,
    draw: ({ w, a, b, c, on }) => (
      <>
        <B p={[0, 0.06, 0]} s={[w - 0.08, 0.12, 0.8]} c={b} />
        <mesh position={[0, 0.44, 0]}>
          <boxGeometry args={[w - 0.14, 0.64, 0.72]} />
          <meshStandardMaterial color={a} transparent opacity={0.55} roughness={0.1} />
        </mesh>
        <B p={[0, 0.79, 0]} s={[w - 0.04, 0.05, 0.84]} c={b} />
        <B p={[0, 0.16, 0]} s={[w - 0.2, 0.06, 0.62]} c="#f2d59b" line={false} />
        {[0, 1, 2].map((i) => (
          <Bob key={i} on={on} amp={0.06} freq={1.5 + i * 0.4} phase={i * 2}>
            <Spin on={on} speed={0.5 + i * 0.2} y={0.35 + i * 0.12}>
              <mesh position={[0.25 + i * 0.08, 0, 0]} scale={[1, 0.6, 0.4]}>
                <sphereGeometry args={[0.07, 10, 8]} />
                <meshStandardMaterial color={i === 1 ? '#ffd23f' : c} />
              </mesh>
            </Spin>
          </Bob>
        ))}
      </>
    ),
  },
  shellchair: {
    top: 0.42,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.2, 0.05]} r={0.4} r2={0.36} h={0.4} c={a} />
        <C p={[0, 0.41, 0.05]} r={0.36} h={0.04} c={b} />
        {[-2, -1, 0, 1, 2].map((i) => (
          <group key={i} position={[0, 0.4, -0.22]} rotation-z={i * 0.32}>
            <B p={[0, 0.4, 0]} s={[0.2, 0.8, 0.12]} c={a} />
          </group>
        ))}
      </>
    ),
  },
  lighthouse: {
    top: 1.6,
    draw: ({ a, b, c, on }) => (
      <>
        {[0, 1, 2, 3].map((i) => (
          <C key={i} p={[0, 0.17 + i * 0.3, 0]} r={0.26 - i * 0.035} r2={0.26 - (i + 1) * 0.035} h={0.3} c={i % 2 ? b : a} />
        ))}
        <C p={[0, 1.27, 0]} r={0.2} h={0.04} c={c} />
        <Glow p={[0, 1.4, 0]} r={0.13} c="#fff2a8" on={on} />
        <mesh position={[0, 1.6, 0]} castShadow>
          <coneGeometry args={[0.2, 0.22, 10]} />
          <meshStandardMaterial color={c} />
        </mesh>
      </>
    ),
  },
  boatbed: {
    top: 0.5,
    draw: ({ w, d, a, b, c }) => (
      <>
        <B p={[0, 0.22, 0]} s={[w - 0.08, 0.44, d - 0.3]} c={a} />
        <mesh position={[0, 0.22, d / 2 - 0.15]} rotation-y={Math.PI / 4} castShadow>
          <boxGeometry args={[(w - 0.08) * 0.707, 0.44, (w - 0.08) * 0.707]} />
          <meshStandardMaterial color={a} />
        </mesh>
        <B p={[0, 0.46, -0.05]} s={[w - 0.24, 0.1, d - 0.5]} c={b} />
        <B p={[0, 0.25, 0]} s={[w - 0.04, 0.06, d - 0.28]} c={c} line={false} />
        <C p={[0, 1.0, -d / 2 + 0.25]} r={0.03} h={1.1} c="#a8743f" />
        <mesh position={[0.12, 1.15, -d / 2 + 0.25]} rotation-y={-Math.PI / 2}>
          <planeGeometry args={[0.5, 0.6]} />
          <meshStandardMaterial color="#ffffff" side={2} />
        </mesh>
      </>
    ),
  },
  coral: {
    top: 0,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.06, 0]} r={0.3} r2={0.34} h={0.12} c="#f2d59b" />
        {[
          [-0.1, 0.45, 0, a, 0.4],
          [0.12, 0.35, 0.08, b, 0.3],
          [0.02, 0.3, -0.12, c, 0.26],
        ].map(([x, h, z, col, sz], i) => (
          <group key={i}>
            <C p={[x as number, (h as number) / 2 + 0.1, z as number]} r={0.04} h={h as number} c={col as string} />
            <S p={[x as number, (h as number) + 0.12, z as number]} r={(sz as number) * 0.25} c={col as string} />
          </group>
        ))}
      </>
    ),
  },
  buoypouf: {
    top: 0.36,
    draw: ({ a, b }) => (
      <>
        <mesh position={[0, 0.18, 0]} rotation-x={Math.PI / 2} castShadow>
          <torusGeometry args={[0.26, 0.15, 10, 24]} />
          <meshStandardMaterial color={a} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.26, 0.18, Math.sin((i * Math.PI) / 2) * 0.26]} rotation-y={-(i * Math.PI) / 2}>
            <boxGeometry args={[0.1, 0.31, 0.31]} />
            <meshStandardMaterial color={b} />
          </mesh>
        ))}
        <C p={[0, 0.25, 0]} r={0.14} h={0.18} c={b} />
      </>
    ),
  },
  waverug: {
    top: 0,
    draw: ({ w, d, a, b }) => (
      <>
        {rugBase(w, d, a)}
        {[-0.3, 0, 0.3].map((z) =>
          [-3, -2, -1, 0, 1, 2, 3].map((i) => (
            <Flat key={`${z}${i}`} p={[(i * (w - 0.2)) / 7, z * d + Math.sin(i * 1.4) * 0.05]} s={[(w - 0.2) / 8, 0.05]} c={b} />
          )),
        )}
      </>
    ),
  },

  // ---------- 🎸 Müzik stüdyosu ----------
  keyboard: {
    top: 0.82,
    draw: ({ w, a, b }) => (
      <>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[(s * (w - 0.5)) / 2, 0.38, 0]} rotation-x={s * 0.35}>
              <boxGeometry args={[0.05, 0.8, 0.05]} />
              <meshStandardMaterial color="#9aa5ad" />
            </mesh>
          </group>
        ))}
        <B p={[0, 0.76, 0]} s={[w - 0.2, 0.1, 0.42]} c={a} />
        <B p={[0, 0.815, 0.06]} s={[w - 0.34, 0.02, 0.2]} c={b} line={false} />
        {Array.from({ length: Math.round((w - 0.4) / 0.09) }, (_, i) => (
          <B key={i} p={[-(w - 0.4) / 2 + 0.06 + i * 0.09, 0.83, 0.02]} s={[0.04, 0.02, 0.11]} c="#1f2226" line={false} />
        ))}
      </>
    ),
  },
  amp: {
    top: 0.9,
    draw: ({ a, b, c, on }) => (
      <>
        <B p={[0, 0.45, 0]} s={[0.76, 0.9, 0.5]} c={a} />
        <B p={[0, 0.86, 0.26]} s={[0.7, 0.08, 0.02]} c={b} line={false} />
        {[0.3, 0.62].map((y, i) => (
          <Bob key={y} on={on} amp={0.012} freq={14} phase={i}>
            <mesh position={[0, y, 0.26]}>
              <circleGeometry args={[0.13 - i * 0.03, 20]} />
              <meshStandardMaterial color="#2b2622" />
            </mesh>
            <mesh position={[0, y, 0.262]}>
              <circleGeometry args={[0.05, 14]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={on ? 0.9 : 0} />
            </mesh>
          </Bob>
        ))}
      </>
    ),
  },
  // Retro pikap (MUSIC): ahşap dolap, üstünde plak çalar; çalarken plak döner, iğne plağın üstüne iner
  turntable: {
    top: 0.72,
    draw: ({ a, b, c, on }) => (
      <>
        <B p={[0, 0.3, 0]} s={[0.8, 0.6, 0.56]} c={a} />
        {[-0.19, 0.19].map((x) => (
          <B key={x} p={[x, 0.3, 0.285]} s={[0.32, 0.44, 0.02]} c={b} line={false} />
        ))}
        <B p={[0, 0.645, 0]} s={[0.78, 0.09, 0.54]} c={b} />
        <group position={[-0.08, 0, 0.02]}>
          <Spin on={on} speed={3.5} y={0.7}>
            <mesh>
              <cylinderGeometry args={[0.22, 0.22, 0.014, 32]} />
              <meshStandardMaterial color="#17171b" roughness={0.35} />
            </mesh>
            <mesh position-y={0.009}>
              <cylinderGeometry args={[0.07, 0.07, 0.006, 20]} />
              <meshStandardMaterial color={c} />
            </mesh>
            {/* Plağın döndüğü görünsün */}
            <mesh position={[0.13, 0.008, 0]}>
              <boxGeometry args={[0.1, 0.004, 0.012]} />
              <meshStandardMaterial color="#3a3a42" />
            </mesh>
          </Spin>
        </group>
        <group position={[0.26, 0.72, -0.17]} rotation-y={on ? -0.62 : -0.18}>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.035, 0.04, 0.05, 12]} />
            <meshStandardMaterial color="#c9ced4" metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.05, 0.14]}>
            <boxGeometry args={[0.022, 0.018, 0.3]} />
            <meshStandardMaterial color="#c9ced4" metalness={0.5} roughness={0.35} />
          </mesh>
        </group>
        <mesh position={[0.3, 0.7, 0.18]}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshStandardMaterial color={on ? '#7cff6b' : '#3d4a3b'} emissive="#7cff6b" emissiveIntensity={on ? 1.2 : 0} />
        </mesh>
      </>
    ),
  },
  vinylshelf: {
    top: 1.0,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.5, -0.05]} s={[0.84, 1.0, 0.5]} c={a} />
        {[0.28, 0.72].map((y) =>
          ['#ef476f', '#118ab2', '#ffd166', '#06d6a0', '#b07cff'].map((col, i) => (
            <B key={`${y}${i}`} p={[-0.3 + i * 0.15, y, 0.12]} s={[0.12, 0.34, 0.12]} c={col} line={false} />
          )),
        )}
        <B p={[0, 0.5, 0.18]} s={[0.84, 0.04, 0.12]} c={b} line={false} />
      </>
    ),
  },
  beanbag: {
    top: 0.38,
    draw: ({ a, b }) => (
      <>
        <S p={[0, 0.24, 0.05]} r={0.42} c={a} sy={0.6} />
        <S p={[0, 0.48, -0.2]} r={0.3} c={a} sy={0.85} />
        <S p={[0.12, 0.38, 0.18]} r={0.08} c={b} sy={0.5} />
      </>
    ),
  },
  noterug: {
    top: 0,
    draw: ({ w, d, a, b }) => (
      <>
        {rugBase(w, d, a)}
        {[-0.45, -0.15, 0.15, 0.45].map((z) => (
          <Flat key={z} p={[0, z * d]} s={[w - 0.3, 0.02]} c={b} />
        ))}
        {[
          [-0.5, -0.15],
          [-0.1, 0.15],
          [0.35, -0.45],
          [0.55, 0.45],
        ].map(([x, z], i) => (
          <group key={i}>
            <Flat p={[(x * w) / 2, z * d]} s={[0.14, 0.11]} c={b} />
            <Flat p={[(x * w) / 2 + 0.06, z * d - 0.14]} s={[0.025, 0.26]} c={b} />
          </group>
        ))}
      </>
    ),
  },
  spotlight: {
    top: 1.6,
    draw: ({ a, b, on }) => (
      <>
        {[0, 1, 2].map((i) => {
          const ang = (i * Math.PI * 2) / 3;
          return (
            <mesh key={i} position={[Math.sin(ang) * 0.16, 0.6, Math.cos(ang) * 0.16]} rotation={[Math.cos(ang) * 0.25, 0, -Math.sin(ang) * 0.25]}>
              <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
              <meshStandardMaterial color={b} />
            </mesh>
          );
        })}
        <group position={[0, 1.3, 0]} rotation-x={0.5}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.16, 0.12, 0.34, 14]} />
            <meshStandardMaterial color={a} roughness={0.4} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.175]}>
            <circleGeometry args={[0.15, 18]} />
            <meshStandardMaterial color={on ? '#fff6d0' : '#8a8f96'} emissive="#ffe9a0" emissiveIntensity={on ? 1.5 : 0} />
          </mesh>
        </group>
      </>
    ),
  },
  djtable: {
    top: 0.9,
    draw: ({ w, a, b, c, on }) => (
      <>
        <B p={[0, 0.42, 0]} s={[w - 0.08, 0.84, 0.66]} c={a} />
        <B p={[0, 0.42, 0.335]} s={[w - 0.2, 0.06, 0.01]} c={c} glow={on} line={false} />
        {[-1, 1].map((s) => (
          <group key={s} position={[(s * (w - 0.6)) / 2, 0.87, 0]}>
            <C p={[0, 0, 0]} r={0.26} h={0.04} c={b} />
            <Spin on={on} speed={6} y={0.03}>
              <C p={[0, 0, 0]} r={0.22} h={0.02} c="#1f2226" />
              <B p={[0.12, 0.015, 0]} s={[0.06, 0.01, 0.02]} c={c} line={false} />
            </Spin>
          </group>
        ))}
      </>
    ),
  },

  // ---------- ❄️ Kış kulübesi ----------
  knitchair: {
    top: 0.45,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.22, 0.02]} s={[0.86, 0.36, 0.82]} c={a} />
        <B p={[0, 0.66, -0.3]} s={[0.86, 0.6, 0.24]} c={a} />
        {[-1, 1].map((s) => (
          <B key={s} p={[s * 0.36, 0.46, 0.02]} s={[0.16, 0.36, 0.82]} c={a} />
        ))}
        {[-0.2, 0, 0.2].map((x) => (
          <B key={x} p={[x, 0.66, -0.175]} s={[0.06, 0.56, 0.02]} c={b} line={false} />
        ))}
        <B p={[0, 0.44, 0.08]} s={[0.56, 0.1, 0.6]} c={b} />
      </>
    ),
  },
  icelamp: {
    top: 0.9,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.05, 0]} r={0.22} h={0.1} c={b} />
        <mesh position={[0, 0.5, 0]} scale={[1, 1.6, 1]} castShadow>
          <octahedronGeometry args={[0.24, 0]} />
          <meshStandardMaterial color={on ? '#e8fbff' : a} emissive="#9be7ff" emissiveIntensity={on ? 1.1 : 0.05} transparent opacity={0.88} roughness={0.15} />
        </mesh>
      </>
    ),
  },
  lightpine: {
    top: 0,
    draw: ({ a, b, c, on }) => (
      <>
        <C p={[0, 0.12, 0]} r={0.2} r2={0.24} h={0.24} c={c} />
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 0.55 + i * 0.42, 0]} castShadow>
            <coneGeometry args={[0.5 - i * 0.13, 0.62, 9]} />
            <meshStandardMaterial color={a} flatShading />
          </mesh>
        ))}
        {[
          [0.3, 0.45, 0.25],
          [-0.32, 0.5, 0.1],
          [0.1, 0.9, 0.3],
          [-0.18, 1.0, -0.2],
          [0.22, 1.3, -0.08],
          [-0.08, 1.4, 0.18],
          [0.32, 0.7, -0.2],
        ].map(([x, y, z], i) => (
          <Glow key={i} p={[x, y, z]} r={0.045} c={['#ffd23f', '#ff4f8b', '#4fd8ff'][i % 3]} on={on} dim="#d9d2c0" />
        ))}
        <Glow p={[0, 1.78, 0]} r={0.08} c={b} on={on} dim={b} />
      </>
    ),
  },
  snowman: {
    top: 0,
    draw: ({ a, b, c }) => (
      <>
        <S p={[0, 0.3, 0]} r={0.32} c={a} />
        <S p={[0, 0.75, 0]} r={0.23} c={a} />
        <S p={[0, 1.1, 0]} r={0.16} c={a} />
        <mesh position={[0, 1.1, 0.17]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.035, 0.18, 8]} />
          <meshStandardMaterial color="#ff8a3c" />
        </mesh>
        <C p={[0, 1.27, 0]} r={0.14} h={0.03} c="#1f2226" />
        <C p={[0, 1.37, 0]} r={0.1} h={0.18} c="#1f2226" />
        <mesh position={[0, 0.94, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.16, 0.045, 8, 18]} />
          <meshStandardMaterial color={c} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.32, 0.85, 0]} rotation-z={s * -0.9}>
            <cylinderGeometry args={[0.015, 0.015, 0.36, 5]} />
            <meshStandardMaterial color={b} />
          </mesh>
        ))}
      </>
    ),
  },
  sled: {
    top: 0.35,
    draw: ({ w, a, b }) => (
      <>
        {[-1, 1].map((s) => (
          <group key={s}>
            <B p={[(s * (w - 0.5)) / 2, 0.04, 0]} s={[0.05, 0.05, 0.92]} c={b} />
            <B p={[(s * (w - 0.5)) / 2, 0.12, 0.46]} s={[0.05, 0.2, 0.05]} c={b} />
          </group>
        ))}
        {[-0.3, -0.1, 0.1, 0.3].map((z) => (
          <B key={z} p={[0, 0.26, z]} s={[w - 0.4, 0.05, 0.16]} c={a} />
        ))}
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.5)) / 2, 0.16, -0.2]} s={[0.05, 0.2, 0.05]} c={b} />
        ))}
      </>
    ),
  },
  igloo: {
    top: 0,
    draw: ({ a, b }) => (
      <>
        <mesh position={[0, 0, -0.05]} castShadow receiveShadow>
          <sphereGeometry args={[0.85, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={a} roughness={0.5} />
        </mesh>
        {[0.25, 0.5, 0.7].map((y) => (
          <mesh key={y} position={[0, y, -0.05]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[Math.sqrt(0.85 * 0.85 - y * y), 0.012, 4, 30]} />
            <meshStandardMaterial color={b} />
          </mesh>
        ))}
        <mesh position={[0, 0.2, 0.62]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.28, 0.28, 0.5, 14, 1, false, -Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color={a} side={2} />
        </mesh>
        <mesh position={[0, 0.16, 0.86]}>
          <circleGeometry args={[0.22, 14, 0, Math.PI]} />
          <meshStandardMaterial color="#2b3a55" />
        </mesh>
      </>
    ),
  },

  // ---------- 🏯 Japon bahçesi ----------
  stonelantern: {
    top: 1.1,
    draw: ({ a, b, on }) => (
      <>
        <B p={[0, 0.08, 0]} s={[0.5, 0.16, 0.5]} c={a} />
        <C p={[0, 0.4, 0]} r={0.09} h={0.5} c={a} />
        <B p={[0, 0.68, 0]} s={[0.46, 0.06, 0.46]} c={a} />
        <B p={[0, 0.85, 0]} s={[0.32, 0.28, 0.32]} c={a} />
        <B p={[0, 0.85, 0.165]} s={[0.16, 0.16, 0.01]} c={on ? '#ffe9a0' : b} glow={on} line={false} />
        <mesh position={[0, 1.08, 0]} castShadow>
          <coneGeometry args={[0.4, 0.22, 4]} />
          <meshStandardMaterial color={a} flatShading />
        </mesh>
      </>
    ),
  },
  sakura: {
    top: 0,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.5, 0]} r={0.06} r2={0.09} h={1.0} c={b} />
        <mesh position={[0.15, 1.0, 0]} rotation-z={-0.7}>
          <cylinderGeometry args={[0.03, 0.05, 0.5, 6]} />
          <meshStandardMaterial color={b} />
        </mesh>
        {[
          [0, 1.3, 0, 0.42],
          [0.35, 1.15, 0.1, 0.3],
          [-0.3, 1.2, -0.1, 0.32],
          [0.1, 1.5, -0.2, 0.28],
        ].map(([x, y, z, r], i) => (
          <S key={i} p={[x, y, z]} r={r} c={i % 2 ? a : '#ffd6e5'} />
        ))}
      </>
    ),
  },
  koipond: {
    top: 0,
    draw: ({ w, a, b, c, on }) => (
      <>
        <C p={[0, 0.06, 0]} r={w / 2 - 0.05} r2={w / 2 - 0.02} h={0.12} c={b} seg={20} />
        <mesh position={[0, 0.125, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[w / 2 - 0.16, 24]} />
          <meshStandardMaterial color={a} roughness={0.1} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <Spin key={i} on={on} speed={0.6 + i * 0.25} y={0.14}>
            <mesh position={[0.25 + i * 0.15, 0, 0]} rotation-y={Math.PI / 2} scale={[0.5, 0.25, 1]}>
              <sphereGeometry args={[0.1, 10, 6]} />
              <meshStandardMaterial color={i === 1 ? '#ffffff' : c} />
            </mesh>
          </Spin>
        ))}
        <S p={[-0.45, 0.16, 0.35]} r={0.12} c="#5f8f4e" sy={0.25} />
        <S p={[0.5, 0.16, -0.3]} r={0.1} c="#5f8f4e" sy={0.25} />
      </>
    ),
  },
  bamboofence: {
    top: 0,
    draw: ({ a, b }) => (
      <>
        {[-0.36, -0.18, 0, 0.18, 0.36].map((x, i) => (
          <C key={x} p={[x, 0.45 + (i % 2) * 0.05, 0]} r={0.045} h={0.9 + (i % 2) * 0.1} c={a} seg={8} />
        ))}
        {[0.3, 0.7].map((y) => (
          <Hx key={y} p={[0, y, 0.05]} r={0.025} h={0.95} c={b} />
        ))}
      </>
    ),
  },
  stepstones: {
    top: 0,
    draw: ({ a }) => (
      <>
        {[
          [-0.2, -0.22, 0.17],
          [0.18, 0.02, 0.15],
          [-0.12, 0.28, 0.13],
        ].map(([x, z, r], i) => (
          <C key={i} p={[x, 0.025, z]} r={r} r2={r * 0.95} h={0.05} c={a} seg={9} />
        ))}
      </>
    ),
  },
  torii: {
    top: 0,
    draw: ({ w, a, b }) => (
      <>
        {[-1, 1].map((s) => (
          <C key={s} p={[(s * (w - 0.4)) / 2, 0.9, 0]} r={0.07} r2={0.09} h={1.8} c={a} />
        ))}
        <B p={[0, 1.55, 0]} s={[w - 0.2, 0.1, 0.14]} c={a} />
        <B p={[0, 1.86, 0]} s={[w + 0.1, 0.12, 0.2]} c={b} />
        <B p={[0, 1.76, 0]} s={[w - 0.1, 0.08, 0.16]} c={a} />
        <B p={[0, 1.68, 0]} s={[0.12, 0.16, 0.1]} c={a} />
      </>
    ),
  },
  zenbench: {
    top: 0.42,
    draw: ({ w, a, b }) => (
      <>
        <B p={[0, 0.4, 0]} s={[w - 0.1, 0.08, 0.5]} c={a} />
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.5)) / 2, 0.18, 0]} s={[0.2, 0.36, 0.42]} c={b} />
        ))}
      </>
    ),
  },

  // ---------- Halılar ----------
  ruground: {
    top: 0,
    draw: ({ w, a, b, c }) => (
      <>
        <C p={[0, 0.012, 0]} r={w / 2 - 0.05} h={0.024} c={a} seg={28} />
        <C p={[0, 0.026, 0]} r={w / 2 - 0.22} h={0.006} c={b} seg={28} />
        <C p={[0, 0.03, 0]} r={w / 2 - 0.42} h={0.006} c={c} seg={28} />
      </>
    ),
  },
  rugrunner: {
    top: 0,
    draw: ({ w, d, a, b }) => (
      <>
        {rugBase(w, d, a, 0.14)}
        {[-1, 1].map((s) => (
          <Flat key={s} p={[(s * (w - 0.3)) / 2, 0]} s={[0.04, d - 0.3]} c={b} />
        ))}
        {Array.from({ length: Math.round(d / 0.5) }, (_, i) => (
          <Flat key={i} p={[0, -d / 2 + 0.25 + i * 0.5]} s={[0.16, 0.16]} c={b} />
        ))}
      </>
    ),
  },
  rugrainbow: {
    top: 0,
    draw: ({ w, d }) => (
      <>
        {['#ef476f', '#ff9f43', '#ffd166', '#06d6a0', '#118ab2', '#7b5cd6'].map((c, i, all) => (
          <B key={c} p={[0, 0.012, -d / 2 + 0.05 + ((i + 0.5) * (d - 0.1)) / all.length]} s={[w - 0.08, 0.024, (d - 0.1) / all.length]} c={c} line={false} />
        ))}
      </>
    ),
  },
  rugcheck: {
    top: 0,
    draw: ({ w, d, a, b }) => {
      const n = Math.round(w * 3);
      const m = Math.round(d * 3);
      const cw = (w - 0.08) / n;
      const cd = (d - 0.08) / m;
      return (
        <>
          {rugBase(w, d, a)}
          {Array.from({ length: n * m }, (_, k) => {
            const x = k % n;
            const z = Math.floor(k / n);
            return (x + z) % 2 ? <Flat key={k} p={[-w / 2 + 0.04 + (x + 0.5) * cw, -d / 2 + 0.04 + (z + 0.5) * cd]} s={[cw, cd]} c={b} /> : null;
          })}
        </>
      );
    },
  },
  rugflower: {
    top: 0,
    draw: ({ w, a, b, c }) => (
      <>
        <C p={[0, 0.012, 0]} r={w / 2 - 0.08} h={0.024} c={a} seg={24} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 3) * 0.32, 0.028, Math.sin((i * Math.PI) / 3) * 0.32]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.24, 16]} />
            <meshStandardMaterial color={b} />
          </mesh>
        ))}
        <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.2, 16]} />
          <meshStandardMaterial color={c} />
        </mesh>
      </>
    ),
  },
  rugoval: {
    top: 0,
    draw: ({ w, d, a, b }) => (
      <>
        <mesh position={[0, 0.012, 0]} scale={[(w - 0.1) / 2, 1, (d - 0.1) / 2]}>
          <cylinderGeometry args={[1, 1, 0.024, 28]} />
          <meshStandardMaterial color={a} />
        </mesh>
        <mesh position={[0, 0.027, 0]} scale={[(w - 0.4) / 2, 1, (d - 0.4) / 2]}>
          <cylinderGeometry args={[1, 1, 0.006, 28]} />
          <meshStandardMaterial color={b} />
        </mesh>
      </>
    ),
  },

  // ---------- Bahçe ışıkları ----------
  lamppost: {
    top: 0,
    draw: ({ a, on }) => (
      <>
        <C p={[0, 0.08, 0]} r={0.16} r2={0.2} h={0.16} c={a} />
        <C p={[0, 1.0, 0]} r={0.045} h={1.8} c={a} />
        <C p={[0, 1.95, 0]} r={0.12} r2={0.18} h={0.06} c={a} />
        <Glow p={[0, 1.83, 0]} r={0.13} c="#ffe9a0" on={on} />
        <mesh position={[0, 2.03, 0]}>
          <coneGeometry args={[0.2, 0.14, 8]} />
          <meshStandardMaterial color={a} />
        </mesh>
      </>
    ),
  },
  pathlantern: {
    top: 0,
    draw: ({ a, on }) => (
      <>
        <C p={[0, 0.2, 0]} r={0.035} h={0.4} c={a} />
        <B p={[0, 0.48, 0]} s={[0.18, 0.18, 0.18]} c={a} line={false} />
        <Glow p={[0, 0.48, 0]} r={0.075} c="#ffd27a" on={on} />
        <mesh position={[0, 0.62, 0]}>
          <coneGeometry args={[0.15, 0.1, 4]} />
          <meshStandardMaterial color={a} flatShading />
        </mesh>
      </>
    ),
  },
  stringposts: {
    top: 0,
    draw: ({ w, a, on }) => (
      <>
        {[-1, 1].map((s) => (
          <C key={s} p={[(s * (w - 0.2)) / 2, 0.9, 0]} r={0.04} h={1.8} c={a} />
        ))}
        {Array.from({ length: 9 }, (_, i) => {
          const t = i / 8;
          const x = -(w - 0.2) / 2 + t * (w - 0.2);
          const y = 1.72 - Math.sin(t * Math.PI) * 0.3;
          return <Glow key={i} p={[x, y, 0]} r={0.045} c={['#ffd166', '#ff8ac2', '#7ee0ff', '#b6f37a'][i % 4]} on={on} />;
        })}
      </>
    ),
  },
  torch: {
    top: 0.95,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.45, 0]} r={0.035} r2={0.05} h={0.9} c={a} />
        <C p={[0, 0.92, 0]} r={0.09} r2={0.06} h={0.1} c={b} />
        {on && <Flame y={0.96} scale={0.45} />}
      </>
    ),
  },
  firepit: {
    top: 0.1,
    draw: ({ w, a, b, on }) => (
      <>
        {Array.from({ length: 10 }, (_, i) => {
          const ang = (i / 10) * Math.PI * 2;
          return <S key={i} p={[Math.cos(ang) * (w / 2 - 0.3), 0.1, Math.sin(ang) * (w / 2 - 0.3)]} r={0.16} c={i % 2 ? a : b} sy={0.7} />;
        })}
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 0.08, 0]} rotation={[0, (i * Math.PI) / 3, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.6, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
        ))}
        {on && <Flame y={0.1} scale={0.9} />}
      </>
    ),
  },
  mushlamp: {
    top: 0,
    draw: ({ a, b, on }) => (
      <>
        {[
          [0, 0, 0.38, 0.22],
          [0.22, 0.15, 0.24, 0.14],
          [-0.2, 0.18, 0.2, 0.12],
        ].map(([x, z, h, r], i) => (
          <group key={i} position={[x, 0, z]}>
            <C p={[0, h / 2, 0]} r={r * 0.3} h={h} c={b} />
            <mesh position={[0, h, 0]} scale={[1, 0.6, 1]}>
              <sphereGeometry args={[r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={a} emissive={a} emissiveIntensity={on ? 0.9 : 0} />
            </mesh>
          </group>
        ))}
      </>
    ),
  },
  candle3: {
    top: 0.32,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.02, 0]} r={0.24} h={0.04} c={b} />
        {[
          [-0.12, 0.22],
          [0.12, 0.16],
          [0, 0.3],
        ].map(([x, h], i) => (
          <group key={i} position={[x, 0, i === 2 ? -0.1 : 0.05]}>
            <C p={[0, 0.04 + h / 2, 0]} r={0.05} h={h} c={a} />
            {on && (
              <mesh position={[0, 0.08 + h, 0]} scale={[1, 1.8, 1]}>
                <sphereGeometry args={[0.025, 8, 6]} />
                <meshStandardMaterial color="#ffd27a" emissive="#ff9f2c" emissiveIntensity={1.6} toneMapped={false} />
              </mesh>
            )}
          </group>
        ))}
      </>
    ),
  },
  picket: {
    top: 0,
    draw: ({ a }) => (
      <>
        {[-0.36, -0.12, 0.12, 0.36].map((x) => (
          <group key={x}>
            <B p={[x, 0.36, 0]} s={[0.12, 0.72, 0.05]} c={a} />
            <mesh position={[x, 0.76, 0]} rotation-z={Math.PI / 4}>
              <boxGeometry args={[0.085, 0.085, 0.05]} />
              <meshStandardMaterial color={a} />
            </mesh>
          </group>
        ))}
        {[0.22, 0.55].map((y) => (
          <B key={y} p={[0, y, -0.04]} s={[0.98, 0.07, 0.03]} c={a} line={false} />
        ))}
      </>
    ),
  },

  // ---------- 🛝 Oyun parkı ----------
  slide: {
    top: 0,
    draw: ({ d, a, b, c }) => (
      <>
        {[-1, 1].map((s) => (
          <group key={s}>
            <B p={[s * 0.32, 0.6, -d / 2 + 0.3]} s={[0.06, 1.2, 0.06]} c={b} />
            <B p={[s * 0.32, 0.6, -d / 2 + 0.05]} s={[0.06, 1.2, 0.06]} c={b} />
          </group>
        ))}
        <B p={[0, 1.2, -d / 2 + 0.18]} s={[0.7, 0.06, 0.36]} c={c} />
        {[0.3, 0.6, 0.9].map((y) => (
          <B key={y} p={[0, y, -d / 2 + 0.05]} s={[0.6, 0.04, 0.04]} c={b} line={false} />
        ))}
        <group position={[0, 0.65, 0.18]} rotation-x={0.62}>
          <B p={[0, 0, 0]} s={[0.56, 0.04, d - 0.15]} c={a} />
          {[-1, 1].map((s) => (
            <B key={s} p={[s * 0.3, 0.06, 0]} s={[0.05, 0.12, d - 0.15]} c={a} line={false} />
          ))}
        </group>
      </>
    ),
  },
  seesaw: {
    top: 0.5,
    draw: ({ w, a, b, c }) => (
      <>
        <mesh position={[0, 0.2, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.2, 0.2, 0.3, 3]} />
          <meshStandardMaterial color={c} />
        </mesh>
        <group position={[0, 0.42, 0]} rotation-z={0.12}>
          <B p={[0, 0, 0]} s={[w - 0.1, 0.06, 0.26]} c={a} />
          {[-1, 1].map((s) => (
            <group key={s}>
              <B p={[(s * (w - 0.4)) / 2, 0.06, 0]} s={[0.24, 0.06, 0.28]} c={b} />
              <B p={[(s * (w - 0.7)) / 2, 0.18, 0]} s={[0.04, 0.2, 0.2]} c={c} line={false} />
            </group>
          ))}
        </group>
      </>
    ),
  },
  trampoline: {
    top: 0.42,
    draw: ({ w, a, b, on }) => (
      <>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const ang = (i / 6) * Math.PI * 2;
          return <C key={i} p={[Math.cos(ang) * (w / 2 - 0.15), 0.2, Math.sin(ang) * (w / 2 - 0.15)]} r={0.03} h={0.4} c={b} />;
        })}
        <mesh position={[0, 0.4, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[w / 2 - 0.12, 0.06, 8, 30]} />
          <meshStandardMaterial color={a} />
        </mesh>
        <Bob on={on} amp={0.05} freq={6}>
          <mesh position={[0, 0.38, 0]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[w / 2 - 0.18, 28]} />
            <meshStandardMaterial color="#1f2226" />
          </mesh>
        </Bob>
      </>
    ),
  },
  sandbox: {
    top: 0.2,
    draw: ({ w, d, a, b }) => (
      <>
        {[-1, 1].map((s) => (
          <group key={s}>
            <B p={[(s * (w - 0.1)) / 2, 0.12, 0]} s={[0.1, 0.24, d]} c={a} />
            <B p={[0, 0.12, (s * (d - 0.1)) / 2]} s={[w, 0.24, 0.1]} c={a} />
          </group>
        ))}
        <B p={[0, 0.1, 0]} s={[w - 0.2, 0.16, d - 0.2]} c="#f2d59b" line={false} />
        <S p={[0.25, 0.2, 0.2]} r={0.14} c="#e8c27a" sy={0.6} />
        <C p={[-0.3, 0.24, -0.2]} r={0.1} r2={0.13} h={0.16} c={b} />
      </>
    ),
  },

  // ---------- 🌟 Nadir ağaç ödülleri (yalnızca nadir ağaç gününden: items.json → drop) ----------
  crystaltree: {
    top: 0,
    draw: ({ a, b, c, on }) => (
      <>
        <S p={[0, 0.06, 0]} r={0.26} c={c} sy={0.35} />
        <C p={[0, 0.4, 0]} r={0.05} r2={0.08} h={0.66} c={b} />
        {[
          [0, 0.92, 0, 0.2],
          [0.2, 0.74, 0.06, 0.13],
          [-0.19, 0.78, -0.04, 0.14],
          [0.06, 0.72, -0.2, 0.12],
          [-0.05, 0.7, 0.2, 0.11],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} rotation-y={i * 0.7} scale={[1, 1.5, 1]} castShadow>
            <octahedronGeometry args={[r, 0]} />
            <meshStandardMaterial color={a} emissive={a} emissiveIntensity={on ? 0.9 : 0.12} transparent opacity={0.9} roughness={0.15} metalness={0.2} />
          </mesh>
        ))}
      </>
    ),
  },
  fireflyjar: {
    top: 0.36,
    draw: ({ a, b, on }) => (
      <>
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.13, 0.12, 0.3, 16]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.35} roughness={0.05} depthWrite={false} />
        </mesh>
        <C p={[0, 0.33, 0]} r={0.135} h={0.05} c={b} />
        {[
          [0.04, 0.1, 0.03, 0],
          [-0.05, 0.17, -0.02, 1.7],
          [0.02, 0.24, -0.05, 3.1],
          [-0.03, 0.12, 0.06, 4.4],
        ].map(([x, y, z, ph], i) => (
          <Bob key={i} on={on} amp={0.025} freq={3 + i * 0.4} phase={ph}>
            <Glow p={[x, y, z]} r={0.028} c={a} on={on} dim="#c4cc6a" />
          </Bob>
        ))}
      </>
    ),
  },
  goldsapling: {
    top: 0,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.14, 0]} r={0.2} r2={0.15} h={0.28} c={c} />
        <C p={[0, 0.29, 0]} r={0.21} h={0.04} c={c} />
        <C p={[0, 0.52, 0]} r={0.025} r2={0.04} h={0.46} c={b} />
        {[
          [0, 0.82, 0, 0.13],
          [0.12, 0.68, 0.04, 0.09],
          [-0.11, 0.7, -0.03, 0.09],
          [0.02, 0.62, -0.11, 0.08],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} castShadow>
            <icosahedronGeometry args={[r, 0]} />
            <meshStandardMaterial color={a} emissive={a} emissiveIntensity={0.25} metalness={0.7} roughness={0.25} flatShading />
          </mesh>
        ))}
      </>
    ),
  },
  moonlamp: {
    top: 0,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.04, 0]} r={0.2} h={0.08} c={b} />
        <C p={[0, 0.3, 0]} r={0.025} h={0.48} c={b} />
        <Glow p={[0, 0.76, 0]} r={0.27} c={a} on={on} dim="#d8d4cc" />
        {[
          [0.12, 0.86, 0.2, 0.05],
          [-0.14, 0.7, 0.21, 0.04],
          [0.02, 0.64, 0.25, 0.03],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[r, 10, 8]} />
            <meshStandardMaterial color="#c9c2ad" />
          </mesh>
        ))}
      </>
    ),
  },
  leafrug: {
    top: 0,
    draw: ({ w, d, a, b }) => {
      const r = Math.min(w, d) * 0.62;
      return (
        // Yaprak köşegen boyunca uzanır; damarlar orta damardan uca doğru çapraz çıkar
        <group rotation-y={Math.PI / 4}>
          <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} scale={[1, 0.5, 1]} receiveShadow>
            <circleGeometry args={[r, 32]} />
            <meshStandardMaterial color={a} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[r * 1.9, 0.05]} />
            <meshStandardMaterial color={b} />
          </mesh>
          {[-0.5, -0.1, 0.3].flatMap((t) =>
            [-1, 1].map((k) => (
              <mesh key={`${t}${k}`} position={[t * r + 0.1, 0.02, k * 0.13]} rotation-x={-Math.PI / 2} rotation-z={-k * 0.65}>
                <planeGeometry args={[0.38, 0.035]} />
                <meshStandardMaterial color={b} />
              </mesh>
            )),
          )}
        </group>
      );
    },
  },
  owlstatue: {
    top: 0,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.15, 0]} s={[0.56, 0.3, 0.56]} c={b} />
        <S p={[0, 0.55, 0]} r={0.22} c={a} sy={1.25} />
        <S p={[0, 0.86, 0.02]} r={0.18} c={a} />
        {/* Kanatlar, kulaklar, gözler ve gaga öne (+z) bakar */}
        {[-1, 1].map((k) => (
          <group key={k}>
            <mesh position={[k * 0.2, 0.55, 0.02]} rotation-z={k * 0.18} scale={[0.35, 1, 0.8]} castShadow>
              <sphereGeometry args={[0.2, 12, 10]} />
              <meshStandardMaterial color={b} roughness={0.7} flatShading />
            </mesh>
            <S p={[k * 0.075, 0.9, 0.15]} r={0.065} c="#fff6d8" />
            <Glow p={[k * 0.075, 0.9, 0.21]} r={0.03} c={c} on dim={c} />
            <mesh position={[k * 0.11, 1.04, 0.02]} rotation-z={-k * 0.35}>
              <coneGeometry args={[0.045, 0.12, 6]} />
              <meshStandardMaterial color={a} flatShading />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.83, 0.2]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.03, 0.08, 6]} />
          <meshStandardMaterial color="#e0a33a" />
        </mesh>
      </>
    ),
  },
};
