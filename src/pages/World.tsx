// Dünyam: tek bağlı dünya (worldPlan.ts). Ev (kütüphane | oda), önündeki bahçe, orman yolu ve aylık ağaç
// bahçeleri yan yana; karakter kapılardan yürüyerek geçer, eve girince çatı kalkar. Çalıştıkça dünya büyür: her
// çalışılan gün bir ağaç, toplam saatle arazi yerinde genişler (eşyalar yerinde kalır). Elmasla alınan eşyalar
// Habbo gibi kare kare yerleşir; "Düzenle" karakterin bulunduğu alanı düzenler. Oynarken bir eşyaya dokununca
// kullanma çubuğu açılır: otur, yat, sallan, ışığı/TV'yi/ateşi aç-kapa, TV kanalı; taşı, döndür, kaldır (hemen
// kaydedilir). Aç/kapa durumu bu cihazda saklanır (ct-power-v1).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TvData } from '../components/world3d/art';
import ShelfView, { BookCard } from '../components/ShelfView';
import DaySheet from '../components/DaySheet';
import { CATEGORIES, groupOf, itemById, ITEMS, SUBS, type Item } from '../lib/catalog';
import { CFG } from '../lib/config';
import { dayPhase } from '../lib/dayPhase';
import { addDays, formatMinutes, toLocalDate, weekStart } from '../lib/date';
import { ownedCount } from '../lib/economy';
import { formatMonth } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import { perksOf } from '../lib/level';
import { useReading } from '../lib/ReadingContext';
import { useSession } from '../lib/SessionContext';
import { setSoundOn, sfx, soundOn } from '../lib/sfx';
import { VIEW_EVENT } from '../lib/tour';
import type { Book, Course } from '../lib/types';
import { hasWebGL } from '../lib/webgl';
import {
  canPlaceAt,
  daysIn,
  emptyLayout,
  fitsSpace,
  footprint,
  isOn,
  isMonthSpace,
  mapById,
  monthSpace,
  monthState,
  onTopOf,
  powerKey,
  sanitizeLayout,
  seasonMonths,
  wallRot,
  type DayTree,
  type PlacedItem,
  type SpaceId,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
} from '../lib/world';
import { entryOf, regionAt, regionOf, worldPlan, type RegionId, type WorldPlan } from '../lib/worldPlan';

const WorldView = lazy(() => import('../components/world3d/WorldView'));
const Explore = lazy(() => import('../components/forest3d/Explore'));

const POS_KEY = 'ct-world-pos-v1';
const POWER_KEY = 'ct-power-v1';
const GFX_KEY = 'ct-gfx-v1';
const GROWN_KEY = 'ct-grown-v2';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* yok say */
  }
};

/** Karakterin başladığı karo: kayıtlı konum (hâlâ dünyadaysa), yoksa odanın içi */
function startTile(plan: WorldPlan, shelf: boolean): Tile {
  if (shelf) return entryOf(plan, 'library')!;
  try {
    const t = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as Tile | null;
    const r = t && regionAt(plan, t);
    if (r && !r.locked) return t!;
  } catch {
    /* yok say */
  }
  return entryOf(plan, 'room')!;
}

const AREA_NAME: Record<string, string> = { room: 'Odanı', library: 'Kütüphaneni', garden: 'Bahçeni' };

