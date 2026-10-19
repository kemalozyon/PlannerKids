// Dükkân (Dünyam'ın alttaki panelinde, WorldDock): eşyalar 💎 Elmasla alınır (yalnızca çalışarak kazanılır, tek
// para). Efsanevi eşyalar yalnızca başarıyla, sandıktan ya da nadir ağaç gününden gelir.
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import ItemCard, { priceText } from '../components/ItemCard';
import Sheet from '../components/Sheet';
import { behaviorText, CATEGORIES, companionSlots, groupOf, groupTitle, isNewItem, ITEMS, placeable, RARITY, SUBS, type Category, type Item } from '../lib/catalog';
import { toLocalDate } from '../lib/date';
import { lookParts, SLOT_KEY, wear } from '../lib/avatar';
import { buyCheck, owns, unlockHint, unlockValue } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { useSession } from '../lib/SessionContext';
import { sfx } from '../lib/sfx';
import type { Equipped } from '../lib/types';
import { hasWebGL } from '../lib/webgl';

const ItemPreview = lazy(() => import('../components/forest3d/ItemPreview'));

/** Bu cihazda bakılmış yeni eşyalar (YENİ rozeti kalkar) */
const SEEN_KEY = 'ct-seen-v1';
const loadSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};

type Filter = 'hepsi' | 'alabilir' | 'sende' | 'yeni';
const FILTERS: [Filter, string][] = [
  ['hepsi', 'Hepsi'],
  ['alabilir', '💎 Alabildiklerim'],
  ['sende', '✓ Sende'],
  ['yeni', '✨ Yeni'],
];
type Sort = 'sira' | 'ucuz' | 'pahali';
const SORTS: [Sort, string][] = [
  ['sira', 'Gruplara göre'],
  ['ucuz', 'Ucuzdan pahalıya'],
  ['pahali', 'Pahalıdan ucuza'],
];
const priceOf = (i: Item) => (i.acquire.kind === 'buy' ? i.acquire.price : i.acquire.kind === 'free' ? 0 : Infinity);

const WHAT: Record<Category, string> = {
  mobilya: 'Odana yerleştirirsin: Dünyam → 🎒 Envanter. Küçük eşyalar masa ve sehpaların üstüne de konur.',
  isik: 'Akşamları etrafını aydınlatır.',
  bitki: 'Odana ya da terasına koyabilirsin.',
  hali: 'Yere serilir; üstüne mobilya koyabilirsin.',
  duvarsus: 'Odanın duvarına asarsın: Dünyam → 🎒 Envanter, sonra duvara dokun.',
  zemin: 'Odanın zemini olur: Dünyam → 🎒 Envanter.',
  duvar: 'Odanın duvarlarını kaplar: Dünyam → 🎒 Envanter.',
  dis: 'Terasına yerleştirirsin: Dünyam → teras odası → 🎒 Envanter (terasın yoksa 🎨 Oda → ➕ Oda ekle → Teras).',
  kiyafet: 'Karakterin giyer: Profil → Karakterim.',
  evcil: 'Satın alınamaz: Bahçem’de ağaçlar çoğaldıkça kendiliğinden gelir. Gelince yanına alabilirsin.',
  tohum: 'Bugünün ağacını sen seçersin: Bugün → 🌱 Tohum seç. Mevsimi olan tohumlar yalnızca mevsiminde ekilir.',
  diger: 'Hafta içi bir gün çalışamazsan serin bir kademe düşmez (en çok 7 gün öncesini kapatır).',
};

/**
 * Dükkân paneli (Habbo kataloğu gibi, Dünyam'ın alttaki panelinde): üstte seçili eşyanın önizlemesi ve satın alma,
 * altta kategori sekmeleri ve eşyaların kendi resimleriyle ızgara. "Hemen yerleştir" eşyayı odada ele verir.
 */
