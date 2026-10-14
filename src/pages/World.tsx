// Dünyam: tek bağlı dünya (worldPlan.ts). Ev (kütüphane | oda), önündeki bahçe, orman yolu ve aylık ağaç
// bahçeleri yan yana; karakter kapılardan yürüyerek geçer, eve girince çatı kalkar. Çalıştıkça dünya büyür: her
// çalışılan gün bir ağaç, toplam saatle arazi yerinde genişler (eşyalar yerinde kalır).
// Bir eşyaya dokununca karakter yanına yürür, varınca seçenekler açılır: eşyanın davranışlarından eylemler
// (world.ts → itemActions: otur, yat, aç-kapa, kapak, renk, depo, al, çal, mama, raflar), Taşı (eşya elde, karoya
// dokununca konur), Döndür, Kaldır (envantere). "🎒 Envanter" bulunduğun alanın çekmecesini açar: Elmasla alınan
// eşyalar Habbo gibi kare kare yerleşir, zemin/duvar seçilir. Kaydet tuşu yok: her değişiklik (eşyanın durumu da)
// hemen görünür ve kaydedilir (GameContext → saveSpace). ⛶ dünyayı tam ekran açar. "Yakından gez" (Explore) aynı
// eşya işlerini kullanır.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TvData } from '../components/world3d/art';
import type { ItemRef } from '../components/world3d/WorldView';
import StorageSheet from '../components/StorageSheet';
import ShelfView, { BookCard } from '../components/ShelfView';
import { ItemIcon } from '../components/ItemCard';
import DaySheet from '../components/DaySheet';
import { CATEGORIES, groupOf, has, itemById, ITEMS, SUBS, type Item } from '../lib/catalog';
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
import { PLACE_EVENT, takePlace } from '../lib/shop';
import { VIEW_EVENT } from '../lib/tour';
import type { Book, Course } from '../lib/types';
import { hasWebGL } from '../lib/webgl';
import {
  applyAction,
  canPlaceAt,
  canRotate,
  daysIn,
  defaultCover,
  isIndoor,
  isRoom,
  roomById,
  emptyLayout,
  fitsSpace,
  footprint,
  isOn,
  itemActions,
  itemCounts,
  isMonthSpace,
  mapById,
  monthSpace,
  monthState,
  moveItemTo,
  nextRot,
  onTopOf,
  powerKey,
  removeItemAt,
  rotateItemAt,
  sanitizeLayout,
  storable,
  storeAt,
  takeOutAt,
  seasonMonths,
  wallRot,
  type ActionId,
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
/** Eldeki ikram (DISPENSE) bu kadar sonra biter */
const HOLD_MS = 40_000;
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

/** Tarayıcının tam ekranı (iPhone'da yok: yalnızca sayfa içi kaplama) */
const enterFullscreen = () => {
  try {
    void document.documentElement.requestFullscreen?.()?.catch(() => {});
  } catch {
    /* yok say */
  }
};
const exitFullscreen = () => {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  } catch {
    /* yok say */
  }
};

