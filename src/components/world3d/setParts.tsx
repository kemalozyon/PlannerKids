// Habbo tarzı set parçalarının ortak çizim yardımcıları (Sets.tsx, SetsMore.tsx): ince koyu konturlu kutu,
// silindir, küre ve dört ayak. Parça ayak izinin ortasında, önü yerel +z'ye bakar, y = 0 zemin.
import { Outlines } from '@react-three/drei';
import type { ReactNode } from 'react';

export const INK = '#2b2622';

export type V3 = [number, number, number];

/** Konturlu kutu */
export function B({ p, s, c, glow, line = true }: { p: V3; s: V3; c: string; glow?: boolean; line?: boolean }) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.68} emissive={glow ? c : '#000000'} emissiveIntensity={glow ? 0.8 : 0} />
      {line && <Outlines thickness={0.018} color={INK} />}
    </mesh>
  );
}

/** Konturlu silindir (dik) */
export function C({ p, r, h, c, r2, seg = 16, glow }: { p: V3; r: number; h: number; c: string; r2?: number; seg?: number; glow?: boolean }) {
  return (
    <mesh position={p} castShadow>
      <cylinderGeometry args={[r2 ?? r, r, h, seg]} />
      <meshStandardMaterial color={c} roughness={0.6} emissive={glow ? c : '#000000'} emissiveIntensity={glow ? 0.8 : 0} />
      <Outlines thickness={0.018} color={INK} />
    </mesh>
  );
}

/** Konturlu küre */
export function S({ p, r, c, sy = 1 }: { p: V3; r: number; c: string; sy?: number }) {
  return (
    <mesh position={p} scale={[1, sy, 1]} castShadow>
      <sphereGeometry args={[r, 16, 12]} />
      <meshStandardMaterial color={c} roughness={0.6} flatShading />
      <Outlines thickness={0.018} color={INK} />
    </mesh>
  );
}

/** Dört ayak (kare kesit) */
export const legs = (w: number, d: number, h: number, c: string, t = 0.07) =>
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sz], i) => <B key={`l${i}`} p={[(sx * (w - t)) / 2, h / 2, (sz * (d - t)) / 2]} s={[t, h, t]} c={c} />);

export interface Ctx {
  w: number;
  d: number;
  /** Renkler: ana, ikinci, üçüncü */
  a: string;
  b: string;
  c: string;
  /** TOGGLE açık (ışık, hareket) */
  on: boolean;
  /** OPEN_CLOSE: kapak/kapı açık */
  open: boolean;
}


/** Parça: üst yüzey yüksekliği (masa üstüne küçük eşya konur) ve çizimi */
export interface Piece {
  top: number;
  draw: (x: Ctx) => ReactNode;
}
