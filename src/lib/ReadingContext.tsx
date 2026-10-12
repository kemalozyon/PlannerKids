import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from './ApiContext';
import { toLocalDate } from './date';
import { monthOf, pickFreeCell } from './forest';
import { useGame } from './GameContext';
import { computeReading, parcelCells, type ReadingStats } from './reading';
import type { Api, Book, BookTree, NewBook, ReadingGoals } from './types';

interface ReadingCtx {
  stats: ReadingStats | null;
  books: Book[];
  trees: BookTree[];
  refresh: () => Promise<void>;
  addBook: (b: NewBook) => Promise<Book>;
  updateBook: (id: string, patch: Partial<Book>) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  startBook: (id: string) => Promise<void>;
  /** Okuma kaydı ekler. Kitabın sonuna gelindiyse true döner (bitirme akışı açılsın). */
  logReading: (book: Book, minutes: number, toPage: number | null) => Promise<boolean>;
  finishBook: (id: string, rating: number | null, favCharacter: string, review: string) => Promise<void>;
  plantBook: (bookId: string, month: string, cell: number) => Promise<void>;
  moveBookTree: (id: string, cell: number) => Promise<void>;
  setGoals: (g: ReadingGoals) => Promise<void>;
}

const Ctx = createContext<ReadingCtx | null>(null);

export function useReading(): ReadingCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('ReadingProvider yok');
  return c;
}

/** Geçmiş aylarda bitip parsele dikilmeyen kitapları o ayın parseline otomatik diker. */
async function autoPlantPast(api: Api, books: Book[], trees: BookTree[], today: string) {
  const thisMonth = monthOf(today);
  const planted = new Set(trees.map((t) => t.book_id));
  const added: BookTree[] = [];
  const all = [...trees];
  for (const b of books) {
    if (b.status !== 'done' || !b.finished_on || planted.has(b.id)) continue;
    const month = monthOf(b.finished_on);
    if (month >= thisMonth) continue;
    const inMonth = all.filter((t) => t.month === month);
    const taken = new Set(inMonth.map((t) => t.cell));
    // parsel doluysa bir sıra büyüt
    const size = parcelCells(inMonth.length + 1);
    let cell = 0;
    while (taken.has(cell) && cell < size) cell++;
    if (cell >= size) cell = pickFreeCell(taken, b.id) ?? 0;
    try {
      const t = await api.plantBookTree({ book_id: b.id, month, cell });
      added.push(t);
      all.push(t);
    } catch {
      /* başka sekme dikmiş olabilir */
    }
  }
  return added;
}

export function ReadingProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { celebrate } = useGame();
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [trees, setTrees] = useState<BookTree[]>([]);
  const prev = useRef<ReadingStats | null>(null);

  const refresh = useCallback(async () => {
    const today = toLocalDate();
    const [bks, logs, trees0, goals] = await Promise.all([
      api.listBooks(),
      api.listReadingLogs(),
      api.listBookTrees(),
      api.getReadingGoals(),
    ]);
    const allTrees = [...trees0, ...(await autoPlantPast(api, bks, trees0, today))];
    const next = computeReading(bks, logs, allTrees, goals, today);
    const p = prev.current;
    if (p) {
      if (p.todayPages < p.goals.daily_pages && next.todayPages >= next.goals.daily_pages) {
        celebrate({ kind: 'badge', icon: '📖', title: 'Günlük sayfa hedefi tamam!', detail: `Bugün ${next.todayPages} sayfa okudun.` });
      }
      if (p.monthDone < p.goals.monthly_books && next.monthDone >= next.goals.monthly_books) {
        celebrate({ kind: 'badge', icon: '🏆', title: 'Aylık kitap hedefi tamam!', detail: `Bu ay ${next.monthDone} kitap bitirdin.` });
      }
      if (!p.readToday && next.readToday && next.streak >= 2) {
        celebrate({ kind: 'streak', icon: '📚', title: `${next.streak} günlük okuma serisi!`, detail: 'Kitap kurdu olma yolunda.' });
      }
    }
    prev.current = next;
    setBooks(bks);
    setTrees(allTrees);
    setStats(next);
  }, [api, celebrate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ctx: ReadingCtx = {
    stats,
    books,
    trees,
    refresh,
    addBook: async (b) => {
      const book = await api.addBook(b);
      await refresh();
      return book;
    },
    updateBook: async (id, patch) => {
      await api.updateBook(id, patch);
      await refresh();
    },
    deleteBook: async (id) => {
      await api.deleteBook(id);
      await refresh();
    },
    startBook: async (id) => {
      await api.updateBook(id, { status: 'reading', started_on: toLocalDate() });
      await refresh();
    },
    logReading: async (book, minutes, toPage) => {
      const from = book.current_page;
      const to = toPage == null ? from : Math.max(from, book.pages ? Math.min(toPage, book.pages) : toPage);
      await api.addReadingLog({ book_id: book.id, date: toLocalDate(), minutes, pages: to - from, to_page: toPage == null ? null : to });
      const patch: Partial<Book> = { current_page: to };
      if (book.status === 'want') Object.assign(patch, { status: 'reading', started_on: toLocalDate() });
      await api.updateBook(book.id, patch);
      await refresh();
      return !!book.pages && to >= book.pages;
    },
    finishBook: async (id, rating, favCharacter, review) => {
      const b = books.find((x) => x.id === id);
      await api.updateBook(id, {
        status: 'done',
        finished_on: toLocalDate(),
        started_on: b?.started_on ?? toLocalDate(),
        current_page: b?.pages ?? b?.current_page ?? 0,
        rating,
        fav_character: favCharacter.trim() || null,
        review: review.trim() || null,
      });
      await refresh();
    },
    plantBook: async (bookId, month, cell) => {
      await api.plantBookTree({ book_id: bookId, month, cell });
      await refresh();
    },
    moveBookTree: async (id, cell) => {
      await api.moveBookTree(id, cell);
      await refresh();
    },
    setGoals: async (g) => {
      await api.setReadingGoals(g);
      prev.current = null; // hedef değişimi kendi başına kutlama tetiklemesin
      await refresh();
    },
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
