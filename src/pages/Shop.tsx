// Dükkân: eşyalar 💎 Elmasla alınır (yalnızca çalışarak kazanılır, tek para).
// Efsanevi eşyalar yalnızca başarıyla ya da sandıktan gelir.
import { lazy, Suspense, useMemo, useState } from 'react';
import ItemCard, { priceText } from '../components/ItemCard';
import Sheet from '../components/Sheet';
import { CATEGORIES, companionSlots, ITEMS, placeable, RARITY, type Category, type Item } from '../lib/catalog';
import { buyCheck, owns, unlockHint, unlockValue } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import type { Equipped } from '../lib/types';
import { hasWebGL } from '../lib/webgl';

const ItemPreview = lazy(() => import('../components/forest3d/ItemPreview'));

const WHAT: Record<Category, string> = {
  karakter: 'Ormanda gezerken bu karakterle yürürsün.',
  aksesuar: 'Karakterinin başına takılır.',
  evcil: 'Gezintide peşinden gelir, adanda dolaşır.',
  yapi: 'Gezintide 🔨 ile adana yerleştirirsin.',
  sus: 'Gezintide 🔨 ile adana yerleştirirsin.',
  diger: 'Bir gün çalışamazsan serin bozulmaz (en çok 7 gün öncesini kapatır).',
};

export default function Shop({ goCollection }: { goCollection: () => void }) {
  const { stats, buy, equip, celebrate } = useGame();
  const [cat, setCat] = useState<Category>('evcil');
  const [open, setOpen] = useState<Item | null>(null);
  const can3D = useMemo(hasWebGL, []);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const count = (id: string) => stats.owned.filter((o) => o.item_id === id).length;
  const have = (i: Item) => owns(i, stats.owned, stats.unlock);
  const list = ITEMS.filter((i) => i.category === cat).sort((a, b) => Number(have(b) && !b.repeat) - Number(have(a) && !a.repeat) || 0);

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

      <div className="tabs shop-tabs" role="tablist" aria-label="Eşya türü">
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
            <span aria-hidden>{c.icon}</span> {c.name}
          </button>
        ))}
      </div>

      <div className="item-grid">
        {list.map((i) => {
          const mine = have(i);
          const a = i.acquire;
          const foot = mine && !i.repeat ? (isEquipped(stats.equipped, i) ? '✓ Kullanıyorsun' : '✓ Sende') : a.kind === 'unlock' ? unlockShort(i, stats.unlock) : priceText(i);
          return <ItemCard key={i.id} item={i} have={mine} count={i.repeat ? count(i.id) : 0} footer={foot} onClick={() => setOpen(i)} />;
        })}
      </div>

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

const isEquipped = (e: Equipped, i: Item) => e.character === i.id || e.accessory === i.id || e.pets.includes(i.id);

function unlockShort(i: Item, p: Parameters<typeof unlockValue>[1]): string {
  const a = i.acquire;
  if (a.kind !== 'unlock') return '';
  return `🔒 ${Math.min(unlockValue(a.by, p), a.target)}/${a.target}`;
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
  if (mine && item.category === 'karakter' && e.character !== item.id) use = { label: '👕 Bu karakterle gez', next: { ...e, character: item.id } };
  if (mine && item.category === 'aksesuar')
    use = e.accessory === item.id ? { label: 'Çıkar', next: { ...e, accessory: null } } : { label: '✨ Tak', next: { ...e, accessory: item.id } };
  if (mine && item.category === 'evcil')
    use = e.pets.includes(item.id)
      ? { label: 'Adada bırak', next: { ...e, pets: e.pets.filter((p) => p !== item.id) } }
      : { label: '🐾 Yanına al', next: { ...e, pets: [...e.pets, item.id].slice(-slots) } };

  return (
    <Sheet title={item.name} onClose={onClose}>
      {can3D ? (
        <Suspense fallback={<div className="item-preview emoji">{item.icon}</div>}>
          <ItemPreview item={item} />
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
      {mine && placeable(item) && <p className="small center muted">Sende {stats.owned.filter((o) => o.item_id === item.id).length} tane var.</p>}
      {error && <p className="error-ink small center">{error}</p>}
    </Sheet>
  );
}
