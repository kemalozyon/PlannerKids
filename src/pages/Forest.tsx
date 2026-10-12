import { useEffect, useMemo, useState } from 'react';
import BookTree from '../components/BookTree';
import { BookSheet } from '../components/ReadingSheets';
import Sheet from '../components/Sheet';
import Tree from '../components/Tree';
import { useApi } from '../lib/ApiContext';
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
import type { Wallet } from '../lib/game';
import { useGame } from '../lib/GameContext';
import { MOODS } from '../lib/mood';
import { bookTreeSize, parcelCells, PARCEL_COLS, SIZE_NAMES } from '../lib/reading';
import { useReading } from '../lib/ReadingContext';
import type { Book, BookTree as BookTreeT, Course, ForestTree, Reflection, StudyLog } from '../lib/types';

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

  useEffect(() => {
    if (startPlanting && stats?.wallets.length) {
      setMonth(thisMonth);
      setMode({ kind: 'shop', wallet: stats.wallets.find((w) => w.date === today) ?? stats.wallets[0] });
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
  const leftOf = (date: string) =>
    minutesOf(date) - stats.trees.filter((t) => t.date === date).reduce((sum, t) => sum + priceOf(t.stage), 0);

  const onCell = async (cell: number) => {
    setError(null);
    const tree = byCell.get(cell);
    try {
      if (mode.kind === 'place' && !tree) {
        const { wallet, stage, species } = mode;
        setMode({ kind: 'idle' });
        await plant({ date: wallet.date, stage, species, month: thisMonth, cell });
        const left = wallet.left - priceOf(stage);
        celebrate({
          kind: 'stage',
          icon: '🌱',
          title: 'Ormanına diktin!',
          detail: `${speciesById(species).name} · ${STAGES[stage].name}${left >= STAGES[0].min ? ` · cüzdanda ${left} dk kaldı` : ''}`,
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

      {isCurrent && stats.wallets.length + pendingBooks.length > 0 && mode.kind === 'idle' && (
        <section className="card pending-card">
          <h2>Harcanmayı bekleyen cüzdanlar</h2>
          <div className="pending-list">
            {stats.wallets.map((w) => (
              <button key={w.date} className="pending" onClick={() => setMode({ kind: 'shop', wallet: w })}>
                <span className="wallet-coin" aria-hidden>
                  🪙
                </span>
                <span className="pending-text">
                  <strong>{w.date === today ? 'Bugün' : shortDay(w.date)}</strong>
                  <span className="muted small">
                    {w.left} dk harcanabilir{w.spent > 0 ? ` · ${w.spent} dk harcandı` : ''}
                  </span>
                </span>
                <span className="pending-cta">Harca</span>
              </button>
            ))}
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

      {busy && (
        <div className="place-banner" role="status">
          <span>
            {mode.kind === 'place'
              ? 'Bitkini dikmek için boş bir yere dokun'
              : mode.kind === 'placeBook'
                ? `"${mode.book.title}" ağacı için kitap parselinde bir yer seç`
                : 'Yeni yerini seç'}
          </span>
          <button className="btn sm" onClick={() => setMode({ kind: 'idle' })}>
            Vazgeç
          </button>
        </div>
      )}
      {error && <div className="error">{error}</div>}

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
      {!busy && total > 0 && <p className="muted small center">Bir bitkiye dokun, o gün ne çalıştığını gör.</p>}

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

      {isCurrent && stats.today.earned < STAGES[0].min && mode.kind === 'idle' && (
        <p className="muted small center">
          Bugün {formatMinutes(STAGES[0].min)} çalışınca ilk tohumunu alabilirsin. ({formatMinutes(stats.todayMinutes)} çalıştın)
        </p>
      )}

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
        <DetailSheet
          tree={detail}
          minutes={minutesOf(detail.date)}
          left={leftOf(detail.date)}
          courses={courses}
          canEdit={detail.month === thisMonth}
          onClose={() => setDetail(null)}
          onMove={() => {
            setMode({ kind: 'move', tree: detail });
            setDetail(null);
          }}
          onUpgrade={async (stage) => {
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
          }}
        />
      )}
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
          <strong>{wallet.left} dk</strong> harcayabilirsin
          <span className="muted small"> · {formatDay(wallet.date)}</span>
        </span>
      </div>
      <ul className="shop" role="radiogroup" aria-label="Ne almak istersin?">
        {STAGES.map((st, i) => {
          const can = priceOf(i) <= wallet.left;
          const count = Math.floor(wallet.left / priceOf(i));
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
                  <span className="muted small">{can ? (count > 1 ? `bu parayla ${count} tane alabilirsin` : 'alabilirsin') : `${priceOf(i) - wallet.left} dk daha lazım`}</span>
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
      <button className="btn primary big full" onClick={() => onBuy(stage, sel)}>
        {STAGES[stage].name} al, yerini seç · kalan {after} dk
      </button>
    </Sheet>
  );
}

function DetailSheet({
  tree,
  minutes,
  left,
  courses,
  canEdit,
  onClose,
  onMove,
  onUpgrade,
}: {
  tree: ForestTree;
  minutes: number;
  /** O günün cüzdanında kalan */
  left: number;
  courses: Course[];
  canEdit: boolean;
  onClose: () => void;
  onMove: () => void;
  onUpgrade: (stage: number) => void;
}) {
  const api = useApi();
  const [logs, setLogs] = useState<StudyLog[] | null>(null);
  const [ref, setRef] = useState<Reflection | null>(null);
  useEffect(() => {
    api.listLogs(tree.date, tree.date).then(setLogs);
    api.getReflection(tree.date).then(setRef);
  }, [api, tree.date]);

  const stage = tree.stage;
  const sp = speciesById(tree.species);
  const upgrades = STAGES.map((st, i) => ({ st, i, cost: priceOf(i) - priceOf(stage) })).filter((u) => u.i > stage);
  const byCourse = new Map<string, number>();
  logs?.forEach((l) => byCourse.set(l.course_id, (byCourse.get(l.course_id) ?? 0) + l.duration_minutes));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const mood = ref?.rating ? MOODS[ref.rating - 1] : null;

  return (
    <Sheet title={formatDay(tree.date)} onClose={onClose}>
      <div className="detail-top">
        <Tree species={tree.species} stage={stage} size={84} />
        <div>
          <div className="detail-time">{formatMinutes(minutes)}</div>
          <div className="muted">
            {sp.name} · {STAGES[stage].name} · 🪙 {priceOf(stage)}
          </div>
          {left > 0 && <div className="muted small">O günün cüzdanında {left} dk kaldı</div>}
        </div>
      </div>
      {logs && byCourse.size > 0 && (
        <ul className="list detail-courses">
          {[...byCourse.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([cid, m]) => {
              const c = courseById.get(cid);
              return (
                <li key={cid} className="row">
                  <span className="dot" style={{ background: c?.color ?? '#999' }} />
                  <span className="grow">{c?.name ?? 'Silinmiş ders'}</span>
                  <strong className="nowrap">{formatMinutes(m)}</strong>
                </li>
              );
            })}
        </ul>
      )}
      {(mood || ref?.note) && (
        <div className="detail-mood">
          {mood && (
            <span className="detail-face" title={mood.label}>
              {mood.face}
            </span>
          )}
          <span>{ref?.note || mood?.label}</span>
        </div>
      )}
      {canEdit && upgrades.length > 0 && (
        <div className="field">
          <span>Büyüt (farkını öde)</span>
          <div className="upgrades">
            {upgrades.map(({ st, i, cost }) => (
              <button key={st.id} className="btn upgrade" disabled={cost > left} onClick={() => onUpgrade(i)}>
                <Tree species={tree.species} stage={i} size={30} />
                <span>{st.name}</span>
                <span className="price">🪙 {cost}</span>
              </button>
            ))}
          </div>
          {upgrades[0].cost > left && (
            <span className="muted small">O gün biraz daha çalışırsan {upgrades[0].st.name.toLowerCase()} olabilir.</span>
          )}
        </div>
      )}
      {canEdit && (
        <button className="btn full" onClick={onMove}>
          Yerini değiştir
        </button>
      )}
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
        Çalıştığın her dakika 🪙 1 dk para. Parayı istediğin gibi harca: 3 saatle bir dev ağaç ya da iki küçük ağaç alabilirsin.
        Diktiğin bitkiyi, o günün parası yetiyorsa farkını ödeyip büyütebilirsin. Harcamadığın para ay sonuna kadar bekler.
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