export default function World({ courses, goShop }: { courses: Course[]; goShop: () => void }) {
  const { stats, saveSpace, collectStar } = useGame();
  const reading = useReading();
  const ses = useSession();
  const can3D = useMemo(hasWebGL, []);
  const today = toLocalDate();
  const months = useMemo(seasonMonths, []);
  const thisMonth = today.slice(0, 7);
  // "Kitaplığımda gör" ile gelindiyse karakter kütüphanede başlar, raflar açık
  const [shelf, setShelf] = useState(() => {
    try {
      const on = sessionStorage.getItem('ct-open-shelf') === '1';
      sessionStorage.removeItem('ct-open-shelf');
      return on;
    } catch {
      return false;
    }
  });
  const [startShelf] = useState(shelf);
  const [here, setHere] = useState<RegionId | null>(null);
  const [goal, setGoal] = useState<{ to: RegionId; n: number } | null>(null);
  const [big, setBig] = useState(false);
  const [shadows, setShadows] = useState(() => read(GFX_KEY) === 'on' || (read(GFX_KEY) == null && !matchMedia('(pointer: coarse)').matches));
  const [sound, setSound] = useState(soundOn);
  const [tree, setTree] = useState<DayTree | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  // Düzenleme (karakterin bulunduğu alan)
  const [editSpace, setEditSpace] = useState<SpaceId | null>(null);
  const [draft, setDraft] = useState<SpaceLayout | null>(null);
  const [held, setHeld] = useState<{ item: string; rot: number; from?: PlacedItem } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editMsg, setEditMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('hepsi');
  const [grown, setGrown] = useState<string[]>(() => JSON.parse(read(GROWN_KEY) ?? '[]') as string[]);
  // Oynarken: seçili eşya, otur/yat isteği, oturulan eşya, aç/kapa, TV kanalları, oyunda taşıma
  const [using, setUsing] = useState<{ space: SpaceId; index: number } | null>(null);
  const [action, setAction] = useState<{ space: SpaceId; index: number; n: number; stand?: boolean } | null>(null);
  const [posedAt, setPosedAt] = useState<{ space: SpaceId; index: number } | null>(null);
  const [power, setPower] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(read(POWER_KEY) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [channels, setChannels] = useState<Record<string, number>>({});
  const [quick, setQuick] = useState(false);
  const pos = useRef<Tile | null>(null);

  useEffect(() => {
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  // Tanıtım turu karakteri bir alana yollar
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      const to: RegionId = d === 'outdoor' || d === 'forest' || d === 'month' ? monthSpace(months.includes(thisMonth) ? thisMonth : months[0]) : d === 'library' || d === 'garden' ? d : 'room';
      setDraft(null);
      setEditSpace(null);
      setGoal((g) => ({ to, n: (g?.n ?? 0) + 1 }));
    };
    window.addEventListener(VIEW_EVENT, on);
    return () => window.removeEventListener(VIEW_EVENT, on);
  }, [months, thisMonth]);
  // Esc: elde tutulanı bırak
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setHeld((h) => (h?.from ? h : null));
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const ctx: WorldCtx = useMemo(() => ({ map: stats?.world.map ?? CFG.world.maps[0].id, today }), [stats?.world.map, today]);
  const plan = useMemo(() => worldPlan(ctx, months), [ctx, months]);
  const [start] = useState(() => startTile(plan, startShelf));
  // Sahne yüklenmeden de bulunduğun alan bilinsin (sekme, Düzenle)
  useEffect(() => setHere((h) => h ?? regionAt(plan, start)?.id ?? null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const mapDef = mapById(ctx.map);
  const doneBooks = useMemo(
    () => reading.books.filter((b) => b.status === 'done').sort((a, b) => (a.finished_on ?? '').localeCompare(b.finished_on ?? '') || a.id.localeCompare(b.id)),
    [reading.books],
  );
  const readingNow = useMemo(() => reading.books.filter((b) => b.status === 'reading'), [reading.books]);
  const owned = (it: Item) => (stats ? ownedCount(it, stats.owned, stats.unlock) : 0);
  // Bütün alanlar (kaydedilmemiş oda başlangıç eşyalarıyla); her alan kendi kuralıyla ayıklanır
  const allSpaces = useMemo<Partial<Record<string, SpaceLayout>>>(() => ({ room: emptyLayout('room'), ...stats?.spaces }), [stats?.spaces]);
  const usedIn = (l: SpaceLayout | undefined, id: string) => l?.items.filter((p) => p.item === id).length ?? 0;
  const usedElsewhere = (space: string) => (id: string) => Object.entries(allSpaces).reduce((n, [s, l]) => (s === space ? n : n + usedIn(l, id)), 0);
  const layouts = useMemo(() => {
    const out: Partial<Record<SpaceId, SpaceLayout>> = {};
    if (!stats) return out;
    for (const r of plan.regions) {
      if (r.id === 'trail' || r.locked) continue;
      out[r.id] = sanitizeLayout(r.id, stats.spaces[r.id] ?? emptyLayout(r.id), ctx, owned, usedElsewhere(r.id)).layout;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, stats, ctx, allSpaces]);
  // TV: bugünün ve haftanın çalışması, seri, toplam saat; bu ayın ormanı
  const tv = useMemo<TvData>(() => {
    const ws = weekStart(today);
    const [y, m] = thisMonth.split('-').map(Number);
    const trees = new Map((stats?.forest ?? []).filter((t) => t.month === thisMonth).map((t) => [t.date, t]));
    return {
      today: stats?.todayMinutes ?? 0,
      week: Array.from({ length: 7 }, (_, i) => stats?.dayTotals.get(addDays(ws, i)) ?? 0),
      streak: stats?.streak ?? 0,
      hours: Math.floor((stats?.trustedMinutes ?? 0) / 60),
      month: {
        label: formatMonth(thisMonth),
        lead: (new Date(y, m - 1, 1).getDay() + 6) % 7,
        days: Array.from({ length: daysIn(thisMonth) }, (_, i) => {
          const t = trees.get(`${thisMonth}-${String(i + 1).padStart(2, '0')}`);
          return t ? { color: t.species.leaf, size: t.stageIndex / 4, dry: t.dry } : null;
        }),
      },
    };
  }, [stats, today, thisMonth]);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const space: SpaceId | null = editSpace;
  const editing = draft != null && space != null;
  const fullEdit = editing && !quick;
  const layout = editing ? draft : null;
  // Bulunduğun alan düzenlenebilir mi (yolda ya da kilitli bahçede değil)
  const hereSpace = here && here !== 'trail' && !plan.regions.find((r) => r.id === here)?.locked ? (here as SpaceId) : null;
  const hereMonth = hereSpace && isMonthSpace(hereSpace) ? hereSpace.slice(2) : null;
  // Bugünün ağacı yeni dikildiyse ya da büyüdüyse bir kez büyüme animasyonu (bu ayın bahçesindeyken)
  const todayTree = stats.forest.find((t) => t.date === today && !t.dry);
  const growKey = todayTree ? `${todayTree.id}:${todayTree.stageIndex}` : null;
  const growId = !editing && hereMonth === thisMonth && growKey && !grown.includes(growKey) ? todayTree!.id : null;
  const markGrown = () => {
    if (!growKey) return;
    const next = [...grown, growKey].slice(-40);
    setGrown(next);
    write(GROWN_KEY, JSON.stringify(next));
  };
  const goTo = (to: RegionId) => {
    if (editing) return;
    setUsing(null);
    const r = plan.regions.find((x) => x.id === to);
    if (r?.locked && isMonthSpace(to)) setToast(`🔒 ${formatMonth(to.slice(2))} bahçesi 1 ${formatMonth(to.slice(2))} günü açılır.`);
    setGoal((g) => ({ to, n: (g?.n ?? 0) + 1 }));
  };

  // ---------- Envanter ----------
  const available = (it: Item, l: SpaceLayout | null = layout) => (space ? owned(it) - usedElsewhere(space)(it.id) - usedIn(l ?? undefined, it.id) : 0);
  const inventory = space
    ? ITEMS.filter((it) => !!it.placement && fitsSpace(it, space))
        .map((it) => ({ it, n: available(it) }))
        .filter((x) => x.n > 0)
    : [];
  const invTabs = CATEGORIES.filter((c) => inventory.some((x) => c.cats.includes(x.it.category)));
  const shown = tab === 'hepsi' ? inventory : inventory.filter((x) => CATEGORIES.find((c) => c.id === tab)?.cats.includes(x.it.category));
  const coverings = (cat: 'zemin' | 'duvar') => ITEMS.filter((it) => it.category === cat && owned(it) > 0);

  const startEdit = () => {
    if (!hereSpace) return;
    const s = sanitizeLayout(hereSpace, stats.spaces[hereSpace] ?? emptyLayout(hereSpace), ctx, owned, usedElsewhere(hereSpace));
    setEditSpace(hereSpace);
    setDraft(structuredClone(s.layout));
    setSelected(null);
    setHeld(null);
    setTab('hepsi');
    setEditMsg(s.dropped ? { text: `${s.dropped} eşya buraya sığmadı, envantere döndü.` } : null);
  };
  const cancelEdit = () => {
    setDraft(null);
    setEditSpace(null);
    setHeld(null);
    setSelected(null);
    setEditMsg(null);
    setQuick(false);
  };
  const save = async () => {
    if (!draft || !space) return;
    setSaving(true);
    setEditMsg(null);
    try {
      await saveSpace(space, draft);
      sfx.place();
      cancelEdit();
    } catch (e) {
      setEditMsg({ text: (e as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };
  const drop = (t: Tile) => {
    if (!held || !draft || !space) return;
    const it = itemById(held.item);
    if (!it) return;
    const rot = it.placement === 'wall' ? wallRot(t.x, t.y) : held.rot;
    const p: PlacedItem = { item: held.item, x: t.x, y: t.y, rot };
    if (quick) return quickDrop(p);
    if (canPlaceAt(space, draft, ctx, p)) {
      const next = { ...draft, items: [...draft.items, p] };
      setDraft(next);
      sfx.place();
      // Habbo gibi: aynı eşyadan daha varsa elde kalır (çit, yol döşemek kolay)
      if (!held.from && available(it, next) > 0 && it.repeat) {
        setEditMsg({ text: `${it.name} kondu · bir tane daha koymak için başka karoya dokun` });
        return;
      }
      setSelected(next.items.length - 1);
      setHeld(null);
      setEditMsg(null);
    } else if (held.from) {
      // Geçersiz yere bırakılan eşya eski yerine döner
      setDraft({ ...draft, items: [...draft.items, held.from] });
      setSelected(draft.items.length);
      setHeld(null);
      setEditMsg({ text: 'Buraya konamaz, eski yerine döndü.', error: true });
    } else setEditMsg({ text: it.placement === 'wall' ? 'Buraya asılamaz: duvarın bu kısmı dolu ya da pencere/kapı var.' : 'Buraya konamaz: karo dolu ya da alanın dışında.', error: true });
  };
  /** Eşyayı yerinden kaldır (taşımak için); üstündeki küçük eşyalar envantere döner */
  const pick = (i: number) => {
    if (!draft) return;
    const p = draft.items[i];
    const tops = onTopOf(draft, i);
    setDraft({ ...draft, items: draft.items.filter((_, k) => k !== i && !tops.includes(k)) });
    setHeld({ item: p.item, rot: p.rot, from: p });
    setSelected(null);
    setEditMsg(tops.length ? { text: `Üstündeki ${tops.length} eşya envantere döndü.` } : null);
  };
  /** Envanterden bir eşyayı eline al */
  const hold = (it: Item) => {
    setHeld({ item: it.id, rot: it.rotations?.[0] ?? 0 });
    setSelected(null);
    setEditMsg({ text: it.placement === 'wall' ? 'Asmak istediğin duvara dokun' : 'Koymak istediğin karoya dokun' });
  };
  const rotations = (id: string) => itemById(id)?.rotations ?? [0];
  const nextRot = (id: string, rot: number) => {
    const r = rotations(id);
    return r[(r.indexOf(rot) + 1) % r.length];
  };
  const rotate = () => {
    if (held) return setHeld({ ...held, rot: nextRot(held.item, held.rot) });
    if (selected == null || !draft || !space) return;
    const p = draft.items[selected];
    const q = { ...p, rot: nextRot(p.item, p.rot) };
    if (canPlaceAt(space, draft, ctx, q, selected)) {
      setDraft({ ...draft, items: draft.items.map((x, k) => (k === selected ? q : x)) });
      setEditMsg(null);
    } else setEditMsg({ text: 'Döndürünce sığmıyor.', error: true });
  };
  const stash = () => {
    if (held) {
      setHeld(null);
      setEditMsg(null);
      return;
    }
    if (selected == null || !draft) return;
    const tops = onTopOf(draft, selected);
    setDraft({ ...draft, items: draft.items.filter((_, k) => k !== selected && !tops.includes(k)) });
    setSelected(null);
  };

  // ---------- Oyunda: kullan, taşı, döndür, kaldır (hemen kaydedilir) ----------
  const usedItem = using ? layouts[using.space]?.items[using.index] : undefined;
  const useDef = usedItem ? itemById(usedItem.item) : undefined;
  const useKey = using && usedItem ? powerKey(using.space, usedItem) : '';
  const useOn = useDef && using ? isOn(useDef, useKey, power) : false;
  const posedHere = !!posedAt && !!using && posedAt.space === using.space && posedAt.index === using.index;
  /** Kayıtlı yerleşimi değiştirip hemen kaydet; olmazsa eski hâli kalır */
  const commit = async (sp: SpaceId, next: SpaceLayout, ok: string | null = null) => {
    try {
      await saveSpace(sp, next);
      sfx.place();
      if (ok) setToast(ok);
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const togglePower = () => {
    if (!useDef || !useKey) return;
    const next = { ...power, [useKey]: !useOn };
    setPower(next);
    write(POWER_KEY, JSON.stringify(next));
    sfx.pop();
  };
  const nextChannel = () => {
    setChannels((c) => ({ ...c, [useKey]: ((c[useKey] ?? 0) + 1) % 2 }));
    sfx.pop();
  };
  const poseAction = (stand = false) => using && setAction((a) => ({ ...using, n: (a?.n ?? 0) + 1, stand }));
  /** Oyunda taşı: eşya kayıtlı yerinden kalkar, elde imleçle gezer */
  const quickPick = () => {
    if (!using || !usedItem) return;
    const base = layouts[using.space] ?? emptyLayout(using.space);
    const tops = onTopOf(base, using.index);
    setEditSpace(using.space);
    setDraft({ ...base, items: base.items.filter((_, k) => k !== using.index && !tops.includes(k)) });
    setHeld({ item: usedItem.item, rot: usedItem.rot, from: usedItem });
    setQuick(true);
    setUsing(null);
    setEditMsg(null);
    if (tops.length) setToast(`Üstündeki ${tops.length} eşya envantere döndü.`);
  };
  const quickDrop = (p: PlacedItem) => {
    if (!draft || !space) return;
    const it = itemById(p.item)!;
    const r = regionOf(plan, space);
    const me = pos.current && r ? { x: pos.current.x - r.x, y: pos.current.y - r.y } : null;
    const onMe = me && it.placement !== 'wall' && !it.walk && footprint(it, p.x, p.y, p.rot).some((t) => t.x === me.x && t.y === me.y);
    if (onMe) return setToast('Karakterin orada duruyor, başka bir karo seç.');
    if (!canPlaceAt(space, draft, ctx, p)) return setToast(it.placement === 'wall' ? 'Buraya asılamaz.' : 'Buraya konamaz.');
    const next = { ...draft, items: [...draft.items, p] };
    const sp = space;
    cancelEdit();
    void commit(sp, next);
  };
  const quickRotate = () => {
    if (held && quick) return setHeld({ ...held, rot: nextRot(held.item, held.rot) });
    if (!using || !usedItem) return;
    const base = layouts[using.space] ?? emptyLayout(using.space);
    const q = { ...usedItem, rot: nextRot(usedItem.item, usedItem.rot) };
    if (!canPlaceAt(using.space, base, ctx, q, using.index)) return setToast('Döndürünce sığmıyor.');
    void commit(using.space, { ...base, items: base.items.map((x, k) => (k === using.index ? q : x)) });
  };
  const quickRemove = () => {
    if (!using || !useDef) return;
    const base = layouts[using.space] ?? emptyLayout(using.space);
    const tops = onTopOf(base, using.index);
    const sp = using.space;
    setUsing(null);
    void commit(sp, { ...base, items: base.items.filter((_, k) => k !== using.index && !tops.includes(k)) }, `${useDef.name} envantere döndü.`);
  };

  const selItem = held ? itemById(held.item) : selected != null && draft ? itemById(draft.items[selected]?.item ?? '') : undefined;
  const maps = stats.maps;
  const nextMap = maps.next;
  const toNext = nextMap ? nextMap.hours * 60 - stats.trustedMinutes : 0;
  const where = space ? (isMonthSpace(space) ? `${formatMonth(space.slice(2))} bahçeni` : AREA_NAME[space]) : '';
  const tabOn = (v: 'room' | 'library' | 'garden' | 'month') => (v === 'month' ? !!hereMonth || here === 'trail' : here === v);
  const chipMonth = hereMonth ?? (months.includes(thisMonth) ? thisMonth : months.at(-1)!);
  const monthTrees = stats.forest.filter((t) => t.month === chipMonth);

  const fallback = (
    <section className="card">
      <h2>🌳 Ağaç bahçelerin</h2>
      <p className="muted small">Bu cihaz 3D dünyayı gösteremiyor; ağaçların aylara göre burada.</p>
      {months.filter((m) => monthState(m, today) === 'open').map((m) => (
        <div key={m} className="flat-region">
          <strong>{formatMonth(m)}</strong>
          <div className="flat-trees">
            {stats.forest.filter((t) => t.month === m).map((t) => (
              <button key={t.id} className="link" title={`${t.name} · ${t.minutes} dk`} onClick={() => setTree(t)}>
                {t.dry ? t.icon : t.species.icon}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );

  return (
    <div className="stack world-page">
      <div className="world-tabs" role="tablist" aria-label="Dünyamda nereye gideyim">
        {(
          [
            ['room', '🏠 Odam'],
            ['library', '📚 Kütüphane'],
            ['garden', `${mapDef.icon} Bahçe`],
            ['month', '🌳 Ağaç bahçeleri'],
          ] as ['room' | 'library' | 'garden' | 'month', string][]
        ).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={tabOn(v)}
            className={tabOn(v) ? 'on' : ''}
            onClick={() => goTo(v === 'month' ? monthSpace(chipMonth) : v)}
            disabled={editing}
          >
            {label}
          </button>
        ))}
      </div>

      {(hereMonth || here === 'trail') && !editing && (
        <div className="month-bar" role="group" aria-label="Ay bahçesine git">
          <div className="month-chips">
            {months.map((m) => {
              const st = monthState(m, today);
              const n = stats.forest.filter((t) => t.month === m && !t.dry).length;
              return (
                <button key={m} className={`chip${m === hereMonth ? ' on' : ''}${st !== 'open' ? ' locked' : ''}`} aria-pressed={m === hereMonth} onClick={() => goTo(monthSpace(m))}>
                  {st !== 'open' ? '🔒 ' : ''}
                  {formatMonth(m).split(' ')[0].slice(0, 3)}
                  {st === 'open' && <span className="muted"> {n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {can3D ? (
        <div className={`world-wrap${fullEdit ? ' editing' : ''}${big ? ' big' : ''}`} data-tour="world">
          <Suspense fallback={<div className="world-loading">🏡 Dünyan hazırlanıyor…</div>}>
            <WorldView
              key={ctx.map}
              plan={plan}
              map={mapDef}
              layouts={layouts}
              forest={stats.forest}
              creatures={stats.creatures}
              phase={phase}
              shadows={shadows}
              look={stats.equipped.look}
              start={start}
              goal={goal}
              growId={growId}
              onGrown={markGrown}
              books={doneBooks}
              reading={readingNow}
              onBook={(b) => {
                sfx.pop();
                setBook(b);
              }}
              edit={editing ? { space: space!, layout: draft!, full: !quick } : null}
              held={held}
              selected={selected}
              onPick={pick}
              onDrop={drop}
              onSelect={setSelected}
              onUse={(sp, i) => {
                sfx.pop();
                setUsing({ space: sp, index: i });
              }}
              using={using}
              action={action}
              onPosed={setPosedAt}
              power={power}
              channels={channels}
              tv={tv}
              onTree={(t) => {
                sfx.pop();
                setTree(t);
              }}
              onRegion={(id) => {
                if (id !== here && (id === 'room' || id === 'library' || here === 'room' || here === 'library')) sfx.door();
                setHere(id);
              }}
              onTile={(t) => {
                pos.current = t;
                write(POS_KEY, JSON.stringify(t));
              }}
              onFloor={() => setUsing(null)}
            />
          </Suspense>
          <div className="world-top" hidden={fullEdit}>
            {!editing && <span className="world-chip">💎 {stats.crystals}</span>}
            {!editing && hereMonth && <span className="world-chip">🌳 {monthTrees.filter((t) => !t.dry).length}</span>}
            <span className="grow" />
            <button
              className="world-chip"
              aria-label={sound ? 'Sesi kapat' : 'Sesi aç'}
              onClick={() => {
                setSoundOn(!sound);
                setSound(!sound);
              }}
            >
              {sound ? '🔊' : '🔇'}
            </button>
            <button
              className={`world-chip${shadows ? ' on' : ''}`}
              aria-pressed={shadows}
              title="Gölgeler (telefonda kapalı daha akıcı)"
              onClick={() => {
                write(GFX_KEY, shadows ? 'off' : 'on');
                setShadows(!shadows);
              }}
            >
              🌗
            </button>
            <button className={`world-chip${big ? ' on' : ''}`} aria-pressed={big} aria-label={big ? 'Küçült' : 'Büyüt'} onClick={() => setBig(!big)}>
              ⛶
            </button>
          </div>
          {toast && (
            <div className="world-locked" role="status">
              <span>{toast}</span>
            </div>
          )}
          {!editing && using && useDef && usedItem && (
            <div className="use-bar" role="toolbar" aria-label={useDef.name}>
              <span className="grow use-name">
                {useDef.icon} <strong>{useDef.name}</strong>
              </span>
              {(useDef.use === 'sit' || useDef.use === 'lie' || useDef.use === 'swing') &&
                (posedHere ? (
                  <button className="btn sm primary" onClick={() => poseAction(true)}>
                    🧍 Kalk
                  </button>
                ) : (
                  <button className="btn sm primary" onClick={() => poseAction()}>
                    {useDef.use === 'sit' ? '🪑 Otur' : useDef.use === 'lie' ? '🛏️ Yat' : '🎠 Sallan'}
                  </button>
                ))}
              {useDef.use === 'light' && (
                <button className="btn sm primary" onClick={togglePower}>
                  💡 {useOn ? 'Kapat' : 'Aç'}
                </button>
              )}
              {useDef.use === 'fire' && (
                <button className="btn sm primary" onClick={togglePower}>
                  🔥 {useOn ? 'Söndür' : 'Yak'}
                </button>
              )}
              {useDef.use === 'tv' && (
                <button className="btn sm primary" onClick={togglePower}>
                  📺 {useOn ? 'Kapat' : 'Aç'}
                </button>
              )}
              {useDef.use === 'tv' && useOn && (
                <button className="btn sm" onClick={nextChannel}>
                  🔁 {(channels[useKey] ?? 0) === 0 ? 'Ormanım' : 'Çalışmam'}
                </button>
              )}
              {useDef.opens === 'shelf' && (
                <button className="btn sm primary" onClick={() => setShelf(true)}>
                  📚 Rafları aç
                </button>
              )}
              <button className="btn sm" onClick={quickPick} aria-label="Taşı">
                ✋
              </button>
              {(useDef.rotations?.length ?? 1) > 1 && (
                <button className="btn sm" onClick={quickRotate} aria-label="Döndür">
                  ↻
                </button>
              )}
              <button className="btn sm" onClick={quickRemove} aria-label="Envantere kaldır">
                📦
              </button>
              <button className="btn sm ghost" onClick={() => setUsing(null)} aria-label="Kapat">
                ✕
              </button>
            </div>
          )}
          {quick && held && selItem && (
            <div className="use-bar" role="toolbar">
              <span className="grow use-name">
                ✋ <strong>{selItem.name}</strong> <span className="muted small">· {selItem.placement === 'wall' ? 'asmak istediğin duvara' : 'koymak istediğin karoya'} dokun</span>
              </span>
              {selItem.placement !== 'wall' && (selItem.rotations?.length ?? 1) > 1 && (
                <button className="btn sm" onClick={quickRotate} aria-label="Döndür">
                  ↻
                </button>
              )}
              <button className="btn sm ghost" onClick={cancelEdit}>
                ✕ Vazgeç
              </button>
            </div>
          )}
          {!editing && !using && (
            <div className="world-actions" data-tour="edit">
              <button className="btn" onClick={startEdit} disabled={!hereSpace} title={hereSpace ? undefined : 'Düzenlemek için bir alana gir'}>
                ✏️ Düzenle
              </button>
              <button className="btn" onClick={goShop}>
                🛍️ Dükkân
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (ses.running) ses.pause('game').catch(() => {});
                  setExploring(true);
                }}
              >
                🚶 Yakından gez
              </button>
            </div>
          )}
          {fullEdit && (
            <>
              <div className="edit-bar">
                <strong className="grow">✏️ {where} düzenle</strong>
                <button className="btn sm" onClick={cancelEdit} disabled={saving}>
                  Vazgeç
                </button>
                <button className="btn sm primary" onClick={save} disabled={saving || !!held}>
                  {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </div>
              <div className="edit-drawer" role="region" aria-label="Envanter">
                {(held || selItem) && (
                  <div className="edit-tools">
                    <span className="grow">
                      {selItem?.icon} <strong>{selItem?.name}</strong>
                      {held && !held.from && selItem && <span className="muted small"> · elinde</span>}
                    </span>
                    {selItem && (selItem.rotations?.length ?? 1) > 1 && (
                      <button className="btn sm" onClick={rotate} aria-label="Döndür">
                        ↻ Döndür
                      </button>
                    )}
                    {!held && selected != null && (
                      <button className="btn sm" onClick={() => pick(selected)}>
                        ✋ Taşı
                      </button>
                    )}
                    <button className="btn sm ghost" onClick={stash}>
                      {held && !held.from ? '✕ Bırak' : '📦 Envantere'}
                    </button>
                  </div>
                )}
                <p className={`edit-msg small ${editMsg?.error ? 'error-ink' : 'muted'}`}>
                  {editMsg?.text ?? (selected != null ? 'Eşyayı sürükleyerek de taşıyabilirsin' : 'Bir eşyaya dokun: seç · sürükle: taşı · aşağıdan yeni eşya seç')}
                </p>
                {(space === 'room' || space === 'library') && layout && (
                  <div className="cover-row">
                    {(['zemin', 'duvar'] as const).map((cat) => (
                      <span key={cat} className="cover-group">
                        <span className="muted small">{cat === 'zemin' ? 'Zemin' : 'Duvar'}</span>
                        {coverings(cat).map((it) => {
                          const slot = cat === 'zemin' ? 'floor' : 'wall';
                          const on = (layout[slot] ?? (cat === 'zemin' ? 'zemin:ahsap' : 'duvar:krem')) === it.id;
                          return (
                            <button
                              key={it.id}
                              className={`swatch${on ? ' on' : ''}${it.pattern ? ' pat' : ''}`}
                              title={it.name}
                              aria-label={it.name}
                              aria-pressed={on}
                              style={{ background: it.color2 ? `linear-gradient(135deg, ${it.color} 50%, ${it.color2} 50%)` : it.color }}
                              onClick={() => setDraft({ ...layout, [slot]: it.id })}
                            />
                          );
                        })}
                      </span>
                    ))}
                  </div>
                )}
                {invTabs.length > 1 && (
                  <div className="inv-tabs" role="tablist" aria-label="Envanter türleri">
                    {[{ id: 'hepsi', name: 'Hepsi', icon: '✨' }, ...invTabs].map((c) => (
                      <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
                        {c.icon} {c.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="inventory">
                  {inventory.length === 0 ? (
                    <p className="muted small">
                      Envanterin boş. <button className="link" onClick={goShop}>Dükkândan</button> eşya alabilirsin.
                    </p>
                  ) : (
                    shown
                      .sort((a, b) => groupOf(a.it).localeCompare(groupOf(b.it)))
                      .map(({ it, n }) => (
                        <button
                          key={it.id}
                          className={`inv-item${held?.item === it.id && !held.from ? ' on' : ''}`}
                          title={it.sub ? SUBS[it.sub] : undefined}
                          // Basınca eline alınır: farede sahneye sürükleyip bırakılır, dokunmatikte sonra karoya dokunulur
                          onPointerDown={() => hold(it)}
                          onClick={() => hold(it)}
                        >
                          <span aria-hidden>{it.icon}</span>
                          <span className="inv-name">{it.name}</span>
                          {n > 1 && n < 1000 && <span className="inv-n">×{n}</span>}
                        </button>
                      ))
                  )}
                </div>
              </div>
            </>
          )}
          {!editing && !using && <span className="world-hint">Bir yere dokun, yürüsün · bir eşyaya dokun, kullan</span>}
        </div>
      ) : (
        fallback
      )}

      <section className="card lands" data-tour="lands">
        <div className="card-head">
          <h2>
            {mapDef.icon} {mapDef.name}
          </h2>
          <span className="muted small">
            {maps.unlocked.length}/{CFG.world.maps.length} aşama
          </span>
        </div>
        <p className="muted small">
          {mapDef.desc} Odan {mapDef.room.w}×{mapDef.room.h}, bahçen {mapDef.garden.w}×{mapDef.garden.h} karo.
        </p>
        {nextMap ? (
          <>
            <p className="muted small">
              Arazin büyüyor: {nextMap.icon} <strong className="ink">{nextMap.name}</strong> için sayaçla {formatMinutes(toNext)} daha çalış. Evin ve bahçen yerinde genişler, eşyaların yerinde kalır.
            </p>
            <div className="pbar" aria-hidden>
              <span style={{ width: `${Math.min(100, ((stats.trustedMinutes - mapDef.hours * 60) / ((nextMap.hours - mapDef.hours) * 60)) * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="muted small">Arazinin bütün aşamalarını açtın, dünyan en büyük hâlinde!</p>
        )}
        <div className="map-row" aria-label="Arazinin aşamaları">
          {CFG.world.maps.map((m) => (
            <span key={m.id} className={`map-dot${m.id === mapDef.id ? ' on' : ''}${maps.unlocked.some((u) => u.id === m.id) ? '' : ' off'}`} title={`${m.name} · ${m.hours} saat`}>
              {m.icon}
            </span>
          ))}
        </div>
        <p className="small">
          Bahçelerine gelenler: {stats.creatures.length ? stats.creatures.map((c) => c.icon).join(' ') : <span className="muted">2 gün çalışınca ilk kelebekler gelir.</span>}
        </p>
      </section>

      {tree && <DaySheet date={tree.date} tree={tree} minutes={stats.dayTotals.get(tree.date) ?? tree.minutes} courses={courses} onClose={() => setTree(null)} />}

      {shelf && <ShelfView books={reading.books} onClose={() => setShelf(false)} />}
      {book && <BookCard book={book} onClose={() => setBook(null)} />}

      {exploring && (
        <div className="explore-host">
          <Suspense fallback={<div className="explore explore-loading">🚶 Dünyan hazırlanıyor…</div>}>
            <Explore
              plan={plan}
              map={mapDef}
              layouts={layouts}
              forest={stats.forest}
              creatures={stats.creatures}
              today={today}
              start={startTile(plan, false)}
              look={stats.equipped.look}
              perks={perksOf(stats.level.index)}
              starsGot={stats.starsToday}
              onStar={collectStar}
              onTree={(t) => setTree(t)}
              onClose={() => setExploring(false)}
              paused={!!tree}
              power={power}
              tv={tv}
              books={doneBooks}
              reading={readingNow}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
