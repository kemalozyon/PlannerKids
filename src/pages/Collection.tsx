// Koleksiyon defteri: bütün eşyalar türlerine göre; sahip olunmayanlar gölge gibi görünür ve nasıl
// açılacağı yazar. Altta anı albümü: geçmiş ayların adaları, o ayın ağaçları ve yerleşimiyle.
import { lazy, Suspense, useMemo, useState } from 'react';
import ItemCard from '../components/ItemCard';
import { CATEGORIES, itemById, ITEMS, type Item } from '../lib/catalog';
import { owns, unlockHint } from '../lib/economy';
import { formatMonth, monthOf } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import { toLocalDate } from '../lib/date';
import { hasWebGL } from '../lib/webgl';
import { ItemSheet } from './Shop';

const Island3D = lazy(() => import('../components/forest3d/Island3D'));

export default function Collection() {
  const { stats, equip, buy } = useGame();
  const [open, setOpen] = useState<Item | null>(null);
  const can3D = useMemo(hasWebGL, []);
  const thisMonth = monthOf(toLocalDate());
  const months = useMemo(
    () => [...new Set((stats?.trees ?? []).map((t) => t.month).filter((m) => m < thisMonth))].sort().reverse(),
    [stats, thisMonth],
  );
  const [album, setAlbum] = useState<string | null>(null);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const have = (i: Item) => owns(i, stats.owned, stats.unlock);
  const total = ITEMS.filter(have).length;
  const shown = album ?? months[0] ?? null;
  const ownedById = new Map(stats.owned.map((o) => [o.id, o]));

  return (
    <div className="stack">
      <section className="card collection-head">
        <div className="big-num">
          {total}/{ITEMS.length}
        </div>
        <div className="muted small">eşya topladın</div>
        <div className="pbar" aria-hidden>
          <span style={{ width: `${(total / ITEMS.length) * 100}%` }} />
        </div>
      </section>

      {CATEGORIES.map((c) => {
        const items = ITEMS.filter((i) => i.category === c.id);
        const got = items.filter(have).length;
        return (
          <section key={c.id} className="card">
            <div className="card-head">
              <h2>
                {c.icon} {c.name}
              </h2>
              <span className="muted small">
                {got}/{items.length}
              </span>
            </div>
            <div className="item-grid">
              {items.map((i) => {
                const mine = have(i);
                return (
                  <ItemCard
                    key={i.id}
                    item={i}
                    have={mine}
                    silhouette={!mine && i.rarity === 'efsanevi'}
                    footer={mine ? '✓' : i.acquire.kind === 'buy' ? 'Dükkânda' : unlockHint(i)}
                    onClick={() => setOpen(i)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="card">
        <h2>📸 Anı albümü</h2>
        {months.length === 0 ? (
          <p className="muted small">Ay bitince o ayın adası buraya anı olarak eklenir.</p>
        ) : (
          <>
            <div className="album-months">
              {months.map((m) => (
                <button key={m} className={`chip${m === shown ? ' on' : ''}`} onClick={() => setAlbum(m)}>
                  {formatMonth(m)}
                </button>
              ))}
            </div>
            {shown && can3D ? (
              <Suspense fallback={<div className="island-wrap island-loading">🏝️</div>}>
                <Island3D
                  key={shown}
                  month={shown}
                  trees={stats.trees.filter((t) => t.month === shown)}
                  wilts={stats.wilts.filter((w) => monthOf(w.item.date) === shown)}
                  totalMinutes={[...stats.dayTotals].reduce((s, [d, m]) => (monthOf(d) <= shown ? s + m : s), 0)}
                  placing="none"
                  onCell={() => {}}
                  onTree={() => {}}
                  onWilt={() => {}}
                  placed={stats.placements
                    .filter((p) => p.month === shown)
                    .flatMap((p) => {
                      const item = itemById(ownedById.get(p.owned_id)?.item_id ?? '');
                      return item?.model ? [{ p, item }] : [];
                    })}
                />
              </Suspense>
            ) : (
              shown && <p className="muted small">{stats.trees.filter((t) => t.month === shown).length} ağaç dikmiştin.</p>
            )}
          </>
        )}
      </section>

      {open && <ItemSheet item={open} can3D={can3D} onClose={() => setOpen(null)} onBuy={() => buy(open.id)} onEquip={(e) => equip(e)} />}
    </div>
  );
}
