// Habbo tarzı eşya setleri (Pura, Mode, Kulübe, Plasto, Banyo, Mutfak, Bitkiler): kodla çizilen tıknaz, düz renkli,
// ince koyu konturlu parçalar. Habbo'nun çizimleri kopyalanmadı; yalnızca tarzından (kalın çizgiler, sade
// kutular, canlı renkler) ilham alındı. Her parça items.json → piece ile seçilir, renkleri colors ile verilir
// ([ana, ikinci, üçüncü]). Ayak izinin ortasında, önü yerel +z'ye bakar (items.tsx → ItemModel döndürür).
import { Outlines } from '@react-three/drei';
import type { Item } from '../../lib/catalog';
import { footSize } from '../../lib/world';
import { B, C, INK, legs, S, type Piece, type V3 } from './setParts';
import { MORE_PIECES } from './SetsMore';

/** Parçalar: çizim ve üst yüzey yüksekliği (masa üstüne küçük eşya konur) */
const BASE: Record<string, Piece> = {
  sofa: {
    top: 0.45,
    draw: ({ w, a, b }) => (
      <>
        <B p={[0, 0.22, 0.02]} s={[w - 0.1, 0.32, 0.8]} c={a} />
        <B p={[0, 0.42, 0.06]} s={[w - 0.42, 0.1, 0.62]} c={b} />
        <B p={[0, 0.62, -0.3]} s={[w - 0.1, 0.62, 0.22]} c={a} />
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.26)) / 2, 0.42, 0.02]} s={[0.16, 0.42, 0.8]} c={a} />
        ))}
      </>
    ),
  },
  armchair: {
    top: 0.45,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.22, 0.02]} s={[0.84, 0.32, 0.8]} c={a} />
        <B p={[0, 0.42, 0.06]} s={[0.54, 0.1, 0.62]} c={b} />
        <B p={[0, 0.66, -0.3]} s={[0.84, 0.7, 0.2]} c={a} />
        {[-1, 1].map((s) => (
          <B key={s} p={[s * 0.35, 0.42, 0.02]} s={[0.14, 0.42, 0.8]} c={a} />
        ))}
      </>
    ),
  },
  chair: {
    top: 0.5,
    draw: ({ a, b }) => (
      <>
        {legs(0.56, 0.56, 0.44, b, 0.06)}
        <B p={[0, 0.47, 0]} s={[0.62, 0.08, 0.62]} c={a} />
        <B p={[0, 0.82, -0.27]} s={[0.62, 0.62, 0.08]} c={a} />
      </>
    ),
  },
  stool: {
    top: 0.55,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.27, 0]} r={0.05} h={0.54} c={b} />
        <C p={[0, 0.02, 0]} r={0.22} h={0.04} c={b} />
        <C p={[0, 0.58, 0]} r={0.24} h={0.1} c={a} />
      </>
    ),
  },
  pod: {
    top: 0.42,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.06, 0]} r={0.3} r2={0.22} h={0.12} c={b} />
        <S p={[0, 0.5, -0.02]} r={0.44} c={a} sy={0.95} />
        <B p={[0, 0.42, 0.18]} s={[0.56, 0.12, 0.42]} c={b} line={false} />
      </>
    ),
  },
  table: {
    top: 0.74,
    draw: ({ w, d, a, b }) => (
      <>
        <B p={[0, 0.7, 0]} s={[w - 0.08, 0.08, d - 0.12]} c={a} />
        {legs(w - 0.2, d - 0.24, 0.66, b)}
      </>
    ),
  },
  coffee: {
    top: 0.38,
    draw: ({ w, d, a, b }) => (
      <>
        <B p={[0, 0.34, 0]} s={[w - 0.14, 0.08, d - 0.2]} c={a} />
        <B p={[0, 0.15, 0]} s={[w - 0.4, 0.3, d - 0.46]} c={b} />
      </>
    ),
  },
  bed: {
    top: 0.5,
    draw: ({ d, a, b, c }) => (
      <>
        <B p={[0, 0.17, 0]} s={[0.9, 0.3, d - 0.08]} c={a} />
        <B p={[0, 0.38, 0.06]} s={[0.84, 0.14, d - 0.24]} c={b} />
        <B p={[0, 0.48, -d / 2 + 0.3]} s={[0.6, 0.1, 0.3]} c="#ffffff" />
        <B p={[0, 0.46, 0.3]} s={[0.86, 0.06, d / 2]} c={c} />
        <B p={[0, 0.55, -d / 2 + 0.06]} s={[0.94, 0.8, 0.1]} c={a} />
      </>
    ),
  },
  shelf: {
    top: 1.6,
    draw: ({ w, a, b, c }) => (
      <>
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.12)) / 2, 0.8, -0.2]} s={[0.08, 1.6, 0.4]} c={a} />
        ))}
        <B p={[0, 0.8, -0.38]} s={[w - 0.1, 1.6, 0.04]} c={b} />
        {[0.05, 0.55, 1.05, 1.56].map((y) => (
          <B key={y} p={[0, y, -0.2]} s={[w - 0.12, 0.06, 0.4]} c={a} />
        ))}
        {/* Raflarda birkaç renkli kutu */}
        <B p={[-0.15, 0.7, -0.2]} s={[0.18, 0.24, 0.26]} c={c} />
        <B p={[0.18, 1.2, -0.2]} s={[0.24, 0.2, 0.26]} c={b} />
      </>
    ),
  },
  zshelf: {
    top: 1.2,
    draw: ({ a, b }) => (
      <>
        <B p={[0, 0.04, 0]} s={[0.8, 0.08, 0.5]} c={a} />
        <B p={[0, 0.6, 0]} s={[0.08, 1.12, 0.5]} c={a} line />
        <B p={[0, 0.6, 0]} s={[0.8, 0.06, 0.5]} c={b} />
        <B p={[0, 1.16, 0]} s={[0.8, 0.08, 0.5]} c={a} />
        <B p={[0.36, 0.32, 0]} s={[0.08, 0.5, 0.5]} c={a} />
        <B p={[-0.36, 0.88, 0]} s={[0.08, 0.5, 0.5]} c={a} />
      </>
    ),
  },
  bar: {
    top: 1.05,
    draw: ({ w, a, b, c }) => (
      <>
        <B p={[0, 0.5, 0.05]} s={[w - 0.1, 1, 0.6]} c={a} />
        <B p={[0, 1.03, 0.1]} s={[w - 0.02, 0.06, 0.78]} c={b} />
        <B p={[0, 0.5, 0.36]} s={[w - 0.3, 0.12, 0.02]} c={c} />
      </>
    ),
  },
  counter: {
    top: 0.92,
    draw: ({ w, a, b, c }) => (
      <>
        <B p={[0, 0.44, 0]} s={[w - 0.06, 0.84, 0.8]} c={a} />
        <B p={[0, 0.89, 0.02]} s={[w - 0.02, 0.06, 0.86]} c={b} />
        <B p={[0, 0.62, 0.41]} s={[0.2, 0.04, 0.03]} c={c} />
      </>
    ),
  },
  stove: {
    top: 0.92,
    draw: ({ a, b, c, on }) => (
      <>
        <B p={[0, 0.44, 0]} s={[0.92, 0.84, 0.8]} c={a} />
        <B p={[0, 0.89, 0.02]} s={[0.94, 0.06, 0.86]} c={b} />
        <B p={[0, 0.42, 0.41]} s={[0.6, 0.4, 0.02]} c="#2f3338" />
        <B p={[0, 0.7, 0.41]} s={[0.66, 0.04, 0.03]} c={c} />
        {[
          [-0.2, -0.18],
          [0.2, -0.18],
          [-0.2, 0.18],
          [0.2, 0.18],
        ].map(([x, z], i) => (
          <C key={i} p={[x, 0.93, z]} r={0.12} h={0.02} c={on ? '#ff6a3d' : '#2f3338'} glow={on} />
        ))}
      </>
    ),
  },
  fridge: {
    top: 1.9,
    // Kapı sol kenarından açılır (OPEN_CLOSE): içi rafları ve şişeleriyle görünür
    draw: ({ a, b, c, open }) => (
      <>
        <B p={[0, 0.95, -0.03]} s={[0.84, 1.9, 0.74]} c={a} />
        {open && (
          <>
            <B p={[0, 0.95, 0.335]} s={[0.74, 1.76, 0.01]} c="#eef6fb" line={false} />
            {[0.55, 1.05, 1.5].map((y) => (
              <B key={y} p={[0, y, 0.3]} s={[0.72, 0.03, 0.08]} c="#cfe3ee" line={false} />
            ))}
            {['#ff9f43', '#7ec8ff', '#e53935'].map((col, i) => (
              <C key={col} p={[-0.22 + i * 0.22, 0.7, 0.3]} r={0.05} h={0.26} c={col} />
            ))}
          </>
        )}
        <group position={[-0.42, 0, 0.37]} rotation-y={open ? -1.9 : 0}>
          <group position={[0.42, 0, 0]}>
            <B p={[0, 0.95, 0]} s={[0.84, 1.9, 0.06]} c={a} />
            <B p={[0, 1.32, 0.035]} s={[0.8, 0.02, 0.02]} c={b} line={false} />
            {[0.95, 1.65].map((y) => (
              <B key={y} p={[0.3, y, 0.06]} s={[0.05, 0.36, 0.05]} c={c} />
            ))}
          </group>
        </group>
      </>
    ),
  },
  dishwasher: {
    top: 0.92,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.44, 0]} s={[0.92, 0.84, 0.8]} c={a} />
        <B p={[0, 0.89, 0.02]} s={[0.94, 0.06, 0.86]} c={b} />
        <B p={[0, 0.76, 0.41]} s={[0.6, 0.05, 0.04]} c={c} />
        <B p={[0.3, 0.83, 0.41]} s={[0.14, 0.05, 0.02]} c="#58d68d" glow />
      </>
    ),
  },
  sink: {
    top: 0.92,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.42, 0]} s={[0.9, 0.8, 0.78]} c={a} />
        <B p={[0, 0.86, 0]} s={[0.94, 0.1, 0.84]} c={b} />
        <B p={[0, 0.88, 0.04]} s={[0.56, 0.08, 0.46]} c="#cfe7f5" line={false} />
        <C p={[0, 1.02, -0.3]} r={0.03} h={0.26} c={c} />
        <B p={[0, 1.13, -0.22]} s={[0.05, 0.05, 0.18]} c={c} />
      </>
    ),
  },
  toilet: {
    top: 0.45,
    draw: ({ a, b }) => (
      <>
        <C p={[0, 0.2, 0.06]} r={0.2} r2={0.26} h={0.4} c={a} />
        <C p={[0, 0.43, 0.06]} r={0.27} h={0.06} c={b} />
        <B p={[0, 0.62, -0.3]} s={[0.56, 0.5, 0.2]} c={a} />
        <B p={[0, 0.89, -0.3]} s={[0.6, 0.05, 0.24]} c={b} />
      </>
    ),
  },
  bathtub: {
    top: 0.55,
    draw: ({ w, a, b, c }) => (
      <>
        <B p={[0, 0.28, 0]} s={[w - 0.1, 0.5, 0.86]} c={a} />
        <B p={[0, 0.5, 0]} s={[w - 0.34, 0.06, 0.62]} c="#9fd8f5" line={false} />
        <B p={[0, 0.55, 0]} s={[w - 0.08, 0.06, 0.88]} c={b} />
        <C p={[-w / 2 + 0.24, 0.72, 0]} r={0.03} h={0.3} c={c} />
      </>
    ),
  },
  shower: {
    top: 2,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.04, 0]} s={[0.92, 0.08, 0.92]} c={a} />
        <B p={[0, 1.05, -0.43]} s={[0.92, 2, 0.06]} c={b} />
        <B p={[-0.43, 1.05, 0]} s={[0.06, 2, 0.92]} c="#bfe6ff" />
        <C p={[0.25, 1.85, -0.3]} r={0.1} h={0.04} c={c} />
        <C p={[0.25, 1.95, -0.38]} r={0.02} h={0.2} c={c} />
      </>
    ),
  },
  lamp: {
    top: 1.5,
    draw: ({ a, b, on }) => (
      <>
        <C p={[0, 0.03, 0]} r={0.2} h={0.06} c={b} />
        <C p={[0, 0.7, 0]} r={0.03} h={1.3} c={b} />
        <C p={[0, 1.4, 0]} r={0.28} r2={0.18} h={0.34} c={on ? '#fff2c0' : a} glow={on} />
      </>
    ),
  },
  bench: {
    top: 0.45,
    draw: ({ w, a, b }) => (
      <>
        <B p={[0, 0.42, 0.05]} s={[w - 0.1, 0.1, 0.5]} c={a} />
        <B p={[0, 0.72, -0.24]} s={[w - 0.1, 0.36, 0.08]} c={a} />
        {[-1, 1].map((s) => (
          <B key={s} p={[(s * (w - 0.3)) / 2, 0.2, 0.05]} s={[0.12, 0.4, 0.46]} c={b} />
        ))}
      </>
    ),
  },
  cabinet: {
    top: 1.7,
    // İki kapak dışa açılır (OPEN_CLOSE)
    draw: ({ w, a, b, c, open }) => (
      <>
        <B p={[0, 0.85, -0.08]} s={[w - 0.08, 1.7, 0.64]} c={a} />
        <B p={[0, 1.72, -0.05]} s={[w, 0.06, 0.76]} c={b} />
        {open && (
          <>
            <B p={[0, 0.85, 0.24]} s={[w - 0.2, 1.56, 0.01]} c="#4a3524" line={false} />
            {[0.5, 1.1].map((y) => (
              <B key={y} p={[0, y, 0.2]} s={[w - 0.22, 0.03, 0.1]} c={b} line={false} />
            ))}
          </>
        )}
        {[-1, 1].map((s) => (
          <group key={s} position={[(s * (w - 0.08)) / 2, 0, 0.26]} rotation-y={open ? s * 1.7 : 0}>
            <B p={[(-s * (w - 0.08)) / 4, 0.85, 0.02]} s={[(w - 0.1) / 2, 1.56, 0.04]} c={a} />
            <B p={[(-s * (w - 0.08)) / 2 + s * 0.08, 0.9, 0.06]} s={[0.04, 0.22, 0.04]} c={c} />
          </group>
        ))}
      </>
    ),
  },
  divider: {
    top: 1.3,
    draw: ({ w, a, b }) => (
      <>
        <B p={[0, 0.66, 0]} s={[w - 0.06, 1.2, 0.14]} c={a} />
        <B p={[0, 1.3, 0]} s={[w, 0.08, 0.2]} c={b} />
        <B p={[0, 0.04, 0]} s={[w, 0.08, 0.3]} c={b} />
      </>
    ),
  },
  bonsai: {
    top: 0.9,
    draw: ({ a, b, c }) => (
      <>
        <B p={[0, 0.1, 0]} s={[0.56, 0.2, 0.36]} c={b} />
        <B p={[0.02, 0.36, 0]} s={[0.08, 0.36, 0.08]} c={c} />
        <B p={[0.1, 0.5, 0]} s={[0.26, 0.06, 0.06]} c={c} />
        <S p={[-0.08, 0.62, 0]} r={0.2} c={a} sy={0.6} />
        <S p={[0.2, 0.56, 0.02]} r={0.14} c={a} sy={0.6} />
      </>
    ),
  },
  rose: {
    top: 0.8,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.16, 0]} r={0.16} r2={0.2} h={0.32} c={b} />
        <C p={[0, 0.45, 0]} r={0.02} h={0.3} c={c} />
        {[
          [0, 0.66, 0],
          [-0.1, 0.6, 0.06],
          [0.1, 0.62, -0.04],
        ].map((q, i) => (
          <S key={i} p={q as V3} r={0.08} c={a} />
        ))}
      </>
    ),
  },
  yucca: {
    top: 1.5,
    draw: ({ a, b, c }) => (
      <>
        <C p={[0, 0.2, 0]} r={0.18} r2={0.24} h={0.4} c={b} />
        <C p={[0, 0.75, 0]} r={0.06} h={0.8} c={c} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[Math.cos(i) * 0.12, 1.25, Math.sin(i) * 0.12]} rotation={[Math.sin(i) * 0.6, i, Math.cos(i) * 0.6]} castShadow>
            <boxGeometry args={[0.08, 0.6, 0.02]} />
            <meshStandardMaterial color={a} />
            <Outlines thickness={0.012} color={INK} />
          </mesh>
        ))}
      </>
    ),
  },
};

const PIECES: Record<string, Piece> = { ...BASE, ...MORE_PIECES };

/** Setteki parçanın üst yüzey yüksekliği (OnSurface) */
export const pieceTop = (item: Item): number => PIECES[item.piece ?? '']?.top ?? 0.6;

/** Set parçası; seçili renk (CHANGE_COLOR) ana rengin yerine geçer */
export function SetPiece({ item, on, lit, open = false, color }: { item: Item; on: boolean; lit: boolean; open?: boolean; color?: string }) {
  const piece = PIECES[item.piece ?? ''];
  if (!piece) return null;
  const [w, d] = footSize(item, 0);
  const [a, b, c] = [color ?? item.colors?.[0] ?? '#8fc1e8', item.colors?.[1] ?? '#ffffff', item.colors?.[2] ?? '#5a6b7a'];
  return (
    <group>
      {piece.draw({ w, d, a, b, c, on, open })}
      {on && lit && item.fx === 'light' && <pointLight position={[0, piece.top * 0.9, 0.15]} color={color ?? '#ffd9a0'} intensity={2.6} distance={4.5} decay={1.5} />}
    </group>
  );
}

/** Parçanın adı tanımlı mı (testler) */
export const hasPiece = (id: string) => id in PIECES;
