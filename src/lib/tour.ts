// Tanıtım turu: sahneler src/demo/script.json'da. Sesli modda kelime zamanları src/demo/audio/<sahne>.json'dan
// (Gemini TTS, scripts/gen-demo-audio.mjs; src/demo/audio.ts), yazılı modda (ya da ses yoksa) okuma hızından tahmin edilir.
import script from '../demo/script.json' with { type: 'json' };

export interface Scene {
  id: string;
  /** Açılacak sayfa (#today, #forest…) */
  hash: string;
  /** Dünyam'da açılacak oda (terrace: ilk teras; teras yoksa oda) */
  view?: 'room' | 'library' | 'terrace';
  /** Dünyam'ın alt panelinde açılacak sekme (me: karakterin paneli); yoksa panel kapanır */
  dock?: 'inv' | 'shop' | 'room' | 'me';
  /** Öne çıkarılacak öge: [data-tour="…"] */
  target: string;
  title: string;
  text: string;
}

/** Bir kelime ve okunduğu zaman aralığı (sn) */
export interface Word {
  w: string;
  s: number;
  e: number;
}

export const SCENES = script.scenes as Scene[];

export type TourMode = 'audio' | 'text';
/** Tur bir kez izlenince (ya da kapatılınca) karşılama kartı bir daha çıkmaz */
export const TOUR_KEY = 'ct-tour-v1';
/** Turu başlat: window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: 'audio' | 'text' })) */
export const TOUR_EVENT = 'ct-tour';
/** Dünyam'da oda değiştir (detail: Scene['view']) */
export const VIEW_EVENT = 'ct-world-view';
/** Dünyam'ın alt panelinde sekme aç/kapat (detail: Scene['dock'] | null) */
export const DOCK_EVENT = 'ct-world-dock';

export const startTour = (mode: TourMode) => window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: mode }));

/** Sessiz izlerken kelime zamanları: dakikada ~150 kelime, noktalama işaretlerinde kısa duraklama */
export function estimateWords(text: string): Word[] {
  let t = 0.3;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const d = 0.22 + Math.min(w.length, 12) * 0.035;
      const word = { w, s: t, e: t + d };
      t += d + (/[.!?]$/.test(w) ? 0.45 : /[,;:]$/.test(w) ? 0.2 : 0.05);
      return word;
    });
}

/** O an okunan kelimenin sırası (-1: henüz başlamadı) */
export function wordAt(words: Word[], t: number): number {
  let i = -1;
  for (let k = 0; k < words.length; k++) if (words[k].s <= t) i = k;
  return i;
}

/** Sahnenin bittiği an (son kelime + kısa bekleme) */
export const sceneEnd = (words: Word[]) => (words.at(-1)?.e ?? 0) + 1.2;
