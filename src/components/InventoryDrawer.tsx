// Envanter (Dünyam'ın alttaki panelinde ve gezintide çekmece): arama, tür sekmeleri, alt gruplar ve boşta duran
// eşyalar (yalnızca bu odaya konabilenler). Bir eşyaya dokununca ele alınır (sayfa yerleştirir). Zemin/duvar
// kaplaması (CoverRow) gezintide burada, Dünyam'da panelin 🎨 Oda sekmesinde; seçilince hemen kaydedilir.
import { useState, type ReactNode } from 'react';
import { CATEGORIES, groupOf, groupTitle, ITEMS, SUBS, type Item } from '../lib/catalog';
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
  className,
  covers = true,
}: {
  className?: string;
  /** Zemin/duvar seçimi de görünsün (gezinti) */
  covers?: boolean;
  space: SpaceId;
  layout: SpaceLayout | undefined;
  ctx: WorldCtx;
  /** Bu alana konabilecek, boşta duran eşyalar ve adetleri */
  items: InvEntry[];
  /** Sahip olunan adet (kaplamalar için) */
  owned: (it: Item) => number;
  held?: string | null;
  /** Üst şerit (başlık, elde tutulan eşyanın düğmeleri) */
  tools?: ReactNode;
  onHold: (it: Item) => void;
  onCover: (slot: 'floor' | 'wall', id: string) => void;
  onClose?: () => void;
  onShop: () => void;
}) {
  const [tab, setTab] = useState('hepsi');
  const [group, setGroup] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const tabs = CATEGORIES.filter((c) => items.some((x) => c.cats.includes(x.it.category)));
  const cur = tabs.some((c) => c.id === tab) ? tab : 'hepsi';
  const inTab = cur === 'hepsi' ? items : items.filter((x) => CATEGORIES.find((c) => c.id === cur)?.cats.includes(x.it.category));
  // Alt gruplar (yalnızca bir tür seçiliyken ve birden çok grup varsa)
  const groups = cur === 'hepsi' ? [] : [...new Set(inTab.map((x) => groupOf(x.it)))];
  const curGroup = group && groups.includes(group) ? group : null;
  const needle = q.trim().toLocaleLowerCase('tr');
  const shown = inTab.filter((x) => (!curGroup || groupOf(x.it) === curGroup) && (!needle || x.it.name.toLocaleLowerCase('tr').includes(needle)));
  return (
    <div className={`edit-drawer${className ? ` ${className}` : ''}`} role="region" aria-label="Envanter">
      {(tools || onClose) && (
        <div className="edit-tools">
          {tools}
          {onClose && (
            <button className="btn sm ghost" onClick={onClose} aria-label="Envanteri kapat">
              ✕
            </button>
          )}
        </div>
      )}
      {covers && <CoverRow space={space} layout={layout} ctx={ctx} owned={owned} onCover={onCover} />}
      {items.length > 8 && (
        <input className="inv-search" type="search" placeholder="🔎 Eşya ara…" aria-label="Envanterde ara" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {tabs.length > 1 && (
        <div className="inv-tabs" role="tablist" aria-label="Envanter türleri">
          {[{ id: 'hepsi', name: 'Hepsi', icon: '✨' }, ...tabs].map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={cur === c.id}
              className={cur === c.id ? 'on' : ''}
              onClick={() => {
                setTab(c.id);
                setGroup(null);
              }}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      )}
      {groups.length > 1 && (
        <div className="inv-tabs sub" role="group" aria-label="Alt gruplar">
          {groups.map((g) => (
            <button key={g} aria-pressed={curGroup === g} className={curGroup === g ? 'on' : ''} onClick={() => setGroup(curGroup === g ? null : g)}>
              {groupTitle(g)}
            </button>
          ))}
        </div>
      )}
      <div className="inventory">
        {items.length > 0 && shown.length === 0 && <p className="muted small">"{q}" bulunamadı.</p>}
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

/** Odanın zemin ve duvar kaplaması (sahip olunanlar; terasta yok): adlı renk örnekleri */
export function CoverRow({
  space,
  layout,
  ctx,
  owned,
  onCover,
}: {
  space: SpaceId;
  layout: SpaceLayout | undefined;
  ctx: WorldCtx;
  owned: (it: Item) => number;
  onCover: (slot: 'floor' | 'wall', id: string) => void;
}) {
  if (!isIndoor(space, ctx) || !layout) return null;
  const coverings = (cat: 'zemin' | 'duvar') => ITEMS.filter((it) => it.category === cat && owned(it) > 0);
  return (
    <div className="cover-row">
      {(['zemin', 'duvar'] as const).map((cat) => (
        <span key={cat} className="cover-group">
          <span className="muted small">{cat === 'zemin' ? 'Zemin' : 'Duvar'}</span>
          {coverings(cat).map((it) => {
            const slot = cat === 'zemin' ? 'floor' : 'wall';
            const on = (layout[slot] ?? defaultCover(space, slot, ctx)) === it.id;
            return (
              <button key={it.id} className={`cover-pick${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onCover(slot, it.id)}>
                <span
                  className={`swatch${on ? ' on' : ''}${it.pattern ? ' pat' : ''}`}
                  aria-hidden
                  style={{ background: it.color2 ? `linear-gradient(135deg, ${it.color} 50%, ${it.color2} 50%)` : it.color }}
                />
                <span className="cover-name">{it.name}</span>
              </button>
            );
          })}
        </span>
      ))}
    </div>
  );
}