const PLACE_NAME: Record<string, string> = {
  room: 'Odan',
  library: 'Kütüphanen',
  garden: 'Bahçen',
  kitchen: 'Mutfağın',
  bedroom: 'Yatak odan',
  bath: 'Banyon',
  playroom: 'Oyun odan',
};

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
  const [full, setFull] = useState(false);
  const [shadows, setShadows] = useState(() => read(GFX_KEY) === 'on' || (read(GFX_KEY) == null && !matchMedia('(pointer: coarse)').matches));
  const [sound, setSound] = useState(soundOn);
  const [tree, setTree] = useState<DayTree | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  // Yerleştirme: envanterin açık olduğu alan; taşınan eşyanın alanı (taslak: eşya çıkarılmış hâli); elde tutulan
  const [inv, setInv] = useState<SpaceId | null>(null);
  const [moving, setMoving] = useState<{ space: SpaceId; layout: SpaceLayout } | null>(null);
  const [held, setHeld] = useState<{ item: string; rot: number; from?: PlacedItem } | null>(null);
  const [tab, setTab] = useState('hepsi');
  const [grown, setGrown] = useState<string[]>(() => JSON.parse(read(GROWN_KEY) ?? '[]') as string[]);
  // Oynarken: seçenekleri açık eşya, otur/yat isteği, oturulan eşya, aç/kapa, TV kanalları
  const [using, setUsing] = useState<ItemRef | null>(null);
  const [action, setAction] = useState<{ space: SpaceId; index: number; n: number; stand?: boolean } | null>(null);
  const [posedAt, setPosedAt] = useState<ItemRef | null>(null);
  /** Depo penceresi açık eşya; karakterin elindeki ikram (DISPENSE) */
  const [storage, setStorage] = useState<ItemRef | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<string, number>>({});
  const pos = useRef<Tile | null>(null);
  const placeRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  // Tanıtım turu karakteri bir alana yollar
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      const to: RegionId = d === 'outdoor' || d === 'forest' || d === 'month' ? monthSpace(months.includes(thisMonth) ? thisMonth : months[0]) : d === 'library' || d === 'garden' ? d : 'room';
      setInv(null);
      setMoving(null);
      setHeld(null);
      setGoal((g) => ({ to, n: (g?.n ?? 0) + 1 }));
    };
    window.addEventListener(VIEW_EVENT, on);
    return () => window.removeEventListener(VIEW_EVENT, on);
  }, [months, thisMonth]);
  // Dükkândan "Hemen yerleştir" (sayfa açıkken olay, açılırken bekleyen istek)
  useEffect(() => {
    const on = (e: Event) => {
      takePlace();
      placeRef.current((e as CustomEvent<string>).detail);
    };
    window.addEventListener(PLACE_EVENT, on);
    return () => window.removeEventListener(PLACE_EVENT, on);
  }, []);
  const statsReady = !!stats;
  useEffect(() => {
    if (!statsReady) return;
    const id = takePlace();
    if (id) placeRef.current(id);
  }, [statsReady]);
  useEffect(() => {
    if (!holding) return;
    const id = setTimeout(() => setHolding(null), HOLD_MS);
    return () => clearTimeout(id);
  }, [holding]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  // Tam ekran: sayfa kaymaz; tarayıcının tam ekranından (Esc, geri) çıkılınca kaplama da kapanır
  useEffect(() => {
    if (!full) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const on = () => !document.fullscreenElement && setFull(false);
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.body.style.overflow = overflow;
      exitFullscreen();
    };
  }, [full]);

  const best = stats?.bestStreak ?? 0;
  const ctx: WorldCtx = useMemo(() => ({ map: stats?.world.map ?? CFG.world.maps[0].id, today, best }), [stats?.world.map, today, best]);
  const plan = useMemo(() => worldPlan(ctx, months), [ctx, months]);
  const [start] = useState(() => startTile(plan, startShelf));
  // Sahne yüklenmeden de bulunduğun alan bilinsin (sekme, envanter)
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
  // Yerleştirilenler ve depolara konanlar
  const usedIn = (l: SpaceLayout | undefined, id: string) => itemCounts(l).get(id) ?? 0;
  const usedElsewhere = (space: string) => (id: string) => Object.entries(allSpaces).reduce((n, [s, l]) => (s === space ? n : n + usedIn(l, id)), 0);
  // Değişmeyen alanın nesnesi aynı kalır: dünya yalnızca değişen alanı yeniden çizer
  const prevLayouts = useRef<Partial<Record<SpaceId, SpaceLayout>>>({});
  const layouts = useMemo(() => {
    const out: Partial<Record<SpaceId, SpaceLayout>> = {};
    if (!stats) return out;
    for (const r of plan.regions) {
      if (r.id === 'trail' || r.locked) continue;
      const l = sanitizeLayout(r.id, stats.spaces[r.id] ?? emptyLayout(r.id), ctx, owned, usedElsewhere(r.id)).layout;
      const old = prevLayouts.current[r.id];
      out[r.id] = old && JSON.stringify(old) === JSON.stringify(l) ? old : l;
    }
    prevLayouts.current = out;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, stats?.spaces, stats?.owned, stats?.unlock, ctx, allSpaces]);
  const invLayout = inv ? layouts[inv] : undefined;
  // Sahnedeki yerleştirme katmanı: taşınan eşyanın taslağı ya da envanterin alanı
  const edit = useMemo(() => moving ?? (inv ? { space: inv, layout: invLayout ?? emptyLayout(inv) } : null), [moving, inv, invLayout]);
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
    // stats'ın tamamı değil: eşya kaydı (spaces) TV'yi ve dünyayı yeniden çizdirmesin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.forest, stats?.todayMinutes, stats?.dayTotals, stats?.streak, stats?.trustedMinutes, today, thisMonth]);
  // Bulunduğun alan yerleştirilebilir mi (yolda ya da kilitli bahçede değil)
  const hereSpace = here && here !== 'trail' && !plan.regions.find((r) => r.id === here)?.locked ? (here as SpaceId) : null;
  // Envanter açıkken karakter başka bir alana geçerse envanter de oraya geçer
  useEffect(() => {
    if (!inv || held || hereSpace === inv) return;
    setInv(hereSpace);
    setTab('hepsi');
  }, [hereSpace]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc: elde tutulanı bırak (taşınan eşya yerinde kalır), yoksa tam ekrandan çık
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || exploring) return;
      if (held) {
        setHeld(null);
        setMoving(null);
      } else if (full) setFull(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [held, full, exploring]);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const hereMonth = hereSpace && isMonthSpace(hereSpace) ? hereSpace.slice(2) : null;
  // Bugünün ağacı yeni dikildiyse ya da büyüdüyse bir kez büyüme animasyonu (bu ayın bahçesindeyken)
  const todayTree = stats.forest.find((t) => t.date === today && !t.dry);
  const growKey = todayTree ? `${todayTree.id}:${todayTree.stageIndex}` : null;
  const growId = !edit && hereMonth === thisMonth && growKey && !grown.includes(growKey) ? todayTree!.id : null;
  const markGrown = () => {
    if (!growKey) return;
    const next = [...grown, growKey].slice(-40);
    setGrown(next);
    write(GROWN_KEY, JSON.stringify(next));
  };
  const goTo = (to: RegionId) => {
    if (held) return;
    setUsing(null);
    const r = plan.regions.find((x) => x.id === to);
    if (r?.locked && isMonthSpace(to)) setToast(`🔒 ${formatMonth(to.slice(2))} bahçesi 1 ${formatMonth(to.slice(2))} günü açılır.`);
    if (isRoom(to) && stats.bestStreak < roomById(to).streak) {
      const d = roomById(to);
      return setToast(`🔒 ${d.icon} ${d.name} ${d.streak} günlük seriyle açılır. En iyi serin: ${stats.bestStreak} gün.`);
    }
    setGoal((g) => ({ to, n: (g?.n ?? 0) + 1 }));
  };

  // ---------- Kayıt ----------
  const layoutOf = (sp: SpaceId) => layouts[sp] ?? emptyLayout(sp);
  const closeEdit = () => {
    setInv(null);
    setMoving(null);
    setHeld(null);
  };
  /** Hemen görünür ve kaydedilir; sunucu reddederse kayıtlı hâl döner */
  const persist = (sp: SpaceId, next: SpaceLayout) => {
    saveSpace(sp, next).catch((e: Error) => {
      closeEdit();
      setToast(`Kaydedilemedi: ${e.message}`);
    });
  };

  // ---------- Envanter ----------
  const usedAll = (id: string) => Object.values(allSpaces).reduce((n, l) => n + usedIn(l, id), 0);
  const free = (it: Item) => owned(it) - usedAll(it.id);
  const inventory = inv
    ? ITEMS.filter((it) => !!it.placement && fitsSpace(it, inv))
        .map((it) => ({ it, n: free(it) }))
        .filter((x) => x.n > 0)
    : [];
  const invTabs = CATEGORIES.filter((c) => inventory.some((x) => c.cats.includes(x.it.category)));
  const shown = tab === 'hepsi' ? inventory : inventory.filter((x) => CATEGORIES.find((c) => c.id === tab)?.cats.includes(x.it.category));
  const coverings = (cat: 'zemin' | 'duvar') => ITEMS.filter((it) => it.category === cat && owned(it) > 0);
  const openInv = (sp: SpaceId) => {
    setInv(sp);
    setMoving(null);
    setHeld(null);
    setUsing(null);
    setTab('hepsi');
  };
  /** Envanterden bir eşyayı eline al */
  const hold = (it: Item) => setHeld({ item: it.id, rot: it.rotations?.[0] ?? 0 });
  /** Karakterin durduğu karoya eşya konmaz (yürünür halı/yol hariç) */
  const onAvatar = (sp: SpaceId, it: Item, p: PlacedItem) => {
    const r = regionOf(plan, sp);
    const me = pos.current && r ? { x: pos.current.x - r.x, y: pos.current.y - r.y } : null;
    return !!me && it.placement !== 'wall' && !has(it, 'WALK_THROUGH') && footprint(it, p.x, p.y, p.rot).some((t) => t.x === me.x && t.y === me.y);
  };
  const drop = (t: Tile) => {
    if (!held || !edit) return;
    const sp = edit.space;
    const it = itemById(held.item);
    if (!it) return;
    const p: PlacedItem = { item: held.item, x: t.x, y: t.y, rot: it.placement === 'wall' ? wallRot(t.x, t.y) : held.rot };
    if (onAvatar(sp, it, p)) return setToast('Karakterin orada duruyor, başka bir karo seç.');
    if (!canPlaceAt(sp, edit.layout, ctx, p)) {
      return setToast(it.placement === 'wall' ? 'Buraya asılamaz: duvarın bu kısmı dolu ya da pencere/kapı var.' : 'Buraya konamaz: karo dolu ya da alanın dışında.');
    }
    sfx.place();
    persist(sp, { ...edit.layout, items: [...edit.layout.items, p] });
    if (held.from) {
      setMoving(null);
      setHeld(null);
    } else if (!it.repeat || free(it) <= 1) setHeld(null); // Habbo gibi: çit, yol elde kalır
  };
  /** Dükkândan "Hemen yerleştir": bulunduğun alanın envanteri eşya elde açılır */
  const placeFromShop = (id: string) => {
    const it = itemById(id);
    if (!it || !hereSpace) return setToast('Eşyanı yerleştirmek için evine ya da bahçene git, sonra 🎒 Envanter.');
    if (!fitsSpace(it, hereSpace)) return setToast(it.placement === 'outdoor' ? `${it.name} dışarıya konur: bahçene git, sonra 🎒 Envanter.` : `${it.name} evin içine konur: odana git, sonra 🎒 Envanter.`);
    if (free(it) <= 0) return setToast(`Bütün ${it.name} eşyaların yerleştirilmiş. Taşımak için üstüne dokun.`);
    openInv(hereSpace);
    hold(it);
  };
  placeRef.current = placeFromShop;

  // ---------- Eşya işleri (kuşbakışı ve gezinti): kullan, taşı, döndür, kaldır ----------
  const placedAt = (r: ItemRef) => layoutOf(r.space).items[r.index] as PlacedItem | undefined;
  /** Eşyanın eylemi (pozlar hariç: onları kuşbakışında WorldView, gezintide Explore yapar) */
  const doAction = (r: ItemRef, id: ActionId) => {
    const p = placedAt(r);
    const it = p && itemById(p.item);
    if (!p || !it) return;
    const next = applyAction(it, p, id, today);
    if (next) {
      const l = layoutOf(r.space);
      persist(r.space, { ...l, items: l.items.map((q, i) => (i === r.index ? next : q)) });
      if (id === 'open') sfx.door();
      else sfx.pop();
      if (id === 'feed') setToast('🥣 Mama kondu: canlılar bugün yanına gelecek.');
      return;
    }
    if (id === 'books') setShelf(true);
    else if (id === 'storage') setStorage(r);
    else if (id === 'sound') sfx.melody(it.sound ?? 'piyano');
    else if (id === 'dispense' && it.dispense) {
      setHolding(it.dispense);
      sfx.pop();
    }
  };
  const nextChannel = (r: ItemRef) => {
    const p = placedAt(r);
    if (!p) return;
    const k = powerKey(r.space, p);
    setChannels((c) => ({ ...c, [k]: ((c[k] ?? 0) + 1) % 2 }));
    sfx.pop();
  };
  const rotateItem = (r: ItemRef): string | null => {
    const next = rotateItemAt(r.space, layoutOf(r.space), r.index, ctx);
    if (!next) return 'Döndürünce sığmıyor.';
    persist(r.space, next);
    sfx.pop();
    return null;
  };
  const removeItem = (r: ItemRef) => {
    const it = itemById(placedAt(r)?.item ?? '');
    persist(r.space, removeItemAt(layoutOf(r.space), r.index));
    sfx.place();
    setUsing(null);
    setToast(`${it?.name ?? 'Eşya'} envantere döndü.`);
  };
  /** Gezintide taşınan eşyayı bırak (aynı alanda) */
  const moveItem = (r: ItemRef, to: Tile, rot: number): string | null => {
    const next = moveItemTo(r.space, layoutOf(r.space), r.index, to, rot, ctx);
    if (!next) return 'Buraya konamaz.';
    persist(r.space, next);
    sfx.place();
    return null;
  };
  /** Kuşbakışında Taşı: eşya yerinden kalkar, elde imleçle gezer, karoya dokununca konur */
  const startMove = (r: ItemRef) => {
    const base = layoutOf(r.space);
    const p = base.items[r.index];
    if (!p) return;
    const tops = onTopOf(base, r.index);
    setInv(null);
    setUsing(null);
    setMoving({ space: r.space, layout: removeItemAt(base, r.index) });
    setHeld({ item: p.item, rot: p.rot, from: p });
    if (tops.length) setToast(`Üstündeki ${tops.length} eşya envantere dönecek.`);
  };

  const usedItem = using ? placedAt(using) : undefined;
  const useDef = usedItem ? itemById(usedItem.item) : undefined;
  const useKey = using && usedItem ? powerKey(using.space, usedItem) : '';
  const useOn = useDef && usedItem ? isOn(useDef, usedItem) : false;
  const posedHere = !!posedAt && !!using && posedAt.space === using.space && posedAt.index === using.index;
  const actions = useDef && usedItem ? itemActions(useDef, usedItem, { posed: posedHere, today }) : [];
  const runAction = (id: ActionId) => {
    if (!using) return;
    if (id === 'sit' || id === 'lie' || id === 'swing' || id === 'stand') return setAction((a) => ({ ...using, n: (a?.n ?? 0) + 1, stand: id === 'stand' }));
    doAction(using, id);
  };
  // Depo penceresi: içindekiler ve envanterde boşta duran, içine konabilecek eşyalar
  const storePlaced = storage ? placedAt(storage) : undefined;
  const storeDef = storePlaced ? itemById(storePlaced.item) : undefined;
  const storeCandidates = storeDef
    ? ITEMS.filter((it) => storable(it) && it.category !== 'diger')
        .map((it) => ({ it, n: free(it) }))
        .filter((x) => x.n > 0)
    : [];

  const heldItem = held ? itemById(held.item) : undefined;
  const maps = stats.maps;
  const nextMap = maps.next;
  const toNext = nextMap ? nextMap.hours * 60 - stats.trustedMinutes : 0;
  const placeName = (sp: SpaceId) => (isMonthSpace(sp) ? `${formatMonth(sp.slice(2))} bahçen` : PLACE_NAME[sp]);
  const tabOn = (v: 'room' | 'library' | 'garden' | 'month') => (v === 'month' ? !!hereMonth || here === 'trail' : v === 'room' ? here === 'room' || (!!here && isRoom(here)) : here === v);
  const atHome = !!here && (here === 'room' || isRoom(here));
  const chipMonth = hereMonth ?? (months.includes(thisMonth) ? thisMonth : months.at(-1)!);
  const monthTrees = stats.forest.filter((t) => t.month === chipMonth);
  const idle = !using && !inv && !held;

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
      <div className={`world-stage${full ? ' full' : ''}`}>
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
              disabled={!!held}
            >
              {label}
            </button>
          ))}
        </div>

        {atHome && !held && (stats.rooms.unlocked.length > 0 || stats.rooms.next) && (
          <div className="month-bar" role="group" aria-label="Evin odalarına git">
            <div className="month-chips">
              <button className={`chip${here === 'room' ? ' on' : ''}`} aria-pressed={here === 'room'} onClick={() => goTo('room')}>
                🛋️ Odam
              </button>
              {[...stats.rooms.unlocked, ...(stats.rooms.next ? [stats.rooms.next] : [])].map((r) => {
                const open = stats.bestStreak >= r.streak;
                return (
                  <button key={r.id} className={`chip${here === r.id ? ' on' : ''}${open ? '' : ' locked'}`} aria-pressed={here === r.id} onClick={() => goTo(r.id)}>
                    {open ? r.icon : '🔒'} {r.name}
                    {!open && (
                      <span className="muted">
                        {' '}
                        {stats.bestStreak}/{r.streak}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(hereMonth || here === 'trail') && !held && (
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
          <div className="world-wrap" data-tour="world">
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
                edit={edit}
                held={held}
                onDrop={drop}
                onAim={() => {
                  setUsing(null);
                  setInv(null);
                }}
                onUse={(sp, i) => {
                  sfx.pop();
                  setUsing({ space: sp, index: i });
                }}
                using={using}
                action={action}
                onPosed={setPosedAt}
                holding={holding}
                channels={channels}
                tv={tv}
                onTree={(t) => {
                  sfx.pop();
                  setTree(t);
                }}
                onRegion={(id) => {
                  if (id !== here && ((!!id && isIndoor(id)) || (!!here && isIndoor(here)))) sfx.door();
                  setHere(id);
                }}
                onTile={(t) => {
                  pos.current = t;
                  write(POS_KEY, JSON.stringify(t));
                }}
                onFloor={() => setUsing(null)}
              />
            </Suspense>
            <div className="world-top">
              <span className="world-chip">💎 {stats.crystals}</span>
              {hereMonth && <span className="world-chip">🌳 {monthTrees.filter((t) => !t.dry).length}</span>}
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
              <button
                className={`world-chip${full ? ' on' : ''}`}
                aria-pressed={full}
                aria-label={full ? 'Tam ekrandan çık' : 'Tam ekran'}
                onClick={() => {
                  if (full) setFull(false);
                  else {
                    setFull(true);
                    enterFullscreen();
                  }
                }}
              >
                {full ? '✕' : '⛶'}
              </button>
            </div>
            {toast && (
              <div className="world-locked" role="status">
                <span>{toast}</span>
              </div>
            )}
            {using && useDef && usedItem && !held && (
              <div className="use-bar" role="toolbar" aria-label={useDef.name}>
                <span className="use-name">
                  {useDef.icon} <strong>{useDef.name}</strong>
                </span>
                {actions.length ? (
                  actions.map((a, k) => (
                    <button key={a.id} className={`btn sm${k === 0 ? ' primary' : ''}`} onClick={() => runAction(a.id)}>
                      {a.label}
                    </button>
                  ))
                ) : (
                  <button className="btn sm primary" disabled>
                    ▶ Kullan
                  </button>
                )}
                <button className="btn sm" onClick={() => startMove(using)}>
                  ✋ Taşı
                </button>
                <button
                  className="btn sm"
                  disabled={!canRotate(useDef)}
                  onClick={() => {
                    const err = rotateItem(using);
                    if (err) setToast(err);
                  }}
                >
                  ↻ Döndür
                </button>
                <button className="btn sm" onClick={() => removeItem(using)}>
                  📦 Kaldır
                </button>
                {useDef.fx === 'tv' && useOn && (
                  <button className="btn sm" onClick={() => nextChannel(using)}>
                    🔁 {(channels[useKey] ?? 0) === 0 ? 'Ormanım' : 'Çalışmam'}
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => setUsing(null)} aria-label="Kapat">
                  ✕
                </button>
              </div>
            )}
            {held?.from && heldItem && (
              <div className="use-bar" role="toolbar">
                <span className="use-name">
                  ✋ <strong>{heldItem.name}</strong> <span className="muted small">· {heldItem.placement === 'wall' ? 'asmak istediğin duvara' : 'koymak istediğin karoya'} dokun</span>
                </span>
                {canRotate(heldItem) && (
                  <button className="btn sm" onClick={() => setHeld({ ...held, rot: nextRot(heldItem, held.rot) })}>
                    ↻ Döndür
                  </button>
                )}
                <button className="btn sm ghost" onClick={closeEdit}>
                  ✕ Vazgeç
                </button>
              </div>
            )}
            {inv && (
              <div className="edit-drawer" role="region" aria-label="Envanter">
                <div className="edit-tools">
                  {held && heldItem ? (
                    <>
                      <span className="grow">
                        {heldItem.icon} <strong>{heldItem.name}</strong>{' '}
                        <span className="muted small">· {heldItem.placement === 'wall' ? 'asmak istediğin duvara' : 'koymak istediğin karoya'} dokun</span>
                      </span>
                      {canRotate(heldItem) && (
                        <button className="btn sm" onClick={() => setHeld({ ...held, rot: nextRot(heldItem, held.rot) })} aria-label="Döndür">
                          ↻
                        </button>
                      )}
                      <button className="btn sm ghost" onClick={() => setHeld(null)}>
                        Bırak
                      </button>
                    </>
                  ) : (
                    <span className="grow">
                      🎒 <strong>{placeName(inv)}</strong> <span className="muted small">· bir eşya seç, sonra karoya dokun</span>
                    </span>
                  )}
                  <button className="btn sm ghost" onClick={closeEdit} aria-label="Envanteri kapat">
                    ✕
                  </button>
                </div>
                {isIndoor(inv) && invLayout && (
                  <div className="cover-row">
                    {(['zemin', 'duvar'] as const).map((cat) => (
                      <span key={cat} className="cover-group">
                        <span className="muted small">{cat === 'zemin' ? 'Zemin' : 'Duvar'}</span>
                        {coverings(cat).map((it) => {
                          const slot = cat === 'zemin' ? 'floor' : 'wall';
                          const on = (invLayout[slot] ?? defaultCover(inv, slot)) === it.id;
                          return (
                            <button
                              key={it.id}
                              className={`swatch${on ? ' on' : ''}${it.pattern ? ' pat' : ''}`}
                              title={it.name}
                              aria-label={it.name}
                              aria-pressed={on}
                              style={{ background: it.color2 ? `linear-gradient(135deg, ${it.color} 50%, ${it.color2} 50%)` : it.color }}
                              onClick={() => persist(inv, { ...invLayout, [slot]: it.id })}
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
                      Burada koyabileceğin eşya yok. <button className="link" onClick={goShop}>Dükkândan</button> alabilirsin.
                    </p>
                  ) : (
                    shown
                      .sort((a, b) => groupOf(a.it).localeCompare(groupOf(b.it)))
                      .map(({ it, n }) => (
                        <button key={it.id} className={`inv-item${held?.item === it.id ? ' on' : ''}`} title={it.sub ? SUBS[it.sub] : undefined} onClick={() => hold(it)}>
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
            )}
            {idle && (
              <div className="world-actions">
                <button
                  className="btn"
                  data-tour="edit"
                  onClick={() => (hereSpace ? openInv(hereSpace) : setToast('Eşya koymak için evine ya da bir bahçeye gir.'))}
                >
                  🎒 Envanter
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
            {idle && <span className="world-hint">Bir yere dokun, yürüsün · bir eşyaya dokun: kullan, taşı, döndür, kaldır</span>}
          </div>
        ) : (
          fallback
        )}
      </div>

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
          {stats.rooms.next ? (
            <>
              Evinde yeni oda: {stats.rooms.next.icon} <strong>{stats.rooms.next.name}</strong> {stats.rooms.next.streak} günlük seriyle açılır (en iyi serin {stats.bestStreak} gün). Açılan
              oda kalıcıdır.
            </>
          ) : (
            <>Evinin bütün odalarını açtın! 🏠</>
          )}
        </p>
        <p className="small">
          Bahçelerine gelenler: {stats.creatures.length ? stats.creatures.map((c) => c.icon).join(' ') : <span className="muted">2 gün çalışınca ilk kelebekler gelir.</span>}
        </p>
      </section>

      {tree && <DaySheet date={tree.date} tree={tree} minutes={stats.dayTotals.get(tree.date) ?? tree.minutes} courses={courses} onClose={() => setTree(null)} />}

      {shelf && <ShelfView books={reading.books} onClose={() => setShelf(false)} />}
      {book && <BookCard book={book} onClose={() => setBook(null)} />}
      {storage && storeDef && storePlaced && (
        <StorageSheet
          item={storeDef}
          stored={storePlaced.stored ?? []}
          candidates={storeCandidates}
          onPut={(id) => {
            const next = storeAt(layoutOf(storage.space), storage.index, id);
            if (!next) return setToast(`${storeDef.name} doldu.`);
            persist(storage.space, next);
            sfx.pop();
          }}
          onTake={(k) => {
            persist(storage.space, takeOutAt(layoutOf(storage.space), storage.index, k));
            sfx.pop();
          }}
          onClose={() => setStorage(null)}
        />
      )}

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
              paused={!!tree || shelf || !!book || !!storage}
              holding={holding}
              channels={channels}
              tv={tv}
              books={doneBooks}
              reading={readingNow}
              onAction={doAction}
              onChannel={nextChannel}
              onRotate={rotateItem}
              onRemove={removeItem}
              onMove={moveItem}
              toast={toast}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
