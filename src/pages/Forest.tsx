import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import BookTree from '../components/BookTree';
import DaySheet from '../components/DaySheet';
import { BookSheet } from '../components/ReadingSheets';
import Sheet from '../components/Sheet';
import Tree from '../components/Tree';
import { formatDay, formatMinutes, parseLocalDate, toLocalDate } from '../lib/date';
import {
  CELLS,
  COLS,
  SPECIES,
  STAGES,
  formatMonth,
  monthOf,
  priceOf,
  shiftMonth,
  speciesById,
  stageIndex,
} from '../lib/forest';
import { dayAction, type Wallet } from '../lib/game';
import { BIOMES, islandProgress } from '../lib/island';
import { REVIVE_MIN, type Wilt } from '../lib/wilt';
import { useGame } from '../lib/GameContext';
import { bookTreeSize, parcelCells, PARCEL_COLS, SIZE_NAMES } from '../lib/reading';
import { useReading } from '../lib/ReadingContext';
import type { Book, BookTree as BookTreeT, Course, ForestTree } from '../lib/types';

// three.js büyük: 3D ada yalnızca Orman açılınca yüklenir
const Island3D = lazy(() => import('../components/forest3d/Island3D'));
const VIEW_KEY = 'ct-forest-view-v1';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** 3D sahne çökerse sayfa gitmesin, düz ızgara gösterilsin */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'shop'; wallet: Wallet }
  | { kind: 'place'; wallet: Wallet; stage: number; species: string }
  | { kind: 'move'; tree: ForestTree }
  | { kind: 'placeBook'; book: Book }
  | { kind: 'moveBook'; tree: BookTreeT };

