// Orman: her gün çalışılan dakikalar o günün parasıdır (cüzdan). Çocuk bu parayla bitki satın alıp
// o ayın ormanına kendisi diker. Aynı günün parasıyla birden çok bitki alınabilir; dikilen bitki
// sonradan farkı ödenerek büyütülebilir. Harcanmayan para ay sonuna kadar o gün için durur.

export type StageId = 'tohum' | 'cicek' | 'kucuk' | 'buyuk' | 'dev';

/** Fiyat listesi (dakika). Tek yerde; gerekirse buradan değiştir. */
export const STAGES: { id: StageId; name: string; min: number }[] = [
  { id: 'tohum', name: 'Tohum', min: 30 },
  { id: 'cicek', name: 'Çiçek', min: 60 },
  { id: 'kucuk', name: 'Küçük ağaç', min: 90 },
  { id: 'buyuk', name: 'Büyük ağaç', min: 120 },
  { id: 'dev', name: 'Dev ağaç', min: 180 },
];

export const priceOf = (stage: number) => STAGES[stage].min;

/** Bu parayla alınabilecek en büyük evre; -1: hiçbiri. */
export function stageIndex(minutes: number): number {
  let i = -1;
  STAGES.forEach((s, k) => minutes >= s.min && (i = k));
  return i;
}

/** Bir sonraki fiyata ne kadar kaldı. */
export function nextStage(minutes: number) {
  const i = stageIndex(minutes);
  const next = STAGES[i + 1];
  return next ? { stage: next, remaining: next.min - minutes } : null;
}

/** Otomatik harcama: hep alınabilecek en büyüğünü al (180 → dev; 170 → büyük + tohum). */
export function greedySpend(budget: number): number[] {
  const out: number[] = [];
  let left = budget;
  for (let i = stageIndex(left); i >= 0; i = stageIndex(left)) {
    out.push(i);
    left -= priceOf(i);
  }
  return out;
}

export interface Species {
  id: string;
  name: string;
  /** Bu türü açmak için gereken en uzun seri (gün) */
  unlock: number;
  /** çiçek evresindeki taç yaprak rengi */
  bloom: string;
}

export const SPECIES: Species[] = [
  { id: 'elma', name: 'Elma', unlock: 0, bloom: '#f6a5b8' },
  { id: 'cam', name: 'Çam', unlock: 0, bloom: '#f2c230' },
  { id: 'kiraz', name: 'Kiraz', unlock: 0, bloom: '#f08bb4' },
  { id: 'palmiye', name: 'Palmiye', unlock: 3, bloom: '#ff9f43' },
  { id: 'akcaagac', name: 'Akçaağaç', unlock: 5, bloom: '#e2453c' },
  { id: 'kaktus', name: 'Kaktüs', unlock: 7, bloom: '#ff7eb6' },
  { id: 'sogut', name: 'Söğüt', unlock: 10, bloom: '#9be7c4' },
  { id: 'sihirli', name: 'Sihirli ağaç', unlock: 14, bloom: '#b47cff' },
];

export const speciesById = (id: string) => SPECIES.find((s) => s.id === id) ?? SPECIES[0];

// ---------- Orman ızgarası ----------
export const COLS = 8;
export const ROWS = 8;
export const CELLS = COLS * ROWS;

export const monthOf = (date: string) => date.slice(0, 7); // YYYY-MM

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

/** Otomatik dikim için dağınık ama deterministik boş hücre seçimi. */
export function pickFreeCell(taken: Set<number>, seed: string): number | null {
  if (taken.size >= CELLS) return null;
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let c = h % CELLS;
  while (taken.has(c)) c = (c + 7) % CELLS; // 7, 64 ile aralarında asal → tüm hücreleri gezer
  return c;
}
