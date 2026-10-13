import { useEffect, useState } from 'react';
import { daysBetween, formatDay, formatMinutes, toLocalDate } from '../lib/date';
import { CFG } from '../lib/config';
import { useGame } from '../lib/GameContext';
import { BOOK_COLORS, GENRES, RECOMMENDERS, inkOn, pickBookColor } from '../lib/reading';
import { useReading } from '../lib/ReadingContext';
import { searchBooks, type FoundBook } from '../lib/openLibrary';
import type { Book, BookStatus } from '../lib/types';
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
/** Ad ya da ISBN ile Open Library'de ara; seçilince kapak, yazar ve sayfa dolar. Bulunamazsa elle yaz. */
function BookSearch({ onPick }: { onPick: (b: FoundBook) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<FoundBook[] | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    const ctrl = new AbortController();
    // Yazarken her harfte değil, 400 ms durunca ara
    const t = setTimeout(() => {
      setState('busy');
      searchBooks(q, ctrl.signal).then(
        (r) => {
          setFound(r);
          setState('idle');
        },
        (e) => {
          if ((e as Error).name !== 'AbortError') setState('error');
        },
      );
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  return (
    <div className="book-search">
      <label className="field">
        <span>🔎 Kitabı ara (ad ya da ISBN)</span>
        <input id="book-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ör. Küçük Prens ya da 9789750719387" autoComplete="off" />
      </label>
      {state === 'busy' && <p className="muted small">Aranıyor…</p>}
      {state === 'error' && <p className="muted small">Şu an aranamıyor (internet yok olabilir). Aşağıya kendin yazabilirsin.</p>}
      {found && state === 'idle' && (
        <ul className="search-results">
          {found.length === 0 && <li className="muted small">Bulunamadı. Aşağıya kendin yazabilirsin; kitabın renkli sırtla rafa dizilir.</li>}
          {found.map((b, i) => (
            <li key={`${b.ol_key}-${i}`}>
              <button
                type="button"
                className="search-hit"
                onClick={() => {
                  onPick(b);
                  setQ('');
                  setFound(null);
                }}
              >
                {b.cover_url ? <img src={b.cover_url.replace('-M.jpg', '-S.jpg')} alt="" loading="lazy" /> : <span className="hit-nocover" aria-hidden>📕</span>}
                <span className="grow">
                  <strong>{b.title}</strong>
                  <span className="muted small">
                    {[b.author, b.year, b.pages && `${b.pages} sayfa`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddBookSheet({ onClose }: { onClose: () => void }) {
  const { addBook } = useReading();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [genre, setGenre] = useState('');
  const [rec, setRec] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [status, setStatus] = useState<BookStatus>('want');
  const [fav, setFav] = useState('');
  const [found, setFoundBook] = useState<FoundBook | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = color ?? pickBookColor(title || 'kitap');
  const done = status === 'done';
  const favMissing = done && fav.trim().length < 3;

  return (
    <Sheet title="Kitap ekle" onClose={onClose}>
      <BookSearch
        onPick={(b) => {
          setFoundBook(b);
          setTitle(b.title);
          setAuthor(b.author ?? '');
          setPages(b.pages ? String(b.pages) : '');
        }}
      />
      <form
        className="book-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || favMissing) return;
          setBusy(true);
          const same = found && found.title === title.trim();
          const n = Number(pages) > 0 ? Math.round(Number(pages)) : null;
          await addBook({
            title: title.trim(),
            author: author.trim() || null,
            pages: n,
            genre: genre || null,
            recommended_by: rec.trim() || null,
            color: shown,
            status,
            isbn: same ? found.isbn : null,
            ol_key: same ? found.ol_key : null,
            cover_url: same ? found.cover_url : null,
            favorite_part: fav.trim() || null,
            ...(status !== 'want' ? { started_on: toLocalDate() } : {}),
            ...(done ? { finished_on: toLocalDate(), current_page: n ?? 0 } : {}),
          });
          onClose();
        }}
      >
        <div className="book-form-top">
          {found?.cover_url && found.title === title ? (
            <img className="form-cover" src={found.cover_url} alt={`${title} kapağı`} />
          ) : (
            <Spine book={{ title: title || 'Kitap adı', pages: Number(pages) || 150, color: shown } as Book} />
          )}
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
        {!(found?.cover_url && found.title === title) && (
          <div className="field">
            <span>Kitabın rengi (kapak bulunamazsa sırtı bu renkte olur)</span>
            <div className="swatches">
              {BOOK_COLORS.map((c) => (
                <button type="button" key={c} aria-label={c} className={shown === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
        )}
        <div className="tabs book-status" role="radiogroup" aria-label="Bu kitap">
          {(
            [
              ['want', 'Okuyacağım'],
              ['reading', 'Okuyorum'],
              ['done', 'Bitirdim'],
            ] as const
          ).map(([v, label]) => (
            <button type="button" key={v} role="radio" aria-checked={status === v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>
              {label}
            </button>
          ))}
        </div>
        {(done || status === 'reading') && (
          <label className="field">
            <span>{done ? 'En sevdiğin kısım neydi?' : 'Şimdiye kadar en sevdiğin kısım? (istersen)'}</span>
            <textarea id="book-fav" rows={2} maxLength={300} value={fav} onChange={(e) => setFav(e.target.value)} placeholder="ör. Tilkinin evcilleştirilmeyi anlattığı yer" />
          </label>
        )}
        <button className="btn primary big full" disabled={busy || !title.trim() || favMissing}>
          {done ? 'Rafıma diz' : status === 'reading' ? 'Ekle ve başla' : 'Okunacaklara ekle'}
        </button>
        {favMissing && <p className="muted small center">Bitirdiğin kitap için en sevdiğin kısmı kısaca yaz.</p>}
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
  onShelf,
}: {
  book: Book;
  start?: Step;
  onClose: () => void;
  /** "Kitaplığımda gör" → odadaki kitaplık */
  onShelf?: () => void;
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
  const [part, setPart] = useState(initial.favorite_part ?? '');
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
          <span>En sevdiğin kısım neydi?</span>
          <textarea id="finish-part" rows={2} value={part} maxLength={300} onChange={(e) => setPart(e.target.value)} placeholder="ör. Tilkinin evcilleştirilmeyi anlattığı yer" />
        </label>
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
          disabled={busy || part.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            await finishBook(book.id, rating, fav, review, part);
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
        <strong>{book.title}</strong> artık odandaki kitaplığın rafında. Raf dolunca yeni raf eklenir; {CFG.world.library.books} kitapta kütüphane odan açılır.
      </p>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          Tamam
        </button>
        {onShelf && (
          <button className="btn primary" onClick={onShelf}>
            📚 Kitaplığımda gör
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
}: {
  book: Book;
  onClose: () => void;
  onRead?: () => void;
  onFinish?: () => void;
}) {
  const { stats, startBook, deleteBook } = useReading();
  const minutes = stats?.minutesByBook.get(book.id) ?? 0;
  const days = book.started_on && book.finished_on ? daysBetween(book.started_on, book.finished_on) + 1 : null;
  const pct = book.pages ? Math.min(1, book.current_page / book.pages) : 0;

  return (
    <Sheet title={book.status === 'done' ? 'Kitaplığımdan' : book.status === 'reading' ? 'Okuyorum' : 'Okunacaklar'} onClose={onClose}>
      <div className="book-card">
        <div className={`cover${book.cover_url ? ' has-img' : ''}`} style={{ background: book.color, color: inkOn(book.color) }}>
          {book.cover_url ? (
            <img src={book.cover_url} alt={`${book.title} kapağı`} />
          ) : (
            <>
              <span className="cover-title">{book.title}</span>
              {book.author && <span className="cover-author">{book.author}</span>}
            </>
          )}
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
      {(book.favorite_part || book.fav_character || book.review) && (
        <div className="book-notes">
          {book.favorite_part && (
            <p>
              <span className="muted small">En sevdiğim kısım</span>
              <br />“{book.favorite_part}”
            </p>
          )}
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
