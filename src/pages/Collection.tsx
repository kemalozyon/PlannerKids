// Koleksiyon defteri: bütün eşyalar türlerine göre; sahip olunmayanlar gölge gibi görünür ve nasıl
// açılacağı yazar. Altta ormanın bölgeleri: her ay yeni bir bölge, geçmiş aylar Dünyam'da gezilebilir.
import { useMemo, useState } from 'react';
import ItemCard from '../components/ItemCard';
import { CATEGORIES, ITEMS, type Item } from '../lib/catalog';
import { owns, unlockHint } from '../lib/economy';
import { formatMonth } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import { hasWebGL } from '../lib/webgl';
import { ItemSheet } from './Shop';

export default function Collection({ goWorld }: { goWorld: () => void }) {
  const { stats, equip, buy } = useGame();
  const [open, setOpen] = useState<Item | null>(null);
  const can3D = useMemo(hasWebGL, []);
  const months = useMemo(() => {
    const m = new Map<string, { trees: number; dry: number; icons: string[] }>();
    for (const t of stats?.forest ?? []) {
      const e = m.get(t.month) ?? { trees: 0, dry: 0, icons: [] };
      if (t.dry) e.dry++;
      else {
        e.trees++;
        e.icons.push(t.icon);
      }
      m.set(t.month, e);
    }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [stats]);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const have = (i: Item) => owns(i, stats.owned, stats.unlock);
  const total = ITEMS.filter(have).length;

  return (
    <div className="stack">
      <section className="card collection-head">
        <div className="big-num">
          {total}/{ITEMS.length}
        </div>
        <div className="muted small">eşya topladın · ⭐ {stats.stars} yıldız</div>
        <div className="pbar" aria-hidden>
          <span style={{ width: `${(total / ITEMS.length) * 100}%` }} />
        </div>
      </section>

      {CATEGORIES.map((c) => {
        const items = ITEMS.filter((i) => c.cats.includes(i.category));
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
        <div className="card-head">
          <h2>🗺️ Ormanının bölgeleri</h2>
          <button className="link small" onClick={goWorld}>
            Dünyamda gez →
          </button>
        </div>
        {months.length === 0 ? (
          <p className="muted small">Sayaçla çalıştığın her seans ormanına bir ağaç diker; her ay yeni bir bölge açılır.</p>
        ) : (
          <ul className="list region-list">
            {months.map(([m, e]) => (
              <li key={m} className="row">
                <span className="grow">
                  <strong>{formatMonth(m)}</strong>
                  <span className="region-icons" aria-hidden>
                    {e.icons.slice(0, 18).join('')}
                    {e.icons.length > 18 ? '…' : ''}
                  </span>
                </span>
                <span className="muted small nowrap">
                  {e.trees} ağaç{e.dry ? ` · ${e.dry} kuru` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <ItemSheet item={open} can3D={can3D} onClose={() => setOpen(null)} onBuy={() => buy(open.id)} onEquip={(e) => equip(e)} />}
    </div>
  );
}
