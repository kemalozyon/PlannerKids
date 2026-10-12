import { useEffect, useState } from 'react';

const KEY = 'ct-timer-v1';

export interface RunningTimer {
  courseId: string;
  startedAt: number; // epoch ms
  /** Odak turu uzunluğu (dk); yoksa serbest */
  goalMin?: number | null;
}

function read(): RunningTimer | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RunningTimer) : null;
  } catch {
    return null;
  }
}

function write(t: RunningTimer | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* depolama yoksa yalnızca bellekte */
  }
}

/**
 * Tick saymaz: başlangıç zamanını saklar, geçen süreyi farktan hesaplar.
 * Sayfa yenilense / sekme uyusa bile doğru süre gösterilir.
 */
export function useTimer() {
  const [timer, setTimer] = useState<RunningTimer | null>(read);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Başka sekmede başlatılıp durdurulursa senkron kal
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setTimer(read());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const start = (courseId: string, goalMin: number | null = null) => {
    const t: RunningTimer = { courseId, startedAt: Date.now(), goalMin };
    write(t);
    setTimer(t);
    setNow(Date.now());
  };

  /** Durdurur ve {başlangıç, dakika} döner. */
  const stop = () => {
    if (!timer) return null;
    const result = { ...timer, minutes: Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000)) };
    write(null);
    setTimer(null);
    return result;
  };

  const cancel = () => {
    write(null);
    setTimer(null);
  };

  /** Çalışırken tur uzunluğunu değiştirir (null = serbest) */
  const setGoal = (goalMin: number | null) => {
    if (!timer) return;
    const t = { ...timer, goalMin };
    write(t);
    setTimer(t);
  };

  const elapsedMs = timer ? Math.max(0, now - timer.startedAt) : 0;
  return { timer, elapsedMs, start, stop, cancel, setGoal };
}

export type TimerApi = ReturnType<typeof useTimer>;

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