export default function Forest({
  courses,
  startPlanting,
  plantBookId,
  onStarted,
}: {
  courses: Course[];
  /** Bugün ekranındaki "Ormana dik" butonundan gelindiyse true */
  startPlanting?: boolean;
  /** Kitap bitirme akışındaki "Ağacını dik" butonundan gelindiyse kitabın id'si */
  plantBookId?: string | null;
  onStarted?: () => void;
}) {
  const { stats, plant, move, upgrade, celebrate } = useGame();
  const reading = useReading();
  const today = toLocalDate();
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [detail, setDetail] = useState<ForestTree | null>(null);
  const [bookDetail, setBookDetail] = useState<BookTreeT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wiltOpen, setWiltOpen] = useState<Wilt | null>(null);
  const can3D = useMemo(hasWebGL, []);
  const [view, setView] = useState<'3d' | '2d'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === '2d' ? '2d' : '3d';
    } catch {
      return '3d';
    }
  });
  const switchView = (v: '3d' | '2d') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* yok say */
    }
  };

  useEffect(() => {
    if (startPlanting && stats?.wallets.length) {
      setMonth(thisMonth);
      // Bugünün ağacı dikiliyse büyütmek için onu aç, değilse dükkânı
      const w = stats.wallets.find((x) => x.date === today) ?? stats.wallets[0];
      if (w.tree) setDetail(w.tree);
      else setMode({ kind: 'shop', wallet: w });
      onStarted?.();
    }
  }, [startPlanting, stats, thisMonth, today, onStarted]);

  useEffect(() => {
    const book = plantBookId && reading.stats?.pendingTrees.find((b) => b.id === plantBookId);
    if (book) {
      setMonth(thisMonth);
      setMode({ kind: 'placeBook', book });
      onStarted?.();
    }
  }, [plantBookId, reading.stats, thisMonth, onStarted]);

  const trees = useMemo(() => (stats?.trees ?? []).filter((t) => t.month === month), [stats, month]);
  const byCell = useMemo(() => new Map(trees.map((t) => [t.cell, t])), [trees]);
  const bookTrees = useMemo(() => reading.trees.filter((t) => t.month === month), [reading.trees, month]);

  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const firstMonth =
    [...stats.dayTotals.keys(), ...stats.trees.map((t) => t.date)].map(monthOf).concat(reading.trees.map((t) => t.month)).sort()[0] ??
    thisMonth;
  const isCurrent = month === thisMonth;
  const placing = mode.kind === 'place' || mode.kind === 'move';
  const bookPlacing = mode.kind === 'placeBook' || mode.kind === 'moveBook';
  const busy = placing || bookPlacing;
  const pendingBooks = isCurrent ? (reading.stats?.pendingTrees ?? []) : [];
  const minutesOf = (date: string) => stats.dayTotals.get(date) ?? 0;

  const onCell = async (cell: number) => {
    setError(null);
    const tree = byCell.get(cell);
    try {
      if (mode.kind === 'place' && !tree) {
        const { wallet, stage, species } = mode;
        setMode({ kind: 'idle' });
        await plant({ date: wallet.date, stage, species, month: thisMonth, cell });
        celebrate({
          kind: 'stage',
          icon: '🌱',
          title: wallet.date === today ? 'Bugünün ağacını diktin!' : 'Ormanına diktin!',
          detail: `${speciesById(species).name} · ${STAGES[stage].name}${stage < STAGES.length - 1 ? ' · çalıştıkça büyütebilirsin' : ''}`,
        });
      } else if (mode.kind === 'move' && !tree) {
        const id = mode.tree.id;
        setMode({ kind: 'idle' });
        await move(id, cell);
      } else if (tree && !placing) {
        setDetail(tree);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const grid2D = (
      <div className={`forest${placing ? ' placing' : ''}${isCurrent ? '' : ' past'}${bookPlacing ? ' dimmed' : ''}`}>
        <div className="forest-grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {Array.from({ length: CELLS }, (_, cell) => {
            const t = byCell.get(cell);
            const row = Math.floor(cell / COLS);
            const moving = mode.kind === 'move' && mode.tree.id === t?.id;
            return (
              <button
                key={cell}
                className={`cell${t ? ' has' : ' empty'}${moving ? ' moving' : ''}${(row + cell) % 2 ? ' alt' : ''}`}
                style={{ zIndex: row + 1 }}
                disabled={bookPlacing || (placing ? !!t : !t)}
                aria-label={t ? `${shortDay(t.date)}: ${speciesById(t.species).name}` : 'Boş yer'}
                onClick={() => onCell(cell)}
              >
                {t && (
                  <span className="cell-tree">
                    <Tree species={t.species} stage={t.stage} size={60} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
  );

  const total = trees.length;
  const bigOnes = trees.filter((t) => t.stage >= 3).length;

  return (
    <div className="stack">
      <header className="forest-head">
        <button
          className="icon-btn"
          aria-label="Önceki ay"
          disabled={month <= firstMonth || busy}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ‹
        </button>
        <div className="center grow">
          <h1>{isCurrent ? 'Ormanım' : `${formatMonth(month)} ormanı`}</h1>
          <div className="muted small">
            {isCurrent ? formatMonth(month) + ' · ' : ''}
            {total === 0 ? 'Henüz bitki yok' : `${total} bitki${bigOnes ? `, ${bigOnes} büyük ağaç` : ''}`}
            {bookTrees.length > 0 && ` · ${bookTrees.length} kitap ağacı`}
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label="Sonraki ay"
          disabled={isCurrent || busy}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          ›
        </button>
      </header>

      {busy && (
        <div className="place-banner" role="status">
          <span>
            {mode.kind === 'place'
              ? 'Bitkini dikmek için boş bir yere dokun'
              : mode.kind === 'placeBook'
                ? `"${mode.book.title}" ağacı için kitap parselinde bir yer seç`
                : 'Yeni yerini seç'}
          </span>
          {(mode.kind === 'place' || mode.kind === 'move') && (
            <button
              className="btn sm"
              onClick={() => {
                const free = Array.from({ length: CELLS }, (_, c) => c).filter((c) => !byCell.has(c));
                if (free.length) onCell(free[Math.floor(Math.random() * free.length)]);
              }}
            >
              🎲 Benim için seç
            </button>
          )}
          <button className="btn sm" onClick={() => setMode({ kind: 'idle' })}>
            Vazgeç
          </button>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {can3D && view === '3d' ? (
        <Fallback fallback={grid2D}>
          <Suspense fallback={<div className="island-wrap island-loading">🏝️ Adan yükleniyor…</div>}>
            <Island3D
              month={month}
              trees={trees}
              wilts={stats.wilts.filter((w) => monthOf(w.item.date) === month)}
              totalMinutes={[...stats.dayTotals].reduce((sum, [d, m]) => (monthOf(d) <= month ? sum + m : sum), 0)}
              placing={mode.kind === 'place' ? 'tree' : mode.kind === 'move' ? 'move' : 'none'}
              movingId={mode.kind === 'move' ? mode.tree.id : undefined}
              onCell={onCell}
              onTree={(t) => setDetail(t)}
              onWilt={setWiltOpen}
            />
          </Suspense>
        </Fallback>
      ) : (
        grid2D
      )}
      {can3D && (
        <div className="view-toggle" role="group" aria-label="Orman görünümü">
          <button className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => switchView('3d')}>
            🏝️ 3D ada
          </button>
          <button className={view === '2d' ? 'on' : ''} aria-pressed={view === '2d'} onClick={() => switchView('2d')}>
            ▦ Düz
          </button>
        </div>
      )}
      {!busy && total > 0 && <p className="muted small center">Bir ağaca dokun, o gün ne çalıştığını gör.</p>}

      {isCurrent && stats.wallets.length + pendingBooks.length > 0 && mode.kind === 'idle' && (
        <section className="card pending-card">
          <h2>Ağacını bekleyen günler</h2>
          <div className="pending-list">
            {stats.wallets.map((w) => {
              const act = dayAction(w);
              if (!act) return null;
              return (
                <button
                  key={w.date}
                  className="pending"
                  onClick={() => (w.tree ? setDetail(w.tree) : setMode({ kind: 'shop', wallet: w }))}
                >
                  {w.tree ? (
                    <Tree species={w.tree.species} stage={w.tree.stage} size={40} />
                  ) : (
                    <span className="wallet-coin" aria-hidden>
                      🪙
                    </span>
                  )}
                  <span className="pending-text">
                    <strong>{w.date === today ? 'Bugün' : shortDay(w.date)}</strong>
                    <span className="muted small">
                      {w.earned} dk ·{' '}
                      {act.kind === 'plant'
                        ? `${STAGES[act.stage].name.toLowerCase()} dikebilirsin`
                        : `${STAGES[w.tree!.stage].name.toLowerCase()} → ${STAGES[act.stage].name.toLowerCase()} büyütebilirsin`}
                    </span>
                  </span>
                  <span className="pending-cta">{act.kind === 'plant' ? 'Dik' : 'Büyüt'}</span>
                </button>
              );
            })}
            {pendingBooks.map((b) => (
              <button key={b.id} className="pending book" onClick={() => setMode({ kind: 'placeBook', book: b })}>
                <BookTree size={bookTreeSize(b.pages)} color={b.color} px={44} />
                <span className="pending-text">
                  <strong>{b.title}</strong>
                  <span className="muted small">{SIZE_NAMES[bookTreeSize(b.pages)]} · kitap parseline</span>
                </span>
                <span className="pending-cta">Dik</span>
              </button>
            ))}
          </div>
        </section>
      )}


      <BookParcel
        month={month}
        trees={bookTrees}
        books={reading.books}
        pendingCount={pendingBooks.length}
        mode={mode}
        onPlace={async (cell) => {
          setError(null);
          try {
            if (mode.kind === 'placeBook') {
              const book = mode.book;
              setMode({ kind: 'idle' });
              await reading.plantBook(book.id, monthOf(book.finished_on ?? today), cell);
              celebrate({ kind: 'badge', icon: '📚', title: 'Kitap ağacın dikildi!', detail: `${book.title} · ${SIZE_NAMES[bookTreeSize(book.pages)]}` });
            } else if (mode.kind === 'moveBook') {
              const id = mode.tree.id;
              setMode({ kind: 'idle' });
              await reading.moveBookTree(id, cell);
            }
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        onOpen={(t) => setBookDetail(t)}
      />

      {isCurrent && !stats.today.tree && stats.today.earned < STAGES[0].min && mode.kind === 'idle' && (
        <p className="muted small center">
          Bugün {formatMinutes(STAGES[0].min)} çalışınca bugünün ağacını dikebilirsin. ({formatMinutes(stats.todayMinutes)} çalıştın)
        </p>
      )}

      <IslandCard totalMinutes={stats.totalMinutes} />
      <SpeciesInfo bestStreak={stats.bestStreak} unlocked={stats.unlockedSpecies} />
      <StageLadder />
      <Badges />

      {mode.kind === 'shop' && (
        <ShopSheet
          wallet={mode.wallet}
          unlocked={stats.unlockedSpecies}
          initial={stats.favoriteSpecies}
          onCancel={() => setMode({ kind: 'idle' })}
          onBuy={(stage, species) => setMode({ kind: 'place', wallet: mode.wallet, stage, species })}
        />
      )}
      {detail && (
        <DaySheet
          date={detail.date}
          tree={detail}
          minutes={minutesOf(detail.date)}
          courses={courses}
          onClose={() => setDetail(null)}
          edit={
            detail.month === thisMonth
              ? {
                  onMove: () => {
                    setMode({ kind: 'move', tree: detail });
                    setDetail(null);
                  },
                  onUpgrade: async (stage) => {
                    const from = detail.stage;
                    setDetail(null);
                    try {
                      await upgrade(detail.id, stage);
                      celebrate({
                        kind: 'stage',
                        icon: '🌳',
                        title: `Büyüttün: ${STAGES[stage].name}!`,
                        detail: `${STAGES[from].name} → ${STAGES[stage].name} · ${priceOf(stage) - priceOf(from)} dk ödedin`,
                      });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  },
                }
              : undefined
          }
        />
      )}
      {wiltOpen && <WiltSheet w={wiltOpen} today={today} onClose={() => setWiltOpen(null)} />}
      {bookDetail && reading.books.find((b) => b.id === bookDetail.book_id) && (
        <BookSheet
          book={reading.books.find((b) => b.id === bookDetail.book_id)!}
          onClose={() => setBookDetail(null)}
          onMove={
            bookDetail.month === thisMonth
              ? () => {
                  setMode({ kind: 'moveBook', tree: bookDetail });
                  setBookDetail(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function BookParcel({
  month,
  trees,
  books,
  pendingCount,
  mode,
  onPlace,
  onOpen,
}: {
  month: string;
  trees: BookTreeT[];
  books: Book[];
  pendingCount: number;
  mode: Mode;
  onPlace: (cell: number) => void;
  onOpen: (t: BookTreeT) => void;
}) {
  const active = mode.kind === 'placeBook' || mode.kind === 'moveBook';
  const byCell = new Map(trees.map((t) => [t.cell, t]));
  const bookById = new Map(books.map((b) => [b.id, b]));
  const n = parcelCells(trees.length + pendingCount, Math.max(-1, ...trees.map((t) => t.cell)));
  return (
    <section className={`parcel-wrap${active ? ' active' : ''}`} aria-label="Kitap parseli">
      <div className="parcel-head">
        <h2>📚 Kitap parselim</h2>
        <span className="muted small">
          {trees.length}/{n} · {formatMonth(month)}
        </span>
      </div>
      <div className="parcel">
        <div className="parcel-grid" style={{ gridTemplateColumns: `repeat(${PARCEL_COLS}, minmax(0, 1fr))` }}>
          {Array.from({ length: n }, (_, cell) => {
            const t = byCell.get(cell);
            const book = t && bookById.get(t.book_id);
            const moving = mode.kind === 'moveBook' && mode.tree.id === t?.id;
            return (
              <button
                key={cell}
                className={`pcell${t ? ' has' : ' empty'}${moving ? ' moving' : ''}`}
                style={{ zIndex: Math.floor(cell / PARCEL_COLS) + 1 }}
                disabled={active ? !!t : !t}
                aria-label={book ? book.title : 'Boş yer'}
                onClick={() => (active ? onPlace(cell) : t && onOpen(t))}
              >
                {book && (
                  <span className="cell-tree">
                    <BookTree size={bookTreeSize(book.pages)} color={book.color} label={book.title} px={72} />
                  </span>
                )}
                {book && <span className="pcell-label">{book.title}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {trees.length === 0 && !active && (
        <p className="muted small center">Bitirdiğin her kitap için burada bir kitap ağacı büyür. Kalın kitap, büyük ağaç!</p>
      )}
    </section>
  );
}

const shortDay = (d: string) =>
  parseLocalDate(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' });

function ShopSheet({
  wallet,
  unlocked,
  initial,
  onBuy,
  onCancel,
}: {
  wallet: Wallet;
  unlocked: Set<string>;
  initial: string;
  onBuy: (stage: number, species: string) => void;
  onCancel: () => void;
}) {
  const best = stageIndex(wallet.left);
  const [stage, setStage] = useState(best);
  const [sel, setSel] = useState(unlocked.has(initial) ? initial : SPECIES[0].id);
  const after = wallet.left - priceOf(stage);
  return (
    <Sheet title="Bitki dükkânı" onClose={onCancel}>
      <div className="wallet-bar">
        <span className="wallet-coin" aria-hidden>
          🪙
        </span>
        <span className="grow">
          <strong>{wallet.left} dk</strong> · {formatDay(wallet.date)}
          <span className="muted small"> · bu günün tek ağacı</span>
        </span>
      </div>
      <ul className="shop" role="radiogroup" aria-label="Ne almak istersin?">
        {STAGES.map((st, i) => {
          const can = priceOf(i) <= wallet.left;
          return (
            <li key={st.id}>
              <button
                role="radio"
                aria-checked={stage === i}
                className={`shop-item${stage === i ? ' on' : ''}`}
                disabled={!can}
                onClick={() => setStage(i)}
              >
                <Tree species={sel} stage={i} size={40} />
                <span className="grow">
                  <strong>{st.name}</strong>
                  <span className="muted small">{can ? (i === best ? 'paran buna yetiyor' : 'alabilirsin') : `${priceOf(i) - wallet.left} dk daha lazım`}</span>
                </span>
                <span className="price">🪙 {st.min}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="field">
        <span>Hangi ağaç?</span>
        <div className="species-grid">
          {SPECIES.map((s) => {
            const open = unlocked.has(s.id);
            return (
              <button
                key={s.id}
                className={`species${sel === s.id ? ' on' : ''}${open ? '' : ' locked'}`}
                disabled={!open}
                aria-pressed={sel === s.id}
                onClick={() => setSel(s.id)}
              >
                <Tree species={s.id} stage={Math.max(stage, 2)} size={44} />
                <span className="species-name">{s.name}</span>
                {!open && <span className="species-lock">🔒 {s.unlock} günlük seri</span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="muted small">
        Her güne bir ağaç dikilir. {after > 0 ? `Kalan ${after} dk ile bu ağacı sonra büyütebilirsin.` : 'Çalışmaya devam edersen bu ağacı büyütebilirsin.'}
      </p>
      <button className="btn primary big full" onClick={() => onBuy(stage, sel)}>
        {STAGES[stage].name} dik, yerini seç
      </button>
    </Sheet>
  );
}

/** Ada seviyesi: açılan biyomlar ve sıradaki sürpriz */
function IslandCard({ totalMinutes }: { totalMinutes: number }) {
  const p = islandProgress(totalMinutes);
  const prevAt = p.next ? (BIOMES[BIOMES.indexOf(p.next.biome) - 1]?.hours ?? 0) * 60 : 0;
  const pct = p.next ? (totalMinutes - prevAt) / (p.next.biome.hours * 60 - prevAt) : 1;
  return (
    <section className="card island-card">
      <div className="card-head">
        <h2>🏝️ Adacığım</h2>
        <span className="pill">Seviye {p.level}</span>
      </div>
      <div className="biome-row">
        {BIOMES.map((b) => (
          <span key={b.id} className={`biome${p.unlocked.has(b.id) ? ' on' : ''}`} title={`${b.name} · ${b.hours} saat`}>
            <span aria-hidden>{p.unlocked.has(b.id) ? b.icon : '🔒'}</span>
            <span className="biome-name">{p.unlocked.has(b.id) ? b.name : `${b.hours} sa`}</span>
          </span>
        ))}
      </div>
      {p.next ? (
        <>
          <div className="pbar gold" aria-hidden>
            <span style={{ width: `${Math.max(0.03, pct) * 100}%` }} />
          </div>
          <p className="small">
            Sıradaki sürpriz: <strong>{p.next.biome.icon} {p.next.biome.name}</strong>{' '}
            <span className="muted">· {formatMinutes(p.next.minutesLeft)} daha çalış</span>
          </p>
        </>
      ) : (
        <p className="small">Bütün sürprizleri açtın! Adan tam bir orman cenneti. 🌈</p>
      )}
      <p className="muted small">Toplam çalıştıkça adan büyür; çiçekler, gölet, kamp ateşi ve hayvan dostlar gelir. Hayvanlara dokunmayı dene!</p>
    </section>
  );
}

/** Solgun fidan: sayaç yarıda bırakılınca kalır; aynı gün çalışınca canlanır */
function WiltSheet({ w, today, onClose }: { w: Wilt; today: string; onClose: () => void }) {
  const isToday = w.item.date === today;
  return (
    <Sheet title={w.revived ? 'Kurtarılan fidan 🌱' : 'Solgun fidan 🥀'} onClose={onClose}>
      <p>
        {formatDay(w.item.date)} sayaç {formatMinutes(w.item.minutes)} sonra yarıda bırakıldı.
      </p>
      {w.revived ? (
        <p>Sonra yeniden çalışmaya döndün ve fidanı kurtardın. Aferin! 💪</p>
      ) : isToday ? (
        <>
          <p>
            Bugün <strong>{REVIVE_MIN - w.after} dk</strong> daha çalışırsan bu fidan yeniden yeşerir!
          </p>
          <div className="pbar" aria-hidden>
            <span style={{ width: `${(w.after / REVIVE_MIN) * 100}%`, background: 'var(--good)' }} />
          </div>
        </>
      ) : (
        <p className="muted">O gün çalışmaya dönülmediği için solgun kaldı. Bir dahaki sefere turu bitirmeyi dene!</p>
      )}
      <button className="btn full" onClick={onClose}>
        Tamam
      </button>
    </Sheet>
  );
}

function SpeciesInfo({ bestStreak, unlocked }: { bestStreak: number; unlocked: Set<string> }) {
  const next = SPECIES.find((s) => !unlocked.has(s.id));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Ağaç türlerim</h2>
        <span className="muted small tabular">
          {unlocked.size}/{SPECIES.length}
        </span>
      </div>
      <div className="species-row">
        {SPECIES.map((s) => (
          <div key={s.id} className={`species-mini${unlocked.has(s.id) ? '' : ' locked'}`} title={s.name}>
            <Tree species={s.id} stage={3} size={36} />
            <span>{unlocked.has(s.id) ? s.name : `🔒 ${s.unlock}`}</span>
          </div>
        ))}
      </div>
      <p className="muted small">
        En uzun serin: <strong>{bestStreak} gün</strong>.
        {next ? ` ${next.name} için ${next.unlock} günlük seri gerekiyor.` : ' Bütün türleri açtın!'}
      </p>
    </section>
  );
}

function StageLadder() {
  return (
    <section className="card">
      <h2>Bitki dükkânı fiyatları</h2>
      <ol className="ladder">
        {STAGES.map((s, i) => (
          <li key={s.id}>
            <Tree species="elma" stage={i} size={40} />
            <strong>{s.name}</strong>
            <span className="muted small">🪙 {s.min} dk</span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Çalıştığın her dakika 🪙 1 dk para. Her güne bir ağaç dikersin: o günün parası hangisine yetiyorsa onu seç.
        O gün çalışmaya devam edersen farkını ödeyip aynı ağacı büyütürsün; 3 saat çalışılan gün dev ağaç olur.
        Dikmediğin günlerin parası ay sonuna kadar bekler; ay bitince o ayın ormanına kendiliğinden dikilir.
      </p>
    </section>
  );
}

function Badges() {
  const { stats } = useGame();
  if (!stats) return null;
  const unlocked = stats.badges.filter((b) => b.unlocked).length;
  const nextBadge = stats.badges.filter((b) => !b.unlocked).sort((a, b) => b.progress - a.progress)[0];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Rozetlerim</h2>
        <span className="muted small tabular">
          {unlocked}/{stats.badges.length}
        </span>
      </div>
      {nextBadge && (
        <p className="muted small next-badge">
          Sıradaki: <strong>{nextBadge.title}</strong> — {nextBadge.desc.toLowerCase()} ({nextBadge.hint})
        </p>
      )}
      <ul className="badges">
        {stats.badges.map((b) => (
          <li key={b.id} className={b.unlocked ? 'on' : ''} title={b.desc}>
            <span className="badge-icon" aria-hidden>
              {b.icon}
            </span>
            <span className="badge-title">{b.title}</span>
            <span className="badge-desc">{b.desc}</span>
            {!b.unlocked && (
              <span className="badge-progress">
                <span style={{ width: `${b.progress * 100}%` }} />
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="rules muted small">
        <strong>Seri nasıl işler?</strong> Çalıştığın her gün serin 1 büyür. Hafta sonu dinlenmek seriyi bozmaz. Her hafta 1
        dinlenme hakkın var: hafta içi bir günü kaçırırsan serin bozulmaz.{' '}
        <span className={`pill${stats.restUsedThisWeek ? ' used' : ''}`}>
          {stats.restUsedThisWeek ? 'Bu hafta kullandın' : 'Bu hafta duruyor'}
        </span>
      </div>
    </section>
  );
}
