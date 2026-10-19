// 💎 sayacı (Dünyam üst çubuğu, dükkân): değişince sayarak artar/azalır ve hoplar (Habbo'nun kredi sayacı gibi).
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/motionPref';

export default function GemCounter({ value, className = '' }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    setDir(value > start ? 'up' : 'down');
    if (reduced) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const dur = Math.min(900, 300 + Math.abs(value - start) * 4);
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  useEffect(() => {
    if (!dir) return;
    const t = setTimeout(() => setDir(null), 700);
    return () => clearTimeout(t);
  }, [dir, value]);

  return (
    <span className={`gem-counter${dir ? ` bump ${dir}` : ''} ${className}`} aria-label={`${value} Elmas`}>
      💎 <span className="gem-n">{shown}</span>
    </span>
  );
}
