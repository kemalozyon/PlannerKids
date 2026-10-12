import type { ReactNode } from 'react';
import { speciesById, STAGES } from '../lib/forest';

/**
 * Bir günün bitkisi. stage: 0 Tohum, 1 Çiçek, 2 Küçük ağaç, 3 Büyük ağaç, 4 Dev ağaç.
 * viewBox 100x140; zemin y=132, merkez x=50. Ağaçlar tam boy çizilir ve evreye göre ölçeklenir.
 */
export default function Tree({
  species,
  stage,
  size = 80,
  className,
}: {
  species: string;
  stage: number;
  size?: number;
  className?: string;
}) {
  const sp = speciesById(species);
  const s = Math.max(0, Math.min(4, stage));
  const scale = [0, 0, 0.6, 0.82, 1][s];
  return (
    <svg
      className={`tree ${className ?? ''}`}
      viewBox="0 0 100 140"
      width={size}
      height={size * 1.4}
      role="img"
      aria-label={`${sp.name}, ${STAGES[s].name}`}
    >
      {s === 0 ? (
        <Seed />
      ) : s === 1 ? (
        <Bloom color={sp.bloom} />
      ) : (
        <g transform={`translate(50 132) scale(${scale}) translate(-50 -132)`}>
          {DRAW[sp.id]?.(s === 4) ?? DRAW.elma(s === 4)}
        </g>
      )}
    </svg>
  );
}

const TRUNK = '#8a5a36';
const TRUNK_DARK = '#6b4630';

function Seed() {
  return (
    <g>
      <ellipse cx="50" cy="132" rx="16" ry="6" fill="#8a5a36" />
      <ellipse cx="50" cy="128" rx="5" ry="3.5" fill="#c9965e" />
      <path d="M50 125 q-1 -6 3 -9" stroke="#3a9d5d" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <ellipse cx="55" cy="115.5" rx="3.6" ry="1.8" fill="#5cc27f" transform="rotate(-25 55 115.5)" />
    </g>
  );
}

function Bloom({ color }: { color: string }) {
  return (
    <g>
      <ellipse cx="50" cy="132" rx="14" ry="4.5" fill="#8a5a36" />
      <path d="M50 131 Q 47 112 50 92" stroke="#2f7f4a" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="40" cy="116" rx="9" ry="3.8" fill="#3a9d5d" transform="rotate(-25 40 116)" />
      <ellipse cx="60" cy="108" rx="9" ry="3.8" fill="#5cc27f" transform="rotate(25 60 108)" />
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="50" cy="81" rx="6" ry="9" fill={color} transform={`rotate(${a} 50 90)`} />
      ))}
      <circle cx="50" cy="90" r="5.5" fill="#f2c230" />
    </g>
  );
}

function Trunk({ top = 82, w = 9 }: { top?: number; w?: number }) {
  return (
    <>
      <path d={`M${50 - w / 2 - 2} 132 L${50 - w / 2} ${top} L${50 + w / 2} ${top} L${50 + w / 2 + 2} 132 Z`} fill={TRUNK} />
      <ellipse cx="50" cy="132" rx="18" ry="4" fill="#00000018" />
    </>
  );
}

function Blobs({ blobs }: { blobs: [number, number, number, string][] }) {
  return (
    <>
      {blobs.map(([x, y, r, c], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={c} />
      ))}
    </>
  );
}

function Fruits({ pts, color, r = 3.6 }: { pts: [number, number][]; color: string; r?: number }) {
  return (
    <>
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={color} />
      ))}
    </>
  );
}

function Sparkle({ x, y, r, color = '#f2c230' }: { x: number; y: number; r: number; color?: string }) {
  return (
    <path
      className="tw"
      fill={color}
      d={`M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z`}
    />
  );
}

