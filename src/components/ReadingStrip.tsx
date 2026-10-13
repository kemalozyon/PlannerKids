import { useState } from 'react';
import { useReading } from '../lib/ReadingContext';
import { ReadingFlow, Spine } from './ReadingSheets';

/** Bugün ekranında okuma özeti: günlük sayfa hedefi + "Okudum". Okuma ormana sayılmaz. */
export default function ReadingStrip({ goLibrary }: { goLibrary: () => void }) {
  const { stats } = useReading();
  const [flow, setFlow] = useState(false);
  if (!stats) return null;
  const book = stats.reading[0];
  const goal = stats.goals.daily_pages;
  const pct = Math.min(1, stats.todayPages / goal);

  return (
    <section className="card reading-strip">
      <div className="card-head">
        <h2>📖 Okuma</h2>
        <span className={`chip read-streak${stats.streak === 0 ? ' off' : ''}`} title="Okuma serisi">
          📚 {stats.streak}
        </span>
      </div>
      {book ? (
        <>
          <button className="rs-book" onClick={goLibrary}>
            <Spine book={book} small />
            <span className="grow">
              <span className="want-title">{book.title}</span>
              <span className="muted small tabular">
                {book.pages ? `${book.current_page}/${book.pages} sayfa` : `${book.current_page}. sayfa`}
                {stats.reading.length > 1 && ` · +${stats.reading.length - 1} kitap daha`}
              </span>
            </span>
          </button>
          <div className="page-bar">
            <span style={{ width: `${pct * 100}%` }} />
          </div>
          <div className="actions">
            <span className="muted small tabular">
              Bugün {stats.todayPages}/{goal} sayfa{pct >= 1 ? ' ✓' : ''}
            </span>
            <button className="btn primary" onClick={() => setFlow(true)}>
              📖 Okudum
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <span className="muted small">{stats.want.length ? 'Okunacaklarından bir kitaba başla.' : 'Henüz okuduğun bir kitap yok.'}</span>
          <button className="btn" onClick={goLibrary}>
            Kitaplığım
          </button>
        </div>
      )}
      {flow && book && <ReadingFlow book={book} onClose={() => setFlow(false)} />}
    </section>
  );
}
