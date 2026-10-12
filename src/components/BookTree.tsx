import { SIZE_NAMES } from '../lib/reading';

/**
 * Kitap ağacı — ders ağaçlarından bilerek farklı: gövdesi üst üste kitaplar,
 * tacı altın sarısı, yaprakları açık kitaplar. size: 0 küçük, 1 orta, 2 büyük (sayfa sayısına göre).
 * Kitabın rengi gövdedeki kitaplarda ve ayraç kurdelesinde görünür.
 */
export default function BookTree({ size, color, label, px = 60 }: { size: 0 | 1 | 2; color: string; label?: string; px?: number }) {
  const scale = [0.66, 0.84, 1][size];
  const stack = [color, '#e9e2cf', '#5b7fc9', color, '#e0803a'].slice(0, size + 3);
  const leaves: [number, number, number][] = [
    [34, 56, -18],
    [64, 50, 14],
    [50, 70, 0],
    [28, 76, -8],
    [72, 74, 10],
    [48, 40, -6],
    [20, 60, -24],
    [80, 58, 22],
  ].slice(0, [3, 6, 8][size]) as [number, number, number][];

  return (
    <svg
      className="book-tree"
      viewBox="0 0 100 140"
      width={px}
      height={px * 1.4}
      role="img"
      aria-label={label ?? SIZE_NAMES[size]}
    >
      <g transform={`translate(50 132) scale(${scale}) translate(-50 -132)`}>
        <ellipse cx="50" cy="132" rx="22" ry="4.5" fill="#00000018" />
        {/* gövde: üst üste kitaplar */}
        {stack.map((c, i) => {
          // yığın her boyda tacın altına (y≈84) kadar uzansın
          const h = 48 / stack.length;
          const y = 132 - (i + 1) * h;
          const off = (i % 2 ? 3 : -2) + (i === stack.length - 1 ? 1 : 0);
          return (
            <g key={i}>
              <rect x={37 + off} y={y} width="26" height={h - 0.6} rx="1.5" fill={c} />
              <rect x={39 + off} y={y + h * 0.25} width="22" height="1.4" fill="#ffffff55" />
            </g>
          );
        })}
        {/* taç */}
        <g>
          <circle cx="30" cy="70" r="20" fill="#e9a12b" />
          <circle cx="70" cy="68" r="21" fill="#e9a12b" />
          <circle cx="50" cy="56" r="29" fill="#f4b740" />
          <circle cx="50" cy="38" r="17" fill="#f7c95c" />
          {size === 2 && (
            <>
              <circle cx="18" cy="56" r="13" fill="#f7c95c" />
              <circle cx="82" cy="54" r="13" fill="#f7c95c" />
            </>
          )}
        </g>
        {/* açık kitap yaprakları */}
        {leaves.map(([x, y, r], i) => (
          <g key={i} transform={`rotate(${r} ${x} ${y})`}>
            <path d={`M${x} ${y + 1} q-5 -4 -10 -2 v8 q5 -2 10 2 z`} fill="#fffaf0" stroke={i % 2 ? color : '#b5651d'} strokeWidth="1.2" />
            <path d={`M${x} ${y + 1} q5 -4 10 -2 v8 q-5 -2 -10 2 z`} fill="#fffaf0" stroke={i % 2 ? color : '#b5651d'} strokeWidth="1.2" />
          </g>
        ))}
        {/* ayraç kurdelesi */}
        {size >= 1 && <path d="M62 82 v18 l4 -4 l4 4 v-18 z" fill={color} />}
        {size === 2 && (
          <path className="tw" fill="#ffffff" d="M50 14 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" />
        )}
      </g>
    </svg>
  );
}
