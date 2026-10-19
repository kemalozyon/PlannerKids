// "Bütün kitaplarım": bitirilen kitaplar sırtlarıyla (Open Library kapağı varsa kapakla) dizilir. Her rafta 12
// kitap; raf dolunca yeni raf eklenir. Evdeki kitaplıklarda ve kütüphane odasında aynı kitaplar 3D durur.
import { useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { CFG } from '../lib/config';
import { addDays, formatMinutes, formatShort, toLocalDate } from '../lib/date';
import { formatMonth } from '../lib/forest';
import { periodTotals, type PeriodTotals } from '../lib/game';
import { inkOn } from '../lib/reading';
import type { Book, Course } from '../lib/types';
import Sheet from './Sheet';

const PER = CFG.world.library.perShelf;

export { BookCard };

export type ShelfTab = 'books' | 'stats';

/** Kitaplık: bitirilen kitaplar ve (STATS) geçmiş haftaların/ayların çalışma kayıtları */
export default function ShelfView({ books, onClose, tab: start = 'books' }: { books: Book[]; onClose: () => void; tab?: ShelfTab }) {
  const [tab, setTab] = useState<ShelfTab>(start);
  return (
    <Sheet title={tab === 'books' ? '📚 Kitaplığım' : '📊 Kayıtlarım'} onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Kitaplık">
        <button role="tab" aria-selected={tab === 'books'} className={tab === 'books' ? 'on' : ''} onClick={() => setTab('books')}>
          📚 Kitaplarım
        </button>
        <button role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
          📊 Kayıtlarım
        </button>
      </div>
      {tab === 'books' ? <Books books={books} /> : <Stats />}
    </Sheet>
  );
}

function Books({ books }: { books: Book[] }) {
  const [open, setOpen] = useState<Book | null>(null);
  const done = books.filter((b) => b.status === 'done').sort((a, b) => (a.finished_on ?? '').localeCompare(b.finished_on ?? ''));
  const reading = books.filter((b) => b.status === 'reading');
  // Son raf doluysa boş bir raf daha: "sıradaki kitapların yeri"
  const shelves = Math.max(1, Math.ceil(done.length / PER) + (done.length && done.length % PER === 0 ? 1 : 0));
  return (
    <>
      <p className="muted small">
        {done.length ? `${done.length} kitap bitirdin. Hepsi evindeki kütüphane odasının raflarında da duruyor.` : 'Bitirdiğin kitaplar burada ve kütüphane odanın raflarında dizilir.'}
      </p>
      <div className="bc-case">
        {Array.from({ length: shelves }, (_, s) => {
          const row = done.slice(s * PER, (s + 1) * PER);
          return (
            <div key={s} className="bc-shelf">
              <div className="bc-books">
                {row.map((b, i) => (
                  <Spine key={b.id} book={b} tall={i % 3 === 1} onClick={() => setOpen(b)} />
                ))}
                {row.length === 0 && <span className="bc-empty">Yeni raf · sıradaki kitapların</span>}
              </div>
              <div className="bc-board" aria-hidden />
            </div>
          );
        })}
      </div>
      {reading.length > 0 && (
        <>
          <h3 className="bc-title">Şu an okuduklarım</h3>
          <div className="bc-shelf">
            <div className="bc-books">
              {reading.map((b, i) => (
                <Spine key={b.id} book={b} tall={i % 2 === 0} onClick={() => setOpen(b)} reading />
              ))}
            </div>
            <div className="bc-board" aria-hidden />
          </div>
        </>
      )}
      {open && <BookCard book={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Geçmiş haftalar ve aylar (çubuk), bu ayın dersleri */
function Stats() {
  const api = useApi();
  const [data, setData] = useState<{ t: PeriodTotals; courses: Course[] } | null>(null);
  useEffect(() => {
    const today = toLocalDate();
    let live = true;
    Promise.all([api.listLogs(addDays(today, -200), today), api.listCourses()])
      .then(([logs, courses]) => live && setData({ t: periodTotals(logs, today), courses }))
      .catch(() => live && setData({ t: periodTotals([], today), courses: [] }));
    return () => {
      live = false;
    };
  }, [api]);
  if (!data) return <p className="muted small">Yükleniyor…</p>;
  const { t, courses } = data;
  const wMax = Math.max(60, ...t.weeks.map((w) => w.minutes));
  const mMax = Math.max(60, ...t.months.map((m) => m.minutes));
  const cMax = Math.max(1, ...t.courses.map((c) => c.minutes));
  return (
    <div className="st">
      <h3 className="bc-title">Haftalar</h3>
      <div className="st-bars" aria-label="Son 8 hafta">
        {t.weeks.map((w, i) => (
          <div key={w.start} className={`st-col${i === t.weeks.length - 1 ? ' now' : ''}`} title={`${formatShort(w.start)} haftası: ${formatMinutes(w.minutes)}`}>
            <span className="st-v">{w.minutes ? Math.round(w.minutes / 6) / 10 : ''}</span>
            <span className="st-bar" style={{ height: `${(w.minutes / wMax) * 100}%` }} />
            <span className="st-x">{formatShort(w.start)}</span>
          </div>
        ))}
      </div>
      <p className="muted small">Sayılar saat. Son sütun bu hafta.</p>
      <h3 className="bc-title">Aylar</h3>
      <ul className="st-rows">
        {t.months.map((m) => (
          <li key={m.month}>
            <span className="st-name">{formatMonth(m.month)}</span>
            <span className="st-track">
              <span className="st-fill" style={{ width: `${(m.minutes / mMax) * 100}%` }} />
            </span>
            <span className="st-num">
              {formatMinutes(m.minutes)}
              <span className="muted"> · {m.days} gün</span>
            </span>
          </li>
        ))}
      </ul>
      <h3 className="bc-title">Bu ayın dersleri</h3>
      {t.courses.length === 0 ? (
        <p className="muted small">Bu ay henüz kayıt yok.</p>
      ) : (
        <ul className="st-rows">
          {t.courses.map((c) => {
            const course = courses.find((x) => x.id === c.course_id);
            return (
              <li key={c.course_id}>
                <span className="st-name">{course?.name ?? 'Ders'}</span>
                <span className="st-track">
                  <span className="st-fill" style={{ width: `${(c.minutes / cMax) * 100}%`, background: course?.color }} />
                </span>
                <span className="st-num">{formatMinutes(c.minutes)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Spine({ book, tall, reading, onClick }: { book: Book; tall: boolean; reading?: boolean; onClick: () => void }) {
  const cover = book.cover_url;
  return (
    <button
      className={`bc-spine${tall ? ' tall' : ''}${cover ? ' has-cover' : ''}${reading ? ' reading' : ''}`}
      style={{ background: book.color, color: inkOn(book.color) }}
      onClick={onClick}
      aria-label={`${book.title}${book.author ? `, ${book.author}` : ''}`}
      title={book.title}
    >
      {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="bc-spine-title">{book.title}</span>}
    </button>
  );
}

function BookCard({ book, onClose }: { book: Book; onClose: () => void }) {
  return (
    <div className="bc-card-overlay" role="dialog" aria-modal="true" aria-label={book.title} onClick={onClose}>
      <div className="card bc-card" onClick={(e) => e.stopPropagation()}>
        <div className="bc-cover" style={{ background: book.color, color: inkOn(book.color) }}>
          {book.cover_url ? <img src={book.cover_url} alt={`${book.title} kapağı`} /> : <span>{book.title}</span>}
        </div>
        <div className="grow">
          <h2>{book.title}</h2>
          {book.author && <p className="muted">{book.author}</p>}
          {book.finished_on && <p className="small">Bitirdiğin gün: {formatShort(book.finished_on)}</p>}
          {book.rating != null && <p aria-label={`${book.rating} yıldız`}>{'⭐'.repeat(book.rating)}</p>}
          {book.favorite_part && (
            <p className="fav-part">
              <span className="muted small">En sevdiğin kısım</span>
              <br />“{book.favorite_part}”
            </p>
          )}
          {!book.favorite_part && book.review && <p className="muted small">“{book.review}”</p>}
          <button className="btn full" onClick={onClose}>
            Rafa geri koy
          </button>
        </div>
      </div>
    </div>
  );
}
