import { useState } from 'react';
import { daysBetween, formatDay, formatMinutes, toLocalDate } from '../lib/date';
import { useGame } from '../lib/GameContext';
import { BOOK_COLORS, GENRES, RECOMMENDERS, inkOn, pickBookColor } from '../lib/reading';
import { useReading } from '../lib/ReadingContext';
import type { Book } from '../lib/types';
import ConfirmButton from './ConfirmButton';
import Sheet from './Sheet';

// ---------- Kitap sırtı ----------
export function Spine({ book, onClick, small }: { book: Book; onClick?: () => void; small?: boolean }) {
  const p = Math.min(book.pages ?? 150, 400) / 400;
  const h = small ? 44 : Math.round(100 + p * 40);
  const w = small ? 14 : Math.round(24 + p * 18);
  const ink = inkOn(book.color);
  const style = { height: h, width: w, background: book.color, color: ink };
  const inner = !small && <span className="spine-title">{book.title}</span>;
  return onClick ? (
    <button className="spine" style={style} onClick={onClick} aria-label={`${book.title}${book.author ? `, ${book.author}` : ''}`}>
      {inner}
    </button>
  ) : (
    <span className="spine" style={style} aria-hidden>
      {inner}
    </span>
  );
}

export function Stars({ value, onChange, size = 'md' }: { value: number | null; onChange?: (v: number | null) => void; size?: 'sm' | 'md' }) {
  return (
    <span className={`stars ${size}`} role={onChange ? 'radiogroup' : undefined} aria-label="Kitap puanı">
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} yıldız`}
            className={value && n <= value ? 'on' : ''}
            onClick={() => onChange(value === n ? null : n)}
          >
            ★
          </button>
        ) : (
          <span key={n} className={value && n <= value ? 'on' : ''} aria-hidden>
            ★
          </span>
        ),
      )}
    </span>
  );
}

// ---------- Kitap ekle ----------
export function AddBookSheet({ onClose }: { onClose: () => void }) {
  const { addBook } = useReading();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [genre, setGenre] = useState('');
  const [rec, setRec] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [startNow, setStartNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = color ?? pickBookColor(title || 'kitap');

  return (
    <Sheet title="Kitap ekle" onClose={onClose}>
      <form
        className="book-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          setBusy(true);
          await addBook({
            title: title.trim(),
            author: author.trim() || null,
            pages: Number(pages) > 0 ? Math.round(Number(pages)) : null,
            genre: genre || null,
            recommended_by: rec.trim() || null,
            color: shown,
            status: startNow ? 'reading' : 'want',
          });
          onClose();
        }}
      >
        <div className="book-form-top">
          <Spine book={{ title: title || 'Kitap adı', pages: Number(pages) || 150, color: shown } as Book} />
          <div className="grow">
            <label className="field">
              <span>Kitabın adı</span>
              <input id="book-title" required value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Küçük Prens" />
            </label>
            <label className="field">
              <span>Yazar</span>
              <input id="book-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="istersen" />
            </label>
          </div>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Kaç sayfa?</span>
            <input id="book-pages" type="number" min={1} max={5000} inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="ör. 120" />
          </label>
          <label className="field">
            <span>Türü</span>
            <select id="book-genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">Seç</option>
              {GENRES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Kim önerdi?</span>
          <input id="book-rec" list="recommenders" value={rec} onChange={(e) => setRec(e.target.value)} placeholder="ör. Öğretmenim" />
          <datalist id="recommenders">
            {RECOMMENDERS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <div className="field">
          <span>Kitabın rengi</span>
          <div className="swatches">
            {BOOK_COLORS.map((c) => (
              <button type="button" key={c} aria-label={c} className={shown === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <label className="check start-now">
          <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
          <span>Bu kitabı şimdi okumaya başlıyorum</span>
        </label>
        <button className="btn primary big full" disabled={busy || !title.trim()}>
          {startNow ? 'Ekle ve başla' : 'Okunacaklara ekle'}
        </button>
      </form>
    </Sheet>
  );
}

// ---------- Okudum → (bitti mi?) → Bitirme → Ağaç ----------
type Step = 'log' | 'finish' | 'done';

export function ReadingFlow({
  book: initial,
  start = 'log',
  onClose,
  onPlant,
}: {
  book: Book;
  start?: Step;
  onClose: () => void;
  /** "Ağacını dik" → ormana git */
  onPlant?: (bookId: string) => void;
}) {
  const { books, logReading, finishBook } = useReading();
  const { celebrate } = useGame();
  const [step, setStep] = useState<Step>(start);
  const [bookId, setBookId] = useState(initial.id);
  const book = books.find((b) => b.id === bookId) ?? initial;
  const choices = books.filter((b) => b.status === 'reading');

  const [minutes, setMinutes] = useState('');
  const [toPage, setToPage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [fav, setFav] = useState('');
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);

  const target = Number(toPage);
  const read = toPage ? Math.max(0, Math.min(target, book.pages ?? target) - book.current_page) : 0;
  const pageError = toPage !== '' && target < book.current_page ? `Zaten ${book.current_page}. sayfadasın.` : null;

  if (step === 'log') {
    return (
      <Sheet title="📖 Okudum!" onClose={onClose}>
        {choices.length > 1 ? (
          <label className="field">
            <span>Hangi kitap?</span>
            <select id="flow-book" value={bookId} onChange={(e) => { setBookId(e.target.value); setToPage(''); }}>
              {choices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flow-book">
            <Spine book={book} small />
            <div>
              <strong>{book.title}</strong>
              <div className="muted small">
                {book.pages ? `${book.current_page}/${book.pages} sayfa` : `${book.current_page}. sayfa`}
              </div>
            </div>
          </div>
        )}
        <div className="field">
          <span>Kaç dakika okudun?</span>
          <div className="presets">
            {[10, 15, 20, 30, 45].map((m) => (
              <button type="button" key={m} className={`btn sm${minutes === String(m) ? ' primary' : ''}`} onClick={() => setMinutes(String(m))}>
                {m} dk
              </button>
            ))}
          </div>
          <input id="flow-minutes" type="number" min={1} max={600} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="ya da kendin yaz" />
        </div>
        <label className="field">
          <span>Kaçıncı sayfaya geldin?</span>
          <input
            id="flow-page"
            type="number"
            min={book.current_page}
            max={book.pages ?? undefined}
            inputMode="numeric"
            value={toPage}
            onChange={(e) => setToPage(e.target.value)}
            placeholder={book.pages ? `${book.current_page + 1}–${book.pages}` : 'ör. 42'}
          />
        </label>
        {pageError ? <div className="error">{pageError}</div> : read > 0 && <p className="read-count">Bugün {read} sayfa okudun 👏</p>}
        {book.pages && (
          <button type="button" className="link" onClick={() => setToPage(String(book.pages))}>
            Kitabı bitirdim, son sayfadayım
          </button>
        )}
        <button
          className="btn primary big full"
          disabled={busy || !!pageError || (!Number(minutes) && !toPage)}
          onClick={async () => {
            setBusy(true);
            const finished = await logReading(book, Math.max(0, Math.round(Number(minutes) || 0)), toPage ? target : null);
            setBusy(false);
            if (finished) setStep('finish');
            else onClose();
          }}
        >
          Kaydet
        </button>
      </Sheet>
    );
  }

  if (step === 'finish') {
    return (
      <Sheet title="🎉 Kitabı bitirdin!" onClose={onClose}>
        <div className="finish-head">
          <Spine book={book} />
          <div>
            <div className="finish-title">{book.title}</div>
            {book.author && <div className="muted">{book.author}</div>}
            {book.pages && <div className="muted small">{book.pages} sayfa</div>}
          </div>
        </div>
        <div className="field">
          <span>Kitabı ne kadar sevdin?</span>
          <Stars value={rating} onChange={setRating} />
        </div>
        <label className="field">
          <span>En sevdiğin karakter kim?</span>
          <input id="finish-fav" value={fav} maxLength={80} onChange={(e) => setFav(e.target.value)} placeholder="istersen yaz" />
        </label>
        <label className="field">
          <span>Kitabı bir cümleyle anlat</span>
          <textarea id="finish-review" rows={2} value={review} maxLength={300} onChange={(e) => setReview(e.target.value)} placeholder="ör. Bir çocuğun gezegenler arası yolculuğu…" />
        </label>
        <button
          className="btn primary big full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await finishBook(book.id, rating, fav, review);
            celebrate({ kind: 'badge', icon: '📚', title: 'Kitaplığına eklendi!', detail: book.title });
            setBusy(false);
            setStep('done');
          }}
        >
          Kitaplığıma ekle
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Kitaplığında yerini aldı 📚" onClose={onClose}>
      <p>
        <strong>{book.title}</strong> artık rafında. Bu kitap için ormandaki <strong>kitap parseline</strong> özel bir ağaç dikebilirsin.
      </p>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          Sonra
        </button>
        {onPlant && (
          <button className="btn primary" onClick={() => onPlant(book.id)}>
            🌳 Ağacını dik
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------- Kitap kartı ----------
export function BookSheet({
  book,
  onClose,
  onRead,
  onFinish,
  onMove,
}: {
  book: Book;
  onClose: () => void;
  onRead?: () => void;
  onFinish?: () => void;
  /** Parseldeki ağacın yerini değiştir */
  onMove?: () => void;
}) {
  const { stats, startBook, deleteBook } = useReading();
  const minutes = stats?.minutesByBook.get(book.id) ?? 0;
  const days = book.started_on && book.finished_on ? daysBetween(book.started_on, book.finished_on) + 1 : null;
  const pct = book.pages ? Math.min(1, book.current_page / book.pages) : 0;

  return (
    <Sheet title={book.status === 'done' ? 'Kitaplığımdan' : book.status === 'reading' ? 'Okuyorum' : 'Okunacaklar'} onClose={onClose}>
      <div className="book-card">
        <div className="cover" style={{ background: book.color, color: inkOn(book.color) }}>
          <span className="cover-title">{book.title}</span>
          {book.author && <span className="cover-author">{book.author}</span>}
        </div>
        <div className="grow book-meta">
          {book.status === 'done' && <Stars value={book.rating} size="sm" />}
          <dl>
            {book.pages && (
              <>
                <dt>Sayfa</dt>
                <dd>{book.pages}</dd>
              </>
            )}
            {book.genre && (
              <>
                <dt>Tür</dt>
                <dd>{book.genre}</dd>
              </>
            )}
            {book.recommended_by && (
              <>
                <dt>Öneren</dt>
                <dd>{book.recommended_by}</dd>
              </>
            )}
            {book.started_on && (
              <>
                <dt>Başladım</dt>
                <dd>{formatDay(book.started_on)}</dd>
              </>
            )}
            {book.finished_on && (
              <>
                <dt>Bitirdim</dt>
                <dd>
                  {formatDay(book.finished_on)}
                  {days ? ` · ${days} günde` : ''}
                </dd>
              </>
            )}
            {minutes > 0 && (
              <>
                <dt>Okuma süresi</dt>
                <dd>{formatMinutes(minutes)}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      {book.status === 'reading' && book.pages && (
        <div>
          <div className="book-progress">
            <span style={{ width: `${pct * 100}%`, background: book.color }} />
          </div>
          <div className="muted small tabular">
            {book.current_page}/{book.pages} sayfa · %{Math.round(pct * 100)}
          </div>
        </div>
      )}
      {(book.fav_character || book.review) && (
        <div className="book-notes">
          {book.fav_character && (
            <p>
              <span className="muted small">En sevdiğim karakter</span>
              <br />
              {book.fav_character}
            </p>
          )}
          {book.review && (
            <p>
              <span className="muted small">Bir cümleyle</span>
              <br />“{book.review}”
            </p>
          )}
        </div>
      )}
      {onMove && (
        <button className="btn full" onClick={onMove}>
          Ağacının yerini değiştir
        </button>
      )}
      <div className="actions wrap">
        <ConfirmButton className="btn ghost sm danger" confirmLabel="Silinsin mi?" onConfirm={async () => { await deleteBook(book.id); onClose(); }}>
          Sil
        </ConfirmButton>
        {book.status === 'want' && (
          <button className="btn primary" onClick={async () => { await startBook(book.id); onClose(); }}>
            Okumaya başla
          </button>
        )}
        {book.status === 'reading' && (
          <>
            {onFinish && (
              <button className="btn" onClick={onFinish}>
                Bitirdim
              </button>
            )}
            {onRead && (
              <button className="btn primary" onClick={onRead}>
                📖 Okudum
              </button>
            )}
          </>
        )}
      </div>
      {book.status === 'want' && book.created_at && (
        <p className="muted small">Listeye eklendi: {formatDay(toLocalDate(new Date(book.created_at)))}</p>
      )}
    </Sheet>
  );
}
