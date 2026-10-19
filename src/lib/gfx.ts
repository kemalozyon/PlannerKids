// Dünyanın grafik kalitesi (cihaza göre; tarayıcıda saklanır). Düşük: gölge yok (yumuşak "leke" gölgeler ve
// ortam ışığı var); orta: güneş gölgesi; yüksek: + ortam gölgelemesi (AO), parlama (bloom), dalgalı su, çim.
export type Quality = 'dusuk' | 'orta' | 'yuksek';

export const QUALITY_KEY = 'ct-gfx-v2';
/** Eski ayar: gölgeler açık/kapalı */
const OLD_KEY = 'ct-gfx-v1';

export const QUALITY_LABEL: Record<Quality, string> = { dusuk: 'Düşük', orta: 'Orta', yuksek: 'Yüksek' };
export const QUALITIES: Quality[] = ['dusuk', 'orta', 'yuksek'];

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Kayıtlı kalite; yoksa eski gölge ayarından, o da yoksa cihazdan (dokunmatikte düşük) */
export function loadQuality(): Quality {
  const q = read(QUALITY_KEY);
  if (q === 'dusuk' || q === 'orta' || q === 'yuksek') return q;
  const old = read(OLD_KEY);
  if (old === 'on') return 'orta';
  if (old === 'off') return 'dusuk';
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'dusuk' : 'orta';
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* depolama kapalı */
  }
}
