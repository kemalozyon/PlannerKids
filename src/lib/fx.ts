// Dünyadaki kısa efektlerin olay yolu (three.js'siz: sayfa da çağırabilir; çizim world3d/Fx.tsx'te).
import type { Item } from './catalog';
import { footSize, type PlacedItem } from './world';

/** Dünya koordinatında kısa efekt: "puf" (eşya kaldırıldı), "pırıltı" (eşya kondu), konfeti (alım), su sıçraması,
 *  ışınlanma sütunu */
export interface FxEvent {
  kind: 'puff' | 'sparkle' | 'confetti' | 'splash' | 'beam';
  x: number;
  z: number;
  /** Ayak izi (karo) */
  w?: number;
  h?: number;
  y?: number;
}

const listeners = new Set<(e: FxEvent) => void>();
export const emitFx = (e: FxEvent) => listeners.forEach((f) => f(e));
export function onFx(f: (e: FxEvent) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** Eşyanın yerinde efekt (alanın dünyadaki köşesi `at`); duvar eşyasında duvarın önünde */
export function fxAt(kind: FxEvent['kind'], at: { x: number; y: number }, item: Item, it: PlacedItem) {
  if (item.placement === 'wall') {
    const n = item.w ?? 1;
    emitFx(it.y === -1 ? { kind, x: at.x + it.x + n / 2, z: at.y + 0.3, y: 1.2, w: n, h: 0.3 } : { kind, x: at.x + 0.3, z: at.y + it.y + n / 2, y: 1.2, w: 0.3, h: n });
    return;
  }
  const [w, h] = footSize(item, it.rot);
  emitFx({ kind, x: at.x + it.x + w / 2, z: at.y + it.y + h / 2, w, h });
}
