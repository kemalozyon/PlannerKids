// Envanter çekmecesi (dünya görünümü ve gezinti): bulunduğun alanın zemin/duvar kaplaması (içeride), tür sekmeleri ve
// boşta duran eşyalar. Bir eşyaya dokununca ele alınır (sayfa yerleştirir); kaplama hemen kaydedilir.
import { useState, type ReactNode } from 'react';
import { CATEGORIES, groupOf, ITEMS, SUBS, type Item } from '../lib/catalog';
import { defaultCover, isIndoor, type SpaceId, type SpaceLayout, type WorldCtx } from '../lib/world';
import { ItemIcon } from './ItemCard';

export type InvEntry = { it: Item; n: number };

export default function InventoryDrawer({
  space,
  layout,
  ctx,
  items,
  owned,
  held,
  tools,
  onHold,
  onCover,
  onClose,
  onShop,
}: {
  space: SpaceId;
  layout: SpaceLayout | undefined;
  ctx: WorldCtx;
  /** Bu alana konabilecek, boşta duran eşyalar ve adetleri */
  items: InvEntry[];
  /** Sahip olunan adet (kaplamalar için) */
  owned: (it: Item) => number;
  held?: string | null;
  /** Üst şerit (başlık, elde tutulan eşyanın düğmeleri) */
  tools: ReactNode;
  onHold: (it: Item) => void;
  onCover: (slot: 'floor' | 'wall', id: string) => void;
  onClose: () => void;
  onShop: () => void;
}) {
  const [tab, setTab] = useState('hepsi');
  const tabs = CATEGORIES.filter((c) => items.some((x) => c.cats.includes(x.it.category)));
  const cur = tabs.some((c) => c.id === tab) ? tab : 'hepsi';
  const shown = cur === 'hepsi' ? items : items.filter((x) => CATEGORIES.find((c) => c.id === cur)?.cats.includes(x.it.category));
  const coverings = (cat: 'zemin' | 'duvar') => ITEMS.filter((it) => it.category === cat && owned(it) > 0);
  return (
    <div className="edit-drawer" role="region" aria-label="Envanter">
      <div className="edit-tools">
        {tools}
        <button className="btn sm ghost" onClick={onClose} aria-label="Envanteri kapat">
          ✕
        </button>
      </div>
      {isIndoor(space) && layout && (
        <div className="cover-row">
          {(['zemin', 'duvar'] as const).map((cat) => (
            <span key={cat} className="cover-group">
              <span className="muted small">{cat === 'zemin' ? 'Zemin' : 'Duvar'}</span>
              {coverings(cat).map((it) => {
                const slot = cat === 'zemin' ? 'floor' : 'wall';
                const on = (layout[slot] ?? defaultCover(space, slot, ctx)) === it.id;
                return (
                  <button
                    key={it.id}
                    className={`swatch${on ? ' on' : ''}${it.pattern ? ' pat' : ''}`}
                    title={it.name}
                    aria-label={it.name}
                    aria-pressed={on}
                    style={{ background: it.color2 ? `linear-gradient(135deg, ${it.color} 50%, ${it.color2} 50%)` : it.color }}
                    onClick={() => onCover(slot, it.id)}
                  />
                );
              })}
            </span>
          ))}
        </div>
      )}
      {tabs.length > 1 && (
        <div className="inv-tabs" role="tablist" aria-label="Envanter türleri">
          {[{ id: 'hepsi', name: 'Hepsi', icon: '✨' }, ...tabs].map((c) => (
            <button key={c.id} role="tab" aria-selected={cur === c.id} className={cur === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="inventory">
        {items.length === 0 ? (
          <p className="muted small">
            Burada koyabileceğin eşya yok.{' '}
            <button className="link" onClick={onShop}>
              Dükkândan
            </button>{' '}
            alabilirsin.
          </p>
        ) : (
          [...shown]
            .sort((a, b) => groupOf(a.it).localeCompare(groupOf(b.it)))
            .map(({ it, n }) => (
              <button key={it.id} className={`inv-item${held === it.id ? ' on' : ''}`} title={it.sub ? SUBS[it.sub] : undefined} onClick={() => onHold(it)}>
                <span aria-hidden>
                  <ItemIcon item={it} />
                </span>
                <span className="inv-name">{it.name}</span>
                {n > 1 && n < 1000 && <span className="inv-n">×{n}</span>}
              </button>
            ))
        )}
      </div>
    </div>
  );
}
