// Azaltılmış hareket: oyun ayarı (ct-motion-v1: 'az' / 'tam') yoksa sistemin prefers-reduced-motion ayarı.
// Dünyadaki animasyonlar (world3d/motion.tsx) ve sayfa aynı değeri okur.
import { useSyncExternalStore } from 'react';

export const MOTION_KEY = 'ct-motion-v1';
const listeners = new Set<() => void>();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
media?.addEventListener?.('change', () => listeners.forEach((f) => f()));

const readSetting = (): string | null => {
  try {
    return localStorage.getItem(MOTION_KEY);
  } catch {
    return null;
  }
};

export const reducedMotion = (): boolean => {
  const s = readSetting();
  if (s === 'az') return true;
  if (s === 'tam') return false;
  return !!media?.matches;
};

export function setReducedMotion(on: boolean) {
  try {
    localStorage.setItem(MOTION_KEY, on ? 'az' : 'tam');
  } catch {
    /* depolama kapalı */
  }
  document.documentElement.toggleAttribute('data-reduced-motion', on);
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export const useReducedMotion = () => useSyncExternalStore(subscribe, reducedMotion, () => false);

// Sayfa açılırken CSS de bilsin (html[data-reduced-motion])
if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-reduced-motion', reducedMotion());
