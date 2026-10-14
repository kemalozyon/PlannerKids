// Eşyaların küçük resimleri: dükkân, koleksiyon, envanter ve sandıkta emoji yerine eşyanın kendisi görünür.
// Resimleri tek bir gizli 3D sahne (components/ThumbStudio.tsx) sırayla, dünyadaki izometrik açıyla çizer;
// bu dosya sırayı ve bellekteki önbelleği tutar. WebGL yoksa ya da eşyanın çizilecek bir modeli yoksa null
// döner, çağıran emoji gösterir.
import { useEffect, useSyncExternalStore } from 'react';
import type { Item } from './catalog';
import { hasWebGL } from './webgl';

const cache = new Map<string, string | null>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let started = false;

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Bu eşyanın çizilecek bir şekli var mı (model, kodla çizim, kıyafet, kaplama) */
export const drawable = (it: Item) => !!(it.model || it.art || it.proc || (it.category === 'kiyafet' && it.slot) || it.category === 'zemin' || it.category === 'duvar');

/** Stüdyo açıldığında App'e haber verir (tembel yükleme) */
export const STUDIO_EVENT = 'ct-thumb-studio';

function request(it: Item) {
  if (cache.has(it.id) || queue.includes(it.id)) return;
  if (!drawable(it) || !hasWebGL()) {
    cache.set(it.id, null);
    return;
  }
  queue.push(it.id);
  if (!started) {
    started = true;
    window.dispatchEvent(new Event(STUDIO_EVENT));
  }
  emit();
}

/** Stüdyo istendi mi (olay dinleyicisi kurulmadan önce istenmiş olabilir) */
export const studioWanted = () => started;

/** Sıradaki çizilecek eşya (stüdyo için) */
export const useThumbHead = () => useSyncExternalStore(subscribe, () => queue[0] ?? null);

/** Stüdyo bir resmi bitirdi (ya da çizemedi: null) */
export function thumbDone(id: string, url: string | null) {
  cache.set(id, url);
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
  emit();
}

/** Eşyanın küçük resmi (hazır değilse null; hazır olunca yeniden çizilir) */
export function useThumb(it: Item | undefined): string | null {
  useEffect(() => {
    if (it) request(it);
  }, [it]);
  return useSyncExternalStore(subscribe, () => (it ? (cache.get(it.id) ?? null) : null));
}
