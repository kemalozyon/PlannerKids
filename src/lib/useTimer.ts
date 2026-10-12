import { useEffect, useState } from 'react';

const KEY = 'ct-timer-v1';

export interface RunningTimer {
  courseId: string;
  startedAt: number; // epoch ms
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

  const start = (courseId: string) => {
    const t = { courseId, startedAt: Date.now() };
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

  const elapsedMs = timer ? Math.max(0, now - timer.startedAt) : 0;
  return { timer, elapsedMs, start, stop, cancel };
}

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
