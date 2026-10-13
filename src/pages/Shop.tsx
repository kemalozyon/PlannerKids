// Dükkân: eşyalar 💎 Elmasla alınır (yalnızca çalışarak kazanılır, tek para).
// Efsanevi eşyalar yalnızca başarıyla ya da sandıktan gelir.
import { lazy, Suspense, useMemo, useState } from 'react';
import ItemCard, { priceText } from '../components/ItemCard';
import Sheet from '../components/Sheet';
import { CATEGORIES, companionSlots, groupOf, groupTitle, ITEMS, placeable, RARITY, type Category, type Item } from '../lib/catalog';
import { lookParts, SLOT_KEY, wear } from '../lib/avatar';
import { buyCheck, owns, unlockHint, unlockValue } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import type { Equipped } from '../lib/types';
import { hasWebGL } from '../lib/webgl';

const ItemPreview = lazy(() => import('../components/forest3d/ItemPreview'));

const WHAT: Record<Category, string> = {
  mobilya: 'Odana yerleştirirsin: Dünyam → ✏️ Düzenle. Küçük eşyalar masa ve sehpaların üstüne de konur.',
  isik: 'Akşamları etrafını aydınlatır.',
  bitki: 'Odana ya da bahçene koyabilirsin.',
  hali: 'Yere serilir; üstüne mobilya koyabilirsin.',
  duvarsus: 'Odanın duvarına asarsın: Dünyam → ✏️ Düzenle, sonra duvara dokun.',
  zemin: 'Odanın zemini olur: Dünyam → ✏️ Düzenle.',
  duvar: 'Odanın duvarlarını kaplar: Dünyam → ✏️ Düzenle.',
  dis: 'Bahçene ya da ağaç bahçelerine yerleştirirsin: Dünyam → ✏️ Düzenle.',
  kiyafet: 'Karakterin giyer: Profil → Karakterim.',
  evcil: 'Satın alınamaz: bahçelerinde ağaçlar çoğaldıkça kendiliğinden gelir. Gelince yanına alabilirsin.',
  diger: 'Hafta içi bir gün çalışamazsan serin bir kademe düşmez (en çok 7 gün öncesini kapatır).',
};

export default function Shop({ goCollection }: { goCollection: () => void }) {
  const { stats, buy, equip, celebrate } = useGame();
  const [tab, setTab] = useState('mobilya');
  const [open, setOpen] = useState<Item | null>(null);
  const can3D = useMemo(hasWebGL, []);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const count = (id: string) => stats.owned.filter((o) => o.item_id === id).length;
  const have = (i: Item) => owns(i, stats.owned, stats.unlock);
  const cats = CATEGORIES.find((c) => c.id === tab)?.cats ?? [];
  const list = ITEMS.filter((i) => cats.includes(i.category));
  // Alt kategorilere göre (mobilya: oturma, masa…; kıyafet: saç, üst…)
  const groups = [...list.reduce((m, i) => m.set(groupOf(i), [...(m.get(groupOf(i)) ?? []), i]), new Map<string, Item[]>())];

  return (
    <div className="stack">
      <section className="card wallet-card">
        <div className="wallet">
          <span className="wallet-gem">💎 {stats.crystals}</span>
          <span className="muted small">Elmas · yalnızca çalışarak kazanılır</span>
        </div>
        <button className="link small" onClick={goCollection}>
          📒 Koleksiyon defterim
        </button>
      </section>

      <div className="tabs shop-tabs" role="tablist" aria-label="Eşya türü" data-tour="shop">
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
            <span aria-hidden>{c.icon}</span> {c.name}
          </button>
        ))}
      </div>

      {groups.map(([g, items]) => (
        <section key={g} className="shop-group">
          {groups.length > 1 && <h3 className="shop-sub">{groupTitle(g)}</h3>}
          <div className="item-grid">
            {items.map((i) => {
              const mine = have(i);
              const a = i.acquire;
              const foot = mine && !i.repeat ? (isEquipped(stats.equipped, i) ? '✓ Kullanıyorsun' : '✓ Sende') : a.kind === 'unlock' ? unlockShort(i, stats.unlock) : priceText(i);
              return <ItemCard key={i.id} item={i} have={mine} count={i.repeat ? count(i.id) : 0} footer={foot} onClick={() => setOpen(i)} />;
            })}
          </div>
        </section>
      ))}

      {open && (
        <ItemSheet
          item={open}
          can3D={can3D}
          onClose={() => setOpen(null)}
          onBuy={async () => {
            await buy(open.id);
            celebrate({ kind: 'badge', icon: open.icon, title: `${open.name} senin!`, detail: WHAT[open.category] });
          }}
          onEquip={(e) => equip(e)}
        />
      )}
    </div>
  );
}

const isEquipped = (e: Equipped, i: Item) => lookParts(e.look).includes(i.id) || e.pets.includes(i.id);

function unlockShort(i: Item, p: Parameters<typeof unlockValue>[1]): string {
  const a = i.acquire;
  if (a.kind !== 'unlock') return '';
  return `🔒 ${Math.floor(Math.min(unlockValue(a.by, p), a.target))}/${a.target}`;
}

/** Eşya ayrıntısı: önizleme, nasıl alınır, satın al / giy / yanına al */
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

  return (
    <Sheet title={item.name} onClose={onClose}>
      {can3D ? (
        <Suspense fallback={<div className="item-preview emoji">{item.icon}</div>}>
          <ItemPreview item={item} look={item.category === 'kiyafet' ? wear(e.look, item) : undefined} />
        </Suspense>
      ) : (
        <div className="item-preview emoji">{item.icon}</div>
      )}
      <p className="center">
        <span className="rarity-tag" style={{ ['--rarity' as string]: RARITY[item.rarity].color }}>
          {RARITY[item.rarity].name}
        </span>
      </p>
      <p className="muted center">{WHAT[item.category]}</p>
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
      {item.desc && <p className="small center">{item.desc}</p>}
      {error && <p className="error-ink small center">{error}</p>}
    </Sheet>
  );
}