export default function ShopPanel({ goCollection, onPlace }: { goCollection: () => void; onPlace: (id: string) => void }) {
  const { stats, buy, equip, celebrate } = useGame();
  const ses = useSession();
  const [tab, setTab] = useState('mobilya');
  const [open, setOpen] = useState<Item | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('hepsi');
  const [sort, setSort] = useState<Sort>('sira');
  const [seen, setSeen] = useState(loadSeen);
  const today = toLocalDate();
  const fresh = (i: Item) => isNewItem(i, today) && !seen.has(i.id);
  const pick = (i: Item) => {
    setOpen(i);
    if (fresh(i)) {
      const next = new Set(seen).add(i.id);
      setSeen(next);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
      } catch {
        /* depolama kapalı */
      }
    }
  };
  const can3D = useMemo(hasWebGL, []);

  const cats = CATEGORIES.find((c) => c.id === tab)?.cats ?? [];
  // Arama bütün kataloğu tarar; yoksa seçili tür
  const needle = q.trim().toLocaleLowerCase('tr');
  const base = needle
    ? ITEMS.filter((i) => i.name.toLocaleLowerCase('tr').includes(needle) || (i.sub && SUBS[i.sub]?.toLocaleLowerCase('tr').includes(needle)))
    : ITEMS.filter((i) => cats.includes(i.category));
  const mineOf = (i: Item) => !!stats && owns(i, stats.owned, stats.unlock);
  const list = base
    .filter((i) => {
      if (filter === 'yeni') return fresh(i);
      if (filter === 'sende') return mineOf(i);
      if (filter === 'alabilir') return !!stats && i.acquire.kind === 'buy' && (!mineOf(i) || !!i.repeat) && !buyCheck(i.id, stats.crystals, stats.owned, stats.freezesLeft);
      return true;
    })
    .sort((a, b) => (sort === 'ucuz' ? priceOf(a) - priceOf(b) : sort === 'pahali' ? priceOf(b) - priceOf(a) : 0));
  // Alt kategorilere göre (mobilya: oturma, masa…; kıyafet: saç, üst…); sıralama ya da arama varken tek liste
  const groups: [string, Item[]][] =
    sort === 'sira' && !needle ? [...list.reduce((m, i) => m.set(groupOf(i), [...(m.get(groupOf(i)) ?? []), i]), new Map<string, Item[]>())] : [['', list]];
  const sel = open ?? list[0] ?? null;
  const newCount = ITEMS.filter(fresh).length;
  const jump = (g: string) => document.getElementById(`shop-g-${g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let body: ReactNode;
  if (!stats) body = <div className="splash">Yükleniyor…</div>;
  else if (ses.running)
    body = (
      <div className="shop-locked">
        <p>
          ⏱ Sayacın çalışıyor. Dükkân, çalışman bitince ya da ara verince açılır.
        </p>
        <button className="btn" onClick={() => ses.pause('game').catch(() => {})}>
          ☕ Ara ver ve gir
        </button>
      </div>
    );
  else {
    const count = (id: string) => stats.owned.filter((o) => o.item_id === id).length;
    const have = (i: Item) => owns(i, stats.owned, stats.unlock);
    body = (
      <>
        {sel && (
          <ItemDetail
            key={sel.id}
            item={sel}
            can3D={can3D}
            compact
            onBuy={async () => {
              await buy(sel.id);
              sfx.star();
              celebrate({ kind: 'badge', icon: sel.icon, title: `${sel.name} senin!`, detail: WHAT[sel.category] });
            }}
            onEquip={(e) => equip(e)}
            onPlace={placeable(sel) ? () => onPlace(sel.id) : undefined}
          />
        )}
        <div className="shop-tools">
          <input className="shop-search" type="search" placeholder="🔎 Bütün dükkânda ara…" aria-label="Dükkânda ara" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="shop-sort" aria-label="Sırala" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="shop-filters" role="group" aria-label="Süz">
          {FILTERS.filter(([f]) => f !== 'yeni' || newCount > 0).map(([f, l]) => (
            <button key={f} className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {l}
              {f === 'yeni' && <span className="shop-new-n">{newCount}</span>}
            </button>
          ))}
        </div>
        {!needle && (
          <div className="tabs shop-tabs" role="tablist" aria-label="Eşya türü" data-tour="shop">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={tab === c.id}
                className={tab === c.id ? 'on' : ''}
                onClick={() => {
                  setTab(c.id);
                  setOpen(null);
                }}
              >
                <span aria-hidden>{c.icon}</span> {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="shop-scroll">
          {groups.length > 2 && (
            <div className="shop-jump" role="navigation" aria-label="Gruplara atla">
              {groups.map(([g]) => (
                <button key={g} className="chip" onClick={() => jump(g)}>
                  {groupTitle(g)}
                </button>
              ))}
            </div>
          )}
          {list.length === 0 && <p className="muted center">{needle ? `"${q}" için eşya bulunamadı.` : 'Bu süzgeçte eşya yok.'}</p>}
          {groups.map(([g, items]) => (
            <section key={g || 'hepsi'} id={g ? `shop-g-${g}` : undefined} className="shop-group">
              {groups.length > 1 && <h3 className="shop-sub">{groupTitle(g)}</h3>}
              <div className="item-grid">
                {items.map((i) => {
                  const mine = have(i);
                  const a = i.acquire;
                  const foot = mine && !i.repeat ? (isEquipped(stats.equipped, i) ? '✓ Kullanıyorsun' : '✓ Sende') : a.kind === 'unlock' ? unlockShort(i, stats.unlock) : priceText(i);
                  return (
                    <ItemCard
                      key={i.id}
                      item={i}
                      have={mine}
                      count={i.repeat ? count(i.id) : 0}
                      footer={foot}
                      selected={sel?.id === i.id}
                      badge={fresh(i) ? 'YENİ' : undefined}
                      onClick={() => pick(i)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="shop-window shop-panel" role="region" aria-label="Dükkân">
      <div className="shop-titlebar">
        <strong className="grow">🛍️ Dükkân</strong>
        {stats && <span className="wallet-gem small-gem">💎 {stats.crystals}</span>}
        <button className="link small" onClick={goCollection}>
          📒 Koleksiyon
        </button>
      </div>
      {body}
    </div>
  );
}

const isEquipped = (e: Equipped, i: Item) => lookParts(e.look).includes(i.id) || e.pets.includes(i.id);

function unlockShort(i: Item, p: Parameters<typeof unlockValue>[1]): string {
  const a = i.acquire;
  if (a.kind !== 'unlock') return '';
  return `🔒 ${Math.floor(Math.min(unlockValue(a.by, p), a.target))}/${a.target}`;
}

/** Eşya ayrıntısı alttan açılan panelde (koleksiyon defteri) */
export function ItemSheet({
  item,
  can3D,
  onClose,
  onBuy,
  onEquip,
}: {
  item: Item;
  can3D: boolean;
  onClose: () => void;
  onBuy?: () => Promise<void>;
  onEquip: (e: Equipped) => Promise<void>;
}) {
  return (
    <Sheet title={item.name} onClose={onClose}>
      <ItemDetail item={item} can3D={can3D} onBuy={onBuy} onEquip={onEquip} />
    </Sheet>
  );
}

/** Eşya ayrıntısı: önizleme, nasıl alınır, satın al / giy / yanına al / hemen yerleştir */
function ItemDetail({
  item,
  can3D,
  compact,
  onBuy,
  onEquip,
  onPlace,
}: {
  item: Item;
  can3D: boolean;
  /** Dükkân penceresinin üst paneli: önizleme solda, bilgiler sağda */
  compact?: boolean;
  onBuy?: () => Promise<void>;
  onEquip: (e: Equipped) => Promise<void>;
  onPlace?: () => void;
}) {
  const { stats } = useGame();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!stats) return null;
  const mine = owns(item, stats.owned, stats.unlock);
  const a = item.acquire;
  const reason = a.kind === 'buy' ? buyCheck(item.id, stats.crystals, stats.owned, stats.freezesLeft) : null;
  const e = stats.equipped;
  const slots = companionSlots(stats.level.index);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let use: { label: string; next: Equipped } | null = null;
  if (mine && item.category === 'kiyafet' && item.slot) {
    const s = SLOT_KEY[item.slot];
    const wearing = e.look[s.key] === item.id;
    if (!wearing) use = { label: '👕 Giy', next: { ...e, look: wear(e.look, item) } };
    else if (s.optional) use = { label: 'Çıkar', next: { ...e, look: { ...e.look, [s.key]: null } } };
  }
  if (mine && item.category === 'evcil')
    use = e.pets.includes(item.id)
      ? { label: 'Adada bırak', next: { ...e, pets: e.pets.filter((p) => p !== item.id) } }
      : { label: '🐾 Yanına al', next: { ...e, pets: [...e.pets, item.id].slice(-slots) } };

  const preview = can3D ? (
        <Suspense fallback={<div className="item-preview emoji">{item.icon}</div>}>
          <ItemPreview item={item} look={item.category === 'kiyafet' ? wear(e.look, item) : undefined} />
        </Suspense>
      ) : (
        <div className="item-preview emoji">{item.icon}</div>
      );
  return (
    <div className={compact ? 'shop-detail' : undefined}>
      {preview}
      <div className="shop-info">
      {compact && <h3 className="shop-name">{item.name}</h3>}
      <p className="center">
        <span className="rarity-tag" style={{ ['--rarity' as string]: RARITY[item.rarity].color }}>
          {RARITY[item.rarity].name}
        </span>
      </p>
      <p className="muted center">{WHAT[item.category]}</p>
      {item.behaviors.length > 0 && <p className="small center">{behaviorText(item)}</p>}
      {item.id === 'freeze' && <p className="small center">Bekleyen dondurman: {stats.freezesLeft}</p>}
      {item.category === 'evcil' && mine && !e.pets.includes(item.id) && e.pets.length >= slots && (
        <p className="small center muted">
          {slots === 1 ? 'Yanına bir hayvan alabilirsin; bu gelince diğeri adada kalır.' : 'Yanına iki hayvan alabilirsin; en eskisi adada kalır.'}
        </p>
      )}

      {a.kind === 'buy' && (!mine || item.repeat) && (
        <>
          <button className="btn primary full big" disabled={!!reason || busy} onClick={() => run(async () => onBuy?.())}>
            💎 {a.price} ile al
          </button>
          {reason && <p className="small center muted">{reason}</p>}
        </>
      )}
      {a.kind !== 'buy' && !mine && <p className="center">{unlockHint(item)}</p>}
      {use && (
        <button className="btn full big" disabled={busy} onClick={() => run(() => onEquip(use.next))}>
          {use.label}
        </button>
      )}
      {mine && placeable(item) && item.acquire.kind !== 'free' && <p className="small center muted">Sende {stats.owned.filter((o) => o.item_id === item.id).length || 1} tane var.</p>}
      {mine && onPlace && (
        <button className="btn full" onClick={onPlace}>
          🏠 Hemen yerleştir
        </button>
      )}
      {item.desc && <p className="small center">{item.desc}</p>}
      {error && <p className="error-ink small center">{error}</p>}
      </div>
    </div>
  );
}
