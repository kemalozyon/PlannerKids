// Okuma: kitaplar ve okuma kayıtları. Bitirilen kitaplar odadaki kitaplığın raflarına dizilir (ShelfView).
import { monthOf } from './forest';
import { computeStreak } from './streak';
import type { Book, ReadingGoals, ReadingLog } from './types';

export const GENRES = ['Macera', 'Masal', 'Fantastik', 'Bilim', 'Tarih', 'Gizem', 'Mizah', 'Hayvanlar', 'Şiir', 'Diğer'];
export const RECOMMENDERS = ['Öğretmenim', 'Annem', 'Babam', 'Arkadaşım', 'Kendim', 'Kütüphane'];
export const BOOK_COLORS = ['#c0392b', '#2f6fd6', '#16a37f', '#e0803a', '#8b5cf6', '#d1477a', '#0e8aa0', '#b8860b', '#3d4a5c', '#7a9a2e'];

export interface ReadingStats {
  goals: ReadingGoals;
  todayPages: number;
  todayMinutes: number;
  monthDone: number; // bu ay biten kitap
  streak: number;
  bestStreak: number;
  readToday: boolean;
  reading: Book[];
  want: Book[];
  done: Book[];
  totalPages: number;
  totalMinutes: number;
  favoriteGenre: string | null;
  minutesByBook: Map<string, number>;
}

export function computeReading(
  books: Book[],
  logs: ReadingLog[],
  goals: ReadingGoals,
  today: string,
): ReadingStats {
  const month = monthOf(today);
  const dayPages = new Map<string, number>();
  const minutesByBook = new Map<string, number>();
  let todayMinutes = 0;
  for (const l of logs) {
    dayPages.set(l.date, (dayPages.get(l.date) ?? 0) + Math.max(l.pages, 0));
    minutesByBook.set(l.book_id, (minutesByBook.get(l.book_id) ?? 0) + l.minutes);
    if (l.date === today) todayMinutes += l.minutes;
  }
  const readDays = new Set(logs.filter((l) => l.pages > 0 || l.minutes > 0).map((l) => l.date));
  const first = [...readDays].sort()[0] ?? null;
  const { streak, best } = computeStreak((d) => (readDays.has(d) ? 1 : 0), first, today);

  const done = books
    .filter((b) => b.status === 'done')
    .sort((a, b) => (b.finished_on ?? '').localeCompare(a.finished_on ?? ''));
  const genreCount = new Map<string, number>();
  done.forEach((b) => b.genre && genreCount.set(b.genre, (genreCount.get(b.genre) ?? 0) + 1));
  const favoriteGenre = [...genreCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    goals,
    todayPages: dayPages.get(today) ?? 0,
    todayMinutes,
    monthDone: done.filter((b) => b.finished_on && monthOf(b.finished_on) === month).length,
    streak,
    bestStreak: best,
    readToday: readDays.has(today),
    reading: books.filter((b) => b.status === 'reading'),
    want: books.filter((b) => b.status === 'want'),
    done,
    totalPages: done.reduce((s, b) => s + (b.pages ?? 0), 0),
    totalMinutes: logs.reduce((s, l) => s + l.minutes, 0),
    favoriteGenre,
    minutesByBook,
  };
}

/** Kitap sırtının üstündeki yazı için açık/koyu seçimi. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1c1d1f' : '#ffffff';
}

export function pickBookColor(title: string): string {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BOOK_COLORS[h % BOOK_COLORS.length];
}
