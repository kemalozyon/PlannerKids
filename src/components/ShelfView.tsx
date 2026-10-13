// "Bütün kitaplarım": bitirilen kitaplar sırtlarıyla (Open Library kapağı varsa kapakla) dizilir. Her rafta 12
// kitap; raf dolunca yeni raf eklenir. Evdeki kitaplıklarda ve kütüphane odasında aynı kitaplar 3D durur.
import { useState } from 'react';
import { CFG } from '../lib/config';
import { formatShort } from '../lib/date';
import { inkOn } from '../lib/reading';
import type { Book } from '../lib/types';
import Sheet from './Sheet';

const PER = CFG.world.library.perShelf;

export { BookCard };

export default function ShelfView({ books, onClose }: { books: Book[]; onClose: () => void }) {
  const [open, setOpen] = useState<Book | null>(null);
  const done = books.filter((b) => b.status === 'done').sort((a, b) => (a.finished_on ?? '').localeCompare(b.finished_on ?? ''));
  const reading = books.filter((b) => b.status === 'reading');
  // Son raf doluysa boş bir raf daha: "sıradaki kitapların yeri"
  const shelves = Math.max(1, Math.ceil(done.length / PER) + (done.length && done.length % PER === 0 ? 1 : 0));
  return (
    <Sheet title="📚 Kitaplığım" onClose={onClose}>
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
    </Sheet>
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
