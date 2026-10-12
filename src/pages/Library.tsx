import { useMemo, useState } from 'react';
import { AddBookSheet, BookSheet, ReadingFlow, Spine } from '../components/ReadingSheets';
import Sheet from '../components/Sheet';
import { formatMinutes } from '../lib/date';
import { useReading } from '../lib/ReadingContext';
import type { Book } from '../lib/types';

type Open =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'book'; id: string }
  | { kind: 'flow'; id: string; start: 'log' | 'finish' }
  | { kind: 'goals' };

export default function Library({ onPlantBook }: { onPlantBook: (bookId: string) => void }) {
  const { stats, books } = useReading();
  const [open, setOpen] = useState<Open>({ kind: 'none' });
  const [genre, setGenre] = useState<string | null>(null);

  const shelf = useMemo(
    () => (stats?.done ?? []).filter((b) => !genre || b.genre === genre),
    [stats, genre],
  );
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const close = () => setOpen({ kind: 'none' });
  const bookById = (id: string) => books.find((b) => b.id === id);
  const { goals } = stats;
  const pagePct = Math.min(1, stats.todayPages / goals.daily_pages);
  const genres = [...new Set(stats.done.map((b) => b.genre).filter(Boolean))] as string[];

  return (
    <div className="stack">
      <header className="day-head">
        <div>
          <h1>Kitaplığım</h1>
          <p className="muted">
            {stats.done.length} kitap okudun
            {stats.totalPages > 0 && ` · ${stats.totalPages.toLocaleString('tr-TR')} sayfa`}
          </p>
        </div>
        <button className="btn primary" onClick={() => setOpen({ kind: 'add' })}>
          + Kitap ekle
        </button>
      </header>

      <section className="card reading-goals">
        <div className="rg-item">
          <div className="gs-label">Bu ay</div>
          <div className="month-books" aria-label={`Bu ay ${stats.monthDone}/${goals.monthly_books} kitap`}>
            {Array.from({ length: Math.max(goals.monthly_books, stats.monthDone) }, (_, i) => (
              <span key={i} className={`mb${i < stats.monthDone ? ' on' : ''}`} />
            ))}
          </div>
          <div className="small tabular">
            <strong>{stats.monthDone}</strong>/{goals.monthly_books} kitap
          </div>
        </div>
        <div className="rg-item grow">
          <div className="gs-label">Bugün</div>
          <div className="page-bar">
            <span style={{ width: `${pagePct * 100}%` }} />
          </div>
          <div className="small tabular">
            <strong>{stats.todayPages}</strong>/{goals.daily_pages} sayfa
            {stats.todayMinutes > 0 && <span className="muted"> · {formatMinutes(stats.todayMinutes)}</span>}
          </div>
        </div>
        <div className="rg-item">
          <span className={`chip read-streak${stats.streak === 0 ? ' off' : ''}`} title="Okuma serisi">
            📚 {stats.streak}
          </span>
          <button className="link small" onClick={() => setOpen({ kind: 'goals' })}>
            Hedefler
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Şu an okuduklarım</h2>
        {stats.reading.length === 0 ? (
          <p className="muted">
            {stats.want.length ? 'Okunacaklar listesinden bir kitaba başla.' : 'Bir kitap ekleyip okumaya başla.'}
          </p>
        ) : (
          <ul className="reading-list">
            {stats.reading.map((b) => (
              <ReadingRow
                key={b.id}
                book={b}
                onOpen={() => setOpen({ kind: 'book', id: b.id })}
                onRead={() => setOpen({ kind: 'flow', id: b.id, start: 'log' })}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card shelf-card">
        <div className="card-head">
          <h2>Okuduklarım</h2>
          <span className="muted small tabular">{stats.done.length}</span>
        </div>
        {genres.length > 1 && (
          <div className="genre-chips">
            <button className={!genre ? 'on' : ''} onClick={() => setGenre(null)}>
              Hepsi
            </button>
            {genres.map((g) => (
              <button key={g} className={genre === g ? 'on' : ''} onClick={() => setGenre(g)}>
                {g}
              </button>
            ))}
          </div>
        )}
        <div className="shelf">
          {shelf.length === 0 ? (
            <div className="shelf-empty muted small">Bitirdiğin kitaplar burada rafa dizilecek.</div>
          ) : (
            shelf.map((b) => (
              <div className="spine-slot" key={b.id}>
                <Spine book={b} onClick={() => setOpen({ kind: 'book', id: b.id })} />
              </div>
            ))
          )}
        </div>
        {stats.favoriteGenre && stats.done.length >= 2 && (
          <p className="muted small">
            En çok okuduğun tür: <strong>{stats.favoriteGenre}</strong>
            {stats.totalMinutes > 0 && ` · toplam ${formatMinutes(stats.totalMinutes)} okudun`}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Okunacaklar</h2>
          <button className="btn ghost sm" onClick={() => setOpen({ kind: 'add' })}>
            + Ekle
          </button>
        </div>
        {stats.want.length === 0 ? (
          <p className="muted">Okumak istediğin kitapları buraya ekle.</p>
        ) : (
          <ul className="list">
            {stats.want.map((b) => (
              <li key={b.id} className="row want-row">
                <button className="want-open" onClick={() => setOpen({ kind: 'book', id: b.id })}>
                  <Spine book={b} small />
                  <span className="grow">
                    <span className="want-title">{b.title}</span>
                    <span className="muted small">
                      {[b.author, b.pages ? `${b.pages} sayfa` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
                {b.recommended_by && <span className="tag rec">{b.recommended_by}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open.kind === 'add' && <AddBookSheet onClose={close} />}
      {open.kind === 'goals' && <GoalsSheet onClose={close} />}
      {open.kind === 'book' && bookById(open.id) && (
        <BookSheet
          book={bookById(open.id)!}
          onClose={close}
          onRead={() => setOpen({ kind: 'flow', id: open.id, start: 'log' })}
          onFinish={() => setOpen({ kind: 'flow', id: open.id, start: 'finish' })}
        />
      )}
      {open.kind === 'flow' && bookById(open.id) && (
        <ReadingFlow book={bookById(open.id)!} start={open.start} onClose={close} onPlant={onPlantBook} />
      )}
    </div>
  );
}

function ReadingRow({ book, onOpen, onRead }: { book: Book; onOpen: () => void; onRead: () => void }) {
  const pct = book.pages ? Math.min(1, book.current_page / book.pages) : 0;
  return (
    <li className="reading-row">
      <button className="reading-open" onClick={onOpen}>
        <Spine book={book} small />
        <span className="grow">
          <span className="want-title">{book.title}</span>
          {book.author && <span className="muted small">{book.author}</span>}
          {book.pages ? (
            <>
              <span className="book-progress">
                <span style={{ width: `${pct * 100}%`, background: book.color }} />
              </span>
              <span className="muted small tabular">
                {book.current_page}/{book.pages} sayfa · {book.pages - book.current_page} sayfa kaldı
              </span>
            </>
          ) : (
            <span className="muted small">{book.current_page}. sayfa</span>
          )}
        </span>
      </button>
      <button className="btn primary sm" onClick={onRead}>
        📖 Okudum
      </button>
    </li>
  );
}

function GoalsSheet({ onClose }: { onClose: () => void }) {
  const { stats, setGoals } = useReading();
  const [monthly, setMonthly] = useState(stats?.goals.monthly_books ?? 2);
  const [daily, setDaily] = useState(stats?.goals.daily_pages ?? 15);
  return (
    <Sheet title="Okuma hedeflerim" onClose={onClose}>
      <Stepper label="Her ay kaç kitap?" value={monthly} min={1} max={30} onChange={setMonthly} unit="kitap" />
      <Stepper label="Her gün kaç sayfa?" value={daily} min={1} max={500} step={5} onChange={setDaily} unit="sayfa" />
      <button
        className="btn primary big full"
        onClick={async () => {
          await setGoals({ monthly_books: monthly, daily_pages: daily });
          onClose();
        }}
      >
        Kaydet
      </button>
    </Sheet>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="stepper-ctl">
        <button type="button" className="btn" aria-label="Azalt" onClick={() => onChange(Math.max(min, value - step))}>
          −
        </button>
        <strong className="tabular">
          {value} {unit}
        </strong>
        <button type="button" className="btn" aria-label="Arttır" onClick={() => onChange(Math.min(max, value + step))}>
          +
        </button>
      </div>
    </div>
  );
}
