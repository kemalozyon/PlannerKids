// Tanıtım turunun sesleri ve kelime zamanları (npm run demo:audio → src/demo/audio/). Bundle'a girerler: normal derlemede
// mp3'ler ayrı dosya olur, tek dosyalık demoda (vite-plugin-singlefile) HTML'in içine gömülür; böylece demo
// file:// ile açılınca da sesli oynar. Vite'a özgü olduğu için lib/tour.ts'ten ayrı (Node testleri onu içe aktarır).
import type { Word } from '../lib/tour';

const timings = import.meta.glob('./audio/*.json', { eager: true, import: 'default' }) as Record<string, { text: string; words: Word[] }>;
const sounds = import.meta.glob('./audio/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Sahnenin sesi: yoksa ya da metin değiştiyse (eski ses başka şey söyler) null */
export function sceneAudio(id: string, text: string): { url: string; words: Word[] } | null {
  const t = timings[`./audio/${id}.json`];
  const url = sounds[`./audio/${id}.mp3`];
  return t && url && t.text === text ? { url, words: t.words } : null;
}