const DRAW: Record<string, (giant: boolean) => ReactNode> = {
  elma: (giant) => (
    <>
      <Trunk top={80} />
      <Blobs
        blobs={[
          [30, 78, 20, '#3a9d5d'],
          [70, 76, 21, '#3a9d5d'],
          [50, 62, 30, '#4caf6a'],
          [50, 40, 20, '#5cc27f'],
          ...(giant ? ([[18, 62, 14, '#4caf6a'], [82, 60, 14, '#4caf6a']] as [number, number, number, string][]) : []),
        ]}
      />
      <Fruits color="#e2453c" pts={giant ? [[36, 58], [62, 50], [70, 80], [28, 82], [50, 74], [84, 64]] : [[38, 60], [64, 54], [56, 80]]} />
    </>
  ),
  cam: (giant) => (
    <>
      <Trunk top={110} w={8} />
      <path d="M50 118 L8 118 L50 60 L92 118 Z" fill="#1f7a4a" />
      <path d="M50 96 L14 96 L50 40 L86 96 Z" fill="#26905a" />
      <path d="M50 72 L22 72 L50 20 L78 72 Z" fill="#2fa566" />
      {giant && (
        <>
          <path d="M50 22 L46 30 L54 30 Z" fill="#2fa566" />
          <Sparkle x={50} y={14} r={7} />
          <Fruits color="#f2c230" pts={[[34, 88], [64, 104], [56, 62], [40, 110]]} r={2.6} />
        </>
      )}
    </>
  ),
  kiraz: (giant) => (
    <>
      <Trunk top={84} w={8} />
      <path d="M50 92 L32 74 M50 88 L70 70" stroke={TRUNK} strokeWidth="5" strokeLinecap="round" />
      <Blobs
        blobs={[
          [28, 72, 19, '#f5a7c4'],
          [72, 70, 19, '#f5a7c4'],
          [50, 58, 27, '#f08bb4'],
          [38, 44, 16, '#f8bdd3'],
          [62, 42, 16, '#f8bdd3'],
          ...(giant ? ([[14, 58, 12, '#f8bdd3'], [86, 58, 12, '#f8bdd3']] as [number, number, number, string][]) : []),
        ]}
      />
      <Fruits color="#c2185b" pts={giant ? [[40, 62], [60, 52], [30, 78], [72, 76], [50, 40]] : [[42, 62], [62, 56]]} r={3} />
      {giant && (
        <>
          <circle cx="22" cy="104" r="2.5" fill="#f8bdd3" />
          <circle cx="80" cy="112" r="2.5" fill="#f5a7c4" />
        </>
      )}
    </>
  ),
  palmiye: (giant) => (
    <>
      <path d="M50 132 Q 40 90 56 40" stroke={TRUNK} strokeWidth="9" fill="none" strokeLinecap="round" />
      {[118, 104, 90, 76, 62, 50].map((y, i) => (
        <path key={y} d={`M${i < 2 ? 44 : 45 + i} ${y} l9 -2`} stroke={TRUNK_DARK} strokeWidth="2" />
      ))}
      {[
        'M56 40 Q 30 26 8 46',
        'M56 40 Q 40 16 18 18',
        'M56 40 Q 64 10 84 16',
        'M56 40 Q 82 30 94 52',
        'M56 40 Q 72 44 80 66',
        'M56 40 Q 40 46 30 68',
      ].map((d, i) => (
        <path key={i} d={d} stroke={i % 2 ? '#2fa566' : '#3a9d5d'} strokeWidth="9" fill="none" strokeLinecap="round" />
      ))}
      <Fruits color="#8a5a36" pts={giant ? [[52, 46], [60, 46], [56, 52], [48, 52]] : [[52, 47], [60, 47]]} r={4.2} />
    </>
  ),
  akcaagac: (giant) => (
    <>
      <Trunk top={82} />
      <Blobs
        blobs={[
          [28, 76, 19, '#d1442f'],
          [72, 74, 20, '#e2683c'],
          [50, 60, 28, '#f2a03d'],
          [34, 46, 15, '#e2683c'],
          [64, 42, 17, '#d1442f'],
          ...(giant ? ([[16, 60, 12, '#f2a03d'], [86, 58, 12, '#e2683c']] as [number, number, number, string][]) : []),
        ]}
      />
      {giant && (
        <>
          <path d="M20 112 l4 -3 l2 4 z" fill="#e2683c" />
          <path d="M78 120 l4 -3 l2 4 z" fill="#d1442f" />
        </>
      )}
    </>
  ),
  kaktus: (giant) => (
    <>
      <rect x="39" y="44" width="22" height="90" rx="11" fill="#3c9a5f" />
      <path d="M40 92 H28 Q 22 92 22 84 V66" stroke="#3c9a5f" strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M60 80 H72 Q 78 80 78 72 V56" stroke="#3c9a5f" strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M50 52 V126 M44 60 V120 M56 60 V120" stroke="#2f7f4a" strokeWidth="1.5" />
      <ellipse cx="50" cy="132" rx="18" ry="4" fill="#d9b779" />
      <circle cx="50" cy="42" r="6" fill="#ff7eb6" />
      {giant && (
        <>
          <circle cx="22" cy="62" r="5" fill="#ff7eb6" />
          <circle cx="78" cy="52" r="5" fill="#ff7eb6" />
          <circle cx="50" cy="42" r="2.5" fill="#f2c230" />
        </>
      )}
    </>
  ),
  sogut: (giant) => (
    <>
      <Trunk top={78} w={10} />
      <Blobs blobs={[[50, 58, 32, '#7cc46a'], [32, 66, 20, '#8fcf6a'], [68, 66, 20, '#8fcf6a']]} />
      {[16, 24, 32, 40, 60, 68, 76, 84, ...(giant ? [10, 90] : [])].map((x, i) => (
        <path
          key={x}
          d={`M${x} ${66 + (i % 3) * 4} q ${i % 2 ? 3 : -3} 22 ${i % 2 ? 1 : -1} ${giant ? 46 : 38}`}
          stroke={i % 2 ? '#6bb35a' : '#9bd77f'}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </>
  ),
  sihirli: (giant) => (
    <>
      <Trunk top={82} />
      <Blobs
        blobs={[
          [30, 76, 19, '#7a4fe0'],
          [70, 74, 20, '#7a4fe0'],
          [50, 60, 29, '#9b6bff'],
          [50, 38, 18, '#b48cff'],
          ...(giant ? ([[16, 62, 12, '#b48cff'], [84, 60, 12, '#b48cff']] as [number, number, number, string][]) : []),
        ]}
      />
      <Sparkle x={36} y={56} r={5} />
      <Sparkle x={64} y={70} r={4} color="#ffffff" />
      <Sparkle x={52} y={34} r={4} />
      {giant && (
        <>
          <Sparkle x={14} y={40} r={5} />
          <Sparkle x={88} y={36} r={6} color="#9be7ff" />
          <Sparkle x={22} y={100} r={4} color="#ffffff" />
        </>
      )}
    </>
  ),
};
