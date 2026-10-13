import { useEffect, useState } from 'react';

// Çalışma sayacı artık sunucuda (SessionContext.tsx, session.ts). Burada mola sayacı ve saat biçimi kaldı.

const BREAK_KEY = 'ct-break-v1';

/** Odak turundan sonraki mola: bitiş zamanı localStorage'da, sayaç gibi farktan hesaplanır. */
export function useBreak() {
  const [until, setUntil] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(BREAK_KEY));
      return v > Date.now() - 60 * 60_000 ? v : null; // bir saatten eski molayı unut
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  const save = (v: number | null) => {
    try {
      if (v) localStorage.setItem(BREAK_KEY, String(v));
      else localStorage.removeItem(BREAK_KEY);
    } catch {
      /* yok say */
    }
    setUntil(v);
    setNow(Date.now());
  };
  return {
    active: until != null,
    leftMs: until ? Math.max(0, until - now) : 0,
    start: (min: number) => save(Date.now() + min * 60_000),
    end: () => save(null),
  };
}

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
