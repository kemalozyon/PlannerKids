// Dünyam (Habbo gibi): evin odaları tek tek. Üstteki oda şeridinden (Odam · Kütüphane · eklenen odalar · teraslar ·
// ➕ Oda ekle) ya da kapılardan bir oda seçilir; oda koyu boşlukta yüzen bir ada olarak açılır (worldPlan.ts →
// spacePlan). Ağaçlar ayrı bir sayfada (Bahçem). Oda ve kütüphane toplam saatle yerinde büyür.
// Alttaki panel (WorldDock) her şeyin yeri: bir eşyaya dokununca eşyanın adı, özellikleri ve düğmeleri (eşyanın
// davranışlarından eylemler: world.ts → itemActions; seçilince karakter yanına yürür, varınca yapar · ✋ Taşı ·
// ↻ Döndür · 📦 Kaldır), karaktere dokununca karakter düğmeleri; sekmeler: 🎒 Envanter (odaya konabilecek eşyalar:
// seç, sonra karoya dokun), 🛍️ Dükkân (katalog; "Hemen yerleştir" eşyayı ele verir), 🎨 Oda (zemin/duvar, şekil,
// oda ekle/değiştir). Kaydet tuşu yok: her değişiklik (eşyanın durumu da) hemen görünür ve kaydedilir
// (GameContext → saveSpace). ⛶ odayı tam ekran açar. "Yakından gez" (Explore) aynı eşya işlerini kullanır.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TvData } from '../components/world3d/art';
import type { ItemRef } from '../components/world3d/WorldView';
import GemCounter from '../components/GemCounter';
import SpeechBubbles, { BUBBLE_MAX, BUBBLE_MS, type Bubble } from '../components/SpeechBubbles';
import Presence from '../components/Presence';
import PetPicker from '../components/PetPicker';
import RoomBuilder from '../components/RoomBuilder';
import RoomBlocks from '../components/RoomBlocks';
import type { Tab as LookTab } from '../components/avatar/AvatarEditor';
import StorageSheet from '../components/StorageSheet';
import ShelfView, { BookCard, type ShelfTab } from '../components/ShelfView';
import MusicSheet from '../components/MusicSheet';
import NoteBoardSheet from '../components/NoteBoardSheet';
import WorldDock, { type DockTab } from '../components/WorldDock';
import { useApi } from '../lib/ApiContext';
import { has, itemById, ITEMS, type Item } from '../lib/catalog';
import { CFG, type FixedTile } from '../lib/config';
import { dayPhase } from '../lib/dayPhase';
import { addDays, formatMinutes, toLocalDate, weekStart } from '../lib/date';
import { ownedCount } from '../lib/economy';
import { formatMonth } from '../lib/forest';
import { emitFx, fxAt } from '../lib/fx';
import { setReducedMotion, useReducedMotion } from '../lib/motionPref';
import { loadQuality, QUALITIES, QUALITY_LABEL, saveQuality, type Quality } from '../lib/gfx';
import { useGame } from '../lib/GameContext';
import { perksOf } from '../lib/level';
import { useReading } from '../lib/ReadingContext';
import { useSession } from '../lib/SessionContext';
import { setSoundOn, sfx, soundOn } from '../lib/sfx';
import { SHOP_EVENT, takeShop } from '../lib/shop';
import { DOCK_EVENT, VIEW_EVENT } from '../lib/tour';
import { BOARD_COLORS, type BoardNote, type Book } from '../lib/types';
import { hasWebGL } from '../lib/webgl';
import {
  applyAction,
  blockedTiles,
  canPlaceAt,
  colorOf,
  diveSpot,
  kickItem,
  spaceSize,
  teleportExit,
  teleportTarget,
  daysIn,
  defaultCover,
  emptyLayout,
  fitsSpace,
  footprint,
  isRoom,
  isTerrace,
  itemCounts,
  kindById,
  mapById,
  moveItemTo,
  onTopOf,
  powerKey,
  removeItemAt,
  roomOf,
  roomSpace,
  rotateItemAt,
  sanitizeLayout,
  storable,
  storeAt,
  takeOutAt,
  wallRot,
  type ActionId,
  type PlacedItem,
  type SpaceId,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
} from '../lib/world';
import { doorTarget, entryOf, regionAt, spacePlan, type WorldPlan } from '../lib/worldPlan';

const WorldView = lazy(() => import('../components/world3d/WorldView'));
const Explore = lazy(() => import('../components/forest3d/Explore'));
const AvatarEditor = lazy(() => import('../components/avatar/AvatarEditor'));

/** Seçili oda ve her odada karakterin son karosu */
const ROOM_KEY = 'ct-world-room-v1';
const POS_KEY = 'ct-world-pos-v2';
/** Konuşma balonlarındaki isim (karakterin adı; bu cihazda) */
const NICK_KEY = 'ct-nick-v1';
/** DISPENSE ikramına göre balon */
const YUM: Record<string, string> = { kahve: '☕ Mmm, kahve!', dondurma: '🍦 Mmm!', 'meyve-suyu': '🧃 Ohh, serin!', 'patlamis-misir': '🍿 Çıtır çıtır!', kurabiye: '🍪 Nefis!', su: '💧 Oh be!' };
/** Bağlamsal ipuçları: her biri bir kez (yapılınca ya da kapatılınca) */
const HINTS_KEY = 'ct-world-hints-v1';
const HINTS = [
  { id: 'item', text: '👆 Bir eşyaya dokun: özellikleri ve düğmeleri altta açılır' },
  { id: 'me', text: '🙂 Karakterine dokun: dans et, kıyafetini değiştir' },
  { id: 'inv', text: '🎒 Envanterden bir eşya seç, sonra bir kareye dokun' },
] as const;
type HintId = (typeof HINTS)[number]['id'];
/** Eldeki ikram (DISPENSE) bu kadar sonra biter */
const HOLD_MS = 40_000;

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

/** Karakterin odada başladığı karo: o odadaki son karosu (hâlâ zemindeyse), yoksa geldiği kapının içi */
function startTile(plan: WorldPlan, from: SpaceId | null): Tile {
  const space = plan.regions[0].id;
  if (!from) {
    try {
      const all = JSON.parse(read(POS_KEY) ?? '{}') as Record<string, Tile>;
      const t = all[space];
      if (t && regionAt(plan, t)) return t;
    } catch {
      /* yok say */
    }
  }
  return entryOf(plan, space, from) ?? { x: 1, y: 1 };
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

export default function World({ goCollection, goGarden }: { goCollection: () => void; goGarden: () => void }) {
  const { stats, saveSpace, collectStar, addRoom, updateRoom, deleteRoom } = useGame();
  const reading = useReading();
  const ses = useSession();
  const can3D = useMemo(hasWebGL, []);
  const today = toLocalDate();
  const thisMonth = today.slice(0, 7);
  // "Kitaplığımda gör" ile gelindiyse kütüphane açılır, raflar açık
  const [shelf, setShelf] = useState(() => {
    try {
      const on = sessionStorage.getItem('ct-open-shelf') === '1';
      sessionStorage.removeItem('ct-open-shelf');
      return on;
    } catch {
      return false;
    }
  });
  const [shelfTab, setShelfTab] = useState<ShelfTab>('books');
  const api = useApi();
  /** Radyo / pikap penceresi (çalan eşya) ve mantar pano */
  const [music, setMusic] = useState<ItemRef | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [board, setBoard] = useState<BoardNote[]>([]);
  useEffect(() => {
    api.listBoardNotes().then(setBoard).catch(() => setBoard([]));
  }, [api]);
  const boardCards = useMemo(() => board.map((n) => ({ text: n.text, color: BOARD_COLORS[n.color] ?? BOARD_COLORS[0], done: n.done })), [board]);
  // Seçili oda ve hangi odadan gelindiği (karakter o kapıda başlar)
  const [space, setSpace] = useState<SpaceId>(() => (shelf ? 'library' : ((read(ROOM_KEY) as SpaceId | null) ?? 'room')));
  const [from, setFrom] = useState<SpaceId | null>(null);
  const [full, setFull] = useState(false);
  const [quality, setQuality] = useState<Quality>(loadQuality);
  const [sound, setSound] = useState(soundOn);
  const reduced = useReducedMotion();
  const [settings, setSettings] = useState(false);
  const [hintsDone, setHintsDone] = useState<HintId[]>(() => {
    try {
      return JSON.parse(read(HINTS_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const doneHint = (id: HintId) =>
    setHintsDone((d) => {
      if (d.includes(id)) return d;
      const next = [...d, id];
      write(HINTS_KEY, JSON.stringify(next));
      return next;
    });
  const hint = HINTS.find((h) => !hintsDone.includes(h.id));
  const [book, setBook] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const exploringRef = useRef(false);
  exploringRef.current = exploring;
  /** Gezintideyken "Hemen yerleştir": n her istekte artar */
  const [exploreCarry, setExploreCarry] = useState<{ item: string; n: number } | null>(null);
  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  /** Alttaki panelin sekmesi (null: kapalı); başka sayfadan "dükkânı aç" ile gelindiyse Dükkân */
  const [tab, setTab] = useState<DockTab | null>(() => (takeShop() ? 'shop' : null));
  // Yerleştirme: taşınan eşyanın taslağı (eşya çıkarılmış hâli); elde tutulan
  const [moving, setMoving] = useState<{ space: SpaceId; layout: SpaceLayout; base: SpaceLayout } | null>(null);
  /** Son değişikliği geri al (kaldır, taşı, kaplama): birkaç saniye görünür */
  const [undo, setUndo] = useState<{ space: SpaceId; layout: SpaceLayout; label: string; n: number } | null>(null);
  const [held, setHeld] = useState<{ item: string; rot: number; from?: PlacedItem } | null>(null);
  // Oynarken: seçili eşya, otur/yat isteği, oturulan eşya, TV kanalları
  const [using, setUsing] = useState<ItemRef | null>(null);
  const [action, setAction] = useState<{ space: SpaceId; index: number; n: number; stand?: boolean } | null>(null);
  /** Kullan: karakter eşyanın yanına yürür, varınca bekleyen eylem yapılır */
  const [reach, setReach] = useState<{ space: SpaceId; index: number; n: number } | null>(null);
  const pending = useRef<ActionId | null>(null);
  // Karakter paneli: açık mı, hareket isteği (dans/el salla/dur), dans ediyor mu, görünüş düzenleyici, hayvan seçimi
  const [me, setMe] = useState(false);
  const [emote, setEmote] = useState<{ kind: 'dance' | 'wave' | null; n: number } | null>(null);
  const [dancing, setDancing] = useState(false);
  const [lookTab, setLookTab] = useState<LookTab | null>(null);
  const [petPick, setPetPick] = useState(false);
  /** Oda ekle / değiştir penceresi ve blok düzenleyici; şekli değişen oda (sığmayanlar bir kez kaydedilip envantere) */
  const [builder, setBuilder] = useState<{ edit: boolean } | null>(null);
  const [blocks, setBlocks] = useState(false);
  const reshaped = useRef<SpaceId | null>(null);
  const [posedAt, setPosedAt] = useState<ItemRef | null>(null);
  /** Depo penceresi açık eşya; karakterin elindeki ikram (DISPENSE) */
  const [storage, setStorage] = useState<ItemRef | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<string, number>>({});
  const pos = useRef<Tile | null>(null);
  // Oyun eşyaları: zar atışları, ışınlanma, atlama; ışınlanarak açılan oda
  const [dice, setDice] = useState<Record<string, { v: number; n: number }>>({});
  const [teleport, setTeleport] = useState<{ from: ItemRef; to: ItemRef; n: number } | null>(null);
  const [dive, setDive] = useState<{ space: SpaceId; index: number; n: number } | null>(null);
  const [beamIn, setBeamIn] = useState(false);
  const lastKick = useRef(0);
  // Konuşma balonları ve isim etiketi
  const anchor = useRef<HTMLDivElement | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const bubbleId = useRef(0);
  const [nick, setNick] = useState(() => read(NICK_KEY) || 'Ben');
  const [showName, setShowName] = useState(true);
  const say = (text: string, auto = false) => {
    const t = text.trim().slice(0, 60);
    if (!t) return;
    const id = ++bubbleId.current;
    setBubbles((b) => [...b, { id, text: t, auto }].slice(-BUBBLE_MAX));
    setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), BUBBLE_MS);
  };

  useEffect(() => {
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  // Başka bir sayfadan "dükkânı aç" (sayfa açıkken)
  useEffect(() => {
    const on = () => {
      if (!takeShop()) return;
      setExploring(false);
      openTab('shop', false);
    };
    window.addEventListener(SHOP_EVENT, on);
    return () => window.removeEventListener(SHOP_EVENT, on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!holding) return;
    const id = setTimeout(() => setHolding(null), HOLD_MS);
    return () => clearTimeout(id);
  }, [holding]);
  // Odaya girince isim etiketi birkaç saniye görünür; ışınlanma bitince sonraki odalar normal açılır
  useEffect(() => {
    setShowName(true);
    const id = setTimeout(() => {
      setShowName(false);
      setBeamIn(false);
    }, 3000);
    return () => clearTimeout(id);
  }, [space]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 5500);
    return () => clearTimeout(id);
  }, [undo]);
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

  const rooms = stats?.rooms;
  const ctx: WorldCtx = useMemo(() => ({ map: stats?.world.map ?? CFG.world.maps[0].id, today, rooms: rooms ?? [] }), [stats?.world.map, today, rooms]);
  // Silinen odanın yerine Odam
  const here: SpaceId = isRoom(space) && stats && !roomOf(space, ctx) ? 'room' : space;
  const plan = useMemo(() => spacePlan(ctx, here), [ctx, here]);
  const start = useMemo(() => startTile(plan, from), [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapDef = mapById(ctx.map);
  const doneBooks = useMemo(
    () => reading.books.filter((b) => b.status === 'done').sort((a, b) => (a.finished_on ?? '').localeCompare(b.finished_on ?? '') || a.id.localeCompare(b.id)),
    [reading.books],
  );
  const readingNow = useMemo(() => reading.books.filter((b) => b.status === 'reading'), [reading.books]);
  const owned = (it: Item) => (stats ? ownedCount(it, stats.owned, stats.unlock) : 0);
  // Bütün odalar (kaydedilmemiş oda başlangıç eşyalarıyla); her oda kendi kuralıyla ayıklanır
  const allSpaces = useMemo<Partial<Record<string, SpaceLayout>>>(() => ({ room: emptyLayout('room'), ...stats?.spaces }), [stats?.spaces]);
  // Yerleştirilenler ve depolara konanlar
  const usedIn = (l: SpaceLayout | undefined, id: string) => itemCounts(l).get(id) ?? 0;
  const usedElsewhere = (sp: string) => (id: string) => Object.entries(allSpaces).reduce((n, [s, l]) => (s === sp ? n : n + usedIn(l, id)), 0);
  // Değişmeyen odanın nesnesi aynı kalır: sahne yalnızca değişince yeniden çizilir
  const prevLayout = useRef<SpaceLayout | null>(null);
  const layouts = useMemo(() => {
    const out: Partial<Record<SpaceId, SpaceLayout>> = {};
    if (!stats) return out;
    const l = sanitizeLayout(here, stats.spaces[here] ?? emptyLayout(here), ctx, owned, usedElsewhere(here)).layout;
    const old = prevLayout.current;
    out[here] = old && JSON.stringify(old) === JSON.stringify(l) ? old : l;
    prevLayout.current = out[here]!;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, stats?.spaces, stats?.owned, stats?.unlock, ctx, allSpaces]);
  // Şekli ya da türü değişen odada sığmayan eşyalar bir kez kaydedilip envantere döner
  useEffect(() => {
    const sp = reshaped.current;
    if (!sp || !stats || sp !== here || !roomOf(sp, ctx)) return;
    reshaped.current = null;
    const raw = stats.spaces[sp];
    const now = layouts[sp];
    if (raw && now && JSON.stringify(raw) !== JSON.stringify(now)) {
      saveSpace(sp, now).catch(() => {});
      setToast('Yeni şekle sığmayan eşyalar envanterine döndü.');
    }
  }, [layouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const hereLayout = layouts[here];
  const inv = tab === 'inv' || (!!held && !held.from);
  // Sahnedeki yerleştirme katmanı: taşınan eşyanın taslağı ya da envanter açıkken oda
  const edit = useMemo(() => moving ?? (inv ? { space: here, layout: hereLayout ?? emptyLayout(here) } : null), [moving, inv, here, hereLayout]);
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
          return t ? { color: t.species.leaf, size: t.stageIndex / (CFG.world.stages.length - 1) } : null;
        }),
      },
    };
    // stats'ın tamamı değil: eşya kaydı (spaces) TV'yi ve odayı yeniden çizdirmesin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.forest, stats?.todayMinutes, stats?.dayTotals, stats?.streak, stats?.trustedMinutes, today, thisMonth]);
  // Esc: elde tutulanı bırak (taşınan eşya yerinde kalır), seçimi kapat, yoksa tam ekrandan çık
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (exploring || e.key !== 'Escape') return;
      if (held) {
        setHeld(null);
        setMoving(null);
      } else if (using || me) {
        setUsing(null);
        setMe(false);
      } else if (full) setFull(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [held, full, exploring, using, me]);

  /** Bir odaya geç (oda şeridi, kapı, tanıtım turu, ışınlayıcı) */
  const goRoom = (to: SpaceId, via: SpaceId | null = null, doorSound = true) => {
    if (to === here) return;
    setUsing(null);
    setMe(false);
    setDancing(false);
    setMoving(null);
    setHeld(null);
    setPosedAt(null);
    setFrom(via);
    setSpace(to);
    write(ROOM_KEY, to);
    if (doorSound) sfx.door();
  };
  // Tanıtım turu bir odaya (terrace: ilk teras, yoksa oda) ya da bahçeye yollar, alt panelde bir sekme açar
  useEffect(() => {
    const onView = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      if (d === 'outdoor' || d === 'forest' || d === 'month' || d === 'garden') return goGarden();
      if (!stats) return;
      const terrace = d === 'terrace' ? stats.rooms.map((r) => roomSpace(r.id)).find((sp) => isTerrace(sp, ctx)) : undefined;
      setExploring(false);
      goRoom(terrace ?? (d === 'library' ? 'library' : 'room'), null, false);
    };
    const onDock = (e: Event) => {
      const d = (e as CustomEvent<DockTab | 'me' | null>).detail;
      // Yükleniyorken openTab/closeEdit daha tanımlı değil (aşağıdaki erken dönüş)
      if (!stats) return;
      closeEdit();
      if (d === 'me') {
        openTab(null, false);
        setMe(true);
      } else openTab(d, false);
    };
    window.addEventListener(VIEW_EVENT, onView);
    window.addEventListener(DOCK_EVENT, onDock);
    return () => {
      window.removeEventListener(VIEW_EVENT, onView);
      window.removeEventListener(DOCK_EVENT, onDock);
    };
  });

  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const doEmote = (kind: 'dance' | 'wave' | null) => {
    setEmote((e) => ({ kind, n: (e?.n ?? 0) + 1 }));
    setDancing(kind === 'dance');
    if (kind === 'wave') say('👋 Merhaba!', true);
    else if (kind === 'dance') say('🎶 🕺 🎶', true);
  };

  // ---------- Kayıt ----------
  const layoutOf = (sp: SpaceId) => layouts[sp] ?? emptyLayout(sp);
  const closeEdit = () => {
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

  const offerUndo = (sp: SpaceId, layout: SpaceLayout, label: string) => setUndo((u) => ({ space: sp, layout, label, n: (u?.n ?? 0) + 1 }));
  const runUndo = () => {
    if (!undo) return;
    persist(undo.space, undo.layout);
    setUndo(null);
    closeEdit();
    sfx.pop();
  };

  // ---------- Envanter ----------
  const usedAll = (id: string) => Object.values(allSpaces).reduce((n, l) => n + usedIn(l, id), 0);
  const free = (it: Item) => owned(it) - usedAll(it.id);
  /** Bir odaya konabilecek, boşta duran eşyalar */
  const inventoryFor = (sp: SpaceId) =>
    ITEMS.filter((it) => !!it.placement && fitsSpace(it, sp, ctx))
      .map((it) => ({ it, n: free(it) }))
      .filter((x) => x.n > 0);
  /** Alttaki panelin bir sekmesini aç (sekme çubuğunda aynı sekmeye yeniden dokununca kapanır) */
  const openTab = (t: DockTab | null, toggle = true) => {
    setTab((cur) => (toggle && cur === t ? null : t));
    setUsing(null);
    setMe(false);
    if (t !== 'inv') closeEdit();
    if (t === 'inv') doneHint('inv');
  };
  /** Envanterden bir eşyayı eline al */
  const hold = (it: Item) => {
    sfx.pick();
    setHeld({ item: it.id, rot: it.rotations?.[0] ?? 0 });
  };
  /** Karakterin durduğu karoya eşya konmaz (yürünür halı/yol hariç) */
  const onAvatar = (it: Item, p: PlacedItem) => {
    const t = pos.current;
    return !!t && it.placement !== 'wall' && !has(it, 'WALK_THROUGH') && footprint(it, p.x, p.y, p.rot).some((q) => q.x === t.x && q.y === t.y);
  };
  const drop = (t: Tile & { sub?: number }) => {
    if (!held || !edit) return;
    const sp = edit.space;
    const it = itemById(held.item);
    if (!it) return;
    // Taşınan eşyanın durumu (açık, renk, içindekiler) onunla gider; çeyrek bırakılan yerden
    const { x: _x, y: _y, rot: _r, sub: _s, ...state } = held.from ?? { x: 0, y: 0, rot: 0 };
    const p: PlacedItem = { ...state, item: held.item, x: t.x, y: t.y, rot: it.placement === 'wall' ? wallRot(t.x, t.y) : held.rot, ...(t.sub === undefined ? {} : { sub: t.sub }) };
    if (onAvatar(it, p)) return setToast('Karakterin orada duruyor, başka bir karo seç.');
    if (!canPlaceAt(sp, edit.layout, ctx, p)) {
      return setToast(it.placement === 'wall' ? 'Buraya asılamaz: duvarın bu kısmı dolu ya da pencere/kapı var.' : 'Buraya konamaz: karo dolu ya da odanın dışında.');
    }
    sfx.place();
    persist(sp, { ...edit.layout, items: [...edit.layout.items, p] });
    if (held.from && moving) offerUndo(moving.space, moving.base, `✋ ${it.name} taşındı`);
    if (held.from) {
      setMoving(null);
      setHeld(null);
    } else if (!it.repeat || free(it) <= 1) setHeld(null); // Habbo gibi: çit, yol elde kalır
  };
  /** Gezintide envanterden konan eşya (öndeki karo); hata metni döner */
  const placeItem = (sp: SpaceId, p: PlacedItem): string | null => {
    const it = itemById(p.item);
    if (!it) return 'Eşya bulunamadı.';
    if (free(it) <= 0) return `Bütün ${it.name} eşyaların yerleştirilmiş.`;
    const l = layoutOf(sp);
    if (!canPlaceAt(sp, l, ctx, p)) return 'Buraya konamaz.';
    persist(sp, { ...l, items: [...l.items, p] });
    sfx.place();
    return null;
  };
  /** Dükkândan "Hemen yerleştir": eşya bu odada ele alınır (uymuyorsa nereye konacağı söylenir) */
  const placeFromShop = (id: string) => {
    if (exploringRef.current) return setExploreCarry((c) => ({ item: id, n: (c?.n ?? 0) + 1 }));
    const it = itemById(id);
    if (!it) return;
    if (!fitsSpace(it, here, ctx)) {
      const terrace = stats.rooms.find((r) => kindById(r.kind).outdoor);
      if (it.placement === 'outdoor') return setToast(terrace ? `${it.name} terasa konur: üstten ${terrace.name} odasını seç.` : `${it.name} terasa konur: 🎨 Oda → ➕ Oda ekle → Teras.`);
      return setToast(`${it.name} evin içine konur: üstten bir oda seç.`);
    }
    if (free(it) <= 0) return setToast(`Bütün ${it.name} eşyaların yerleştirilmiş. Taşımak için üstüne dokun.`);
    setTab('inv');
    setUsing(null);
    setMe(false);
    setMoving(null);
    hold(it);
  };

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
    if (id === 'books' || id === 'stats') {
      setShelfTab(id === 'books' ? 'books' : 'stats');
      setShelf(true);
    } else if (id === 'music') setMusic(r);
    else if (id === 'notes') setNotesOpen(true);
    else if (id === 'study') {
      setToast('📖 Kronometreyi başlat: sayaç çalışırken karakterin bu masada ders çalışır.');
      setTimeout(() => (location.hash = '#today'), 900);
    } else if (id === 'storage') setStorage(r);
    else if (id === 'sound') {
      if (it.sound === 'nota') sfx.note(it.palette?.indexOf(colorOf(it, p) ?? '') ?? 0);
      else sfx.melody(it.sound ?? 'piyano');
    } else if (id === 'dispense' && it.dispense) {
      setHolding(it.dispense);
      sfx.pop();
      say(YUM[it.dispense] ?? '😋 Mmm!', true);
    } else if (id === 'roll') {
      // Zar: yuvarlanır, sonra sonucu balonda
      const v = 1 + Math.floor(Math.random() * 6);
      const k = powerKey(r.space, p);
      setDice((d) => ({ ...d, [k]: { v, n: (d[k]?.n ?? 0) + 1 } }));
      sfx.dice();
      setTimeout(() => say(`🎲 ${v}!`, true), 850);
    } else if (id === 'teleport') {
      const to = teleportTarget(homeLayouts(), homeOrder, r);
      if (!to) return setToast('🌀 Eşi yok: başka bir ışınlayıcı koy ve 🎨 Renk ile bunun rengine boya.');
      setTeleport((t) => ({ from: r, to, n: (t?.n ?? 0) + 1 }));
      say('✨ Vınnn!', true);
    } else if (id === 'dive') {
      if (!diveSpot(layoutOf(r.space), r.index)) return setToast('🤸 Atlama tahtasının önüne (oklar yönüne) havuz suyu koy.');
      setDive((d) => ({ ...r, n: (d?.n ?? 0) + 1 }));
      say('🤸 Hop!', true);
    }
  };
  /** Bütün odalar; bulunulan oda ekrandaki (ayıklanmış) hâliyle (eşya sıraları ekrandakiyle aynı) */
  const homeLayouts = () => ({ ...allSpaces, [here]: layoutOf(here) }) as Partial<Record<SpaceId, SpaceLayout>>;
  /** Işınlayıcının eşi başka odada: o oda açılır, karakter eşinin önünde büyüyerek belirir */
  const onBeamed = (to: ItemRef) => {
    const l = allSpaces[to.space];
    const p = l?.items[to.index];
    const it = p && itemById(p.item);
    if (!l || !p || !it) return;
    const { w, h } = spaceSize(to.space, ctx);
    const out = teleportExit(it, p, w, h, blockedTiles(to.space, l, ctx)).out;
    try {
      const all = JSON.parse(read(POS_KEY) ?? '{}') as Record<string, Tile>;
      write(POS_KEY, JSON.stringify({ ...all, [to.space]: out }));
    } catch {
      /* yok say */
    }
    setBeamIn(true);
    goRoom(to.space, null, false);
    sfx.zap();
  };
  /** Top: karakterin yürüdüğü yöne yuvarlanır (çok sık kaydedilmesin) */
  const onKick = (r: ItemRef, dir: Tile) => {
    const now = Date.now();
    if (now - lastKick.current < 300) return;
    const next = kickItem(r.space, layoutOf(r.space), r.index, dir, ctx);
    if (!next) return;
    lastKick.current = now;
    persist(r.space, next);
    sfx.boing(1.3);
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
    const p = placedAt(r);
    const it = itemById(p?.item ?? '');
    if (p && it) fxAt('puff', plan.regions[0], it, p);
    const before = layoutOf(r.space);
    persist(r.space, removeItemAt(before, r.index));
    sfx.place();
    setUsing(null);
    offerUndo(r.space, before, `📦 ${it?.name ?? 'Eşya'} envantere döndü`);
  };
  /** Gezintide taşınan eşyayı bırak (aynı odada) */
  const moveItem = (r: ItemRef, to: Tile, rot: number): string | null => {
    const next = moveItemTo(r.space, layoutOf(r.space), r.index, to, rot, ctx);
    if (!next) return 'Buraya konamaz.';
    persist(r.space, next);
    sfx.place();
    return null;
  };
  /** Taşı: eşya yerinden kalkar, elde imleçle gezer, karoya dokununca konur */
  const startMove = (r: ItemRef) => {
    const base = layoutOf(r.space);
    const p = base.items[r.index];
    if (!p) return;
    const tops = onTopOf(base, r.index);
    setUsing(null);
    setMoving({ space: r.space, layout: removeItemAt(base, r.index), base });
    setHeld({ item: p.item, rot: p.rot, from: p });
    if (tops.length) setToast(`Üstündeki ${tops.length} eşya envantere dönecek.`);
  };
  const runAction = (id: ActionId) => {
    if (!using) return;
    if (id === 'sit' || id === 'lie' || id === 'swing' || id === 'stand') return setAction((a) => ({ ...using, n: (a?.n ?? 0) + 1, stand: id === 'stand' }));
    // Önce yanına yürü, varınca yap (dans biter)
    setDancing(false);
    pending.current = id;
    setReach((a) => ({ ...using, n: (a?.n ?? 0) + 1 }));
  };
  const onReached = (r: ItemRef) => {
    const id = pending.current;
    pending.current = null;
    if (id) doAction(r, id);
  };
  /** Kapıya varıldı: kapının götürdüğü odaya geç */
  const onDoor = (d: FixedTile) => {
    const to = doorTarget(here, d, ctx);
    if (!to) return setToast(stats.rooms.length < CFG.world.maxRooms ? 'Bu kapı henüz bir odaya açılmıyor: 🎨 Oda → ➕ Oda ekle.' : 'Bu kapı bir odaya açılmıyor.');
    goRoom(to, here);
  };
  // Depo penceresi: içindekiler ve envanterde boşta duran, içine konabilecek eşyalar
  const storePlaced = storage ? placedAt(storage) : undefined;
  const storeDef = storePlaced ? itemById(storePlaced.item) : undefined;
  const storeCandidates = storeDef
    ? ITEMS.filter((it) => storable(it) && it.category !== 'diger')
        .map((it) => ({ it, n: free(it) }))
        .filter((x) => x.n > 0)
    : [];

  const maps = stats.maps;
  const nextMap = maps.next;
  const toNext = nextMap ? nextMap.hours * 60 - stats.trustedMinutes : 0;
  const hereRoom = isRoom(here) ? roomOf(here, ctx) : undefined;
  const placeName = here === 'room' ? 'Odan' : here === 'library' ? 'Kütüphanen' : (hereRoom?.name ?? 'Odan');
  const idle = !using && !tab && !held && !me;
  /** Evin alanları kapı sırasıyla (ışınlayıcı eşi bu sırayla aranır) */
  const homeOrder: SpaceId[] = ['room', 'library', ...[...stats.rooms].sort((a, b) => a.pos - b.pos).map((r) => roomSpace(r.id))];
  // Seçili ışınlayıcının eşi nerede
  const usedItem = using ? itemById(placedAt(using)?.item ?? '') : undefined;
  const pair = using && usedItem && has(usedItem, 'TELEPORT') ? teleportTarget(homeLayouts(), homeOrder, using) : undefined;
  const spaceName = (sp: SpaceId) => (sp === 'room' ? 'Odam' : sp === 'library' ? 'Kütüphane' : (roomOf(sp, ctx)?.name ?? 'oda'));
  const linkNote = pair === undefined ? undefined : pair ? `🔗 Eşi: ${pair.space === using!.space ? 'bu odada' : spaceName(pair.space)}` : '🔗 Eşi yok: aynı renkte bir ışınlayıcı daha koy';
  const nav: [SpaceId, string][] = [
    ['room', '🛋️ Odam'],
    ['library', '📚 Kütüphane'],
    ...stats.rooms.map((r): [SpaceId, string] => [roomSpace(r.id), `${kindById(r.kind).icon} ${r.name}`]),
  ];

  const fallback = (
    <section className="card">
      <h2>🏠 Evin</h2>
      <p className="muted small">Bu cihaz 3D odaları gösteremiyor. Ağaçlarını Bahçem sayfasında görebilirsin.</p>
      <button className="btn" onClick={goGarden}>
        🌳 Bahçeme git
      </button>
    </section>
  );

  return (
    <div className="stack world-page">
      <div className={`world-stage${full ? ' full' : ''}`}>
        <div className="room-nav" role="tablist" aria-label="Evinin odaları" data-tour="rooms">
          {nav.map(([sp, label]) => (
            <button key={sp} role="tab" aria-selected={here === sp} className={`chip${here === sp ? ' on' : ''}`} disabled={!!held} onClick={() => goRoom(sp)}>
              {label}
            </button>
          ))}
          {stats.rooms.length < CFG.world.maxRooms && (
            <button className="chip add" disabled={!!held} onClick={() => setBuilder({ edit: false })}>
              ➕ Oda ekle
            </button>
          )}
        </div>

        {can3D ? (
          <div className="world-wrap" data-tour="world">
            <Suspense fallback={<div className="world-loading">🏠 {placeName} hazırlanıyor…</div>}>
              <WorldView
                plan={plan}
                map={mapDef}
                layouts={layouts}
                creatures={stats.creatures}
                phase={phase}
                quality={quality}
                look={stats.equipped.look}
                board={boardCards}
                start={start}
                books={doneBooks}
                reading={readingNow}
                onBook={(b) => {
                  sfx.pop();
                  setBook(b);
                }}
                edit={edit}
                held={held}
                onDrop={drop}
                onDoor={onDoor}
                onUse={(sp, i) => {
                  sfx.pop();
                  setTab(null);
                  setMe(false);
                  setUsing({ space: sp, index: i });
                  doneHint('item');
                }}
                reach={reach}
                onReached={onReached}
                onAvatar={() => {
                  sfx.pop();
                  setUsing(null);
                  setTab(null);
                  setMe((m) => !m);
                  doneHint('me');
                }}
                emote={emote}
                pets={stats.equipped.pets}
                using={using}
                action={action}
                onPosed={setPosedAt}
                holding={holding}
                channels={channels}
                dice={dice}
                teleport={teleport}
                onBeamed={onBeamed}
                beamIn={beamIn}
                dive={dive}
                onKick={onKick}
                onWater={(on) => on && say('💦 Yüzüyorum!', true)}
                anchor={anchor}
                tv={tv}
                onTile={(t) => {
                  pos.current = t;
                  try {
                    const all = JSON.parse(read(POS_KEY) ?? '{}') as Record<string, Tile>;
                    write(POS_KEY, JSON.stringify({ ...all, [here]: t }));
                  } catch {
                    /* yok say */
                  }
                }}
                onFloor={() => {
                  setUsing(null);
                  setMe(false);
                  setDancing(false);
                }}
              />
            </Suspense>
            <SpeechBubbles ref={anchor} bubbles={bubbles} name={me || showName ? nick : null} />
            <div className="world-top">
              <GemCounter className="world-chip" value={stats.crystals} />
              <span className="world-chip room-name">
                {hereRoom ? kindById(hereRoom.kind).icon : here === 'library' ? '📚' : '🛋️'} {placeName}
              </span>
              <span className="grow" />
              <button className={`world-chip${settings ? ' on' : ''}`} aria-expanded={settings} aria-label="Ayarlar" onClick={() => setSettings((o) => !o)}>
                ⚙️
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
            <Presence show={settings}>
              <div className="world-settings" role="dialog" aria-label="Oda ayarları">
                <div className="ws-row">
                  <span>Ses</span>
                  <button
                    className={`ws-toggle${sound ? ' on' : ''}`}
                    aria-pressed={sound}
                    onClick={() => {
                      setSoundOn(!sound);
                      setSound(!sound);
                    }}
                  >
                    {sound ? '🔊 Açık' : '🔇 Kapalı'}
                  </button>
                </div>
                <div className="ws-row">
                  <span>Grafik</span>
                  <div className="ws-seg" role="radiogroup" aria-label="Grafik kalitesi">
                    {QUALITIES.map((q) => (
                      <button
                        key={q}
                        role="radio"
                        aria-checked={quality === q}
                        className={quality === q ? 'on' : ''}
                        onClick={() => {
                          saveQuality(q);
                          setQuality(q);
                        }}
                      >
                        {QUALITY_LABEL[q]}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="muted small ws-note">{quality === 'dusuk' ? 'Telefonda en akıcısı.' : quality === 'orta' ? 'Güneş gölgeleri açık.' : 'Gölgeler ve ışık parlaması. Güçlü cihazlar için.'}</p>
                <div className="ws-row">
                  <span>Hareket</span>
                  <button className={`ws-toggle${!reduced ? ' on' : ''}`} aria-pressed={!reduced} onClick={() => setReducedMotion(!reduced)}>
                    {reduced ? '🐢 Azaltılmış' : '✨ Tam'}
                  </button>
                </div>
              </div>
            </Presence>
            <Presence show={!!toast}>
              <div key={toast ?? ''} className="world-locked" role="status">
                <span>{toast}</span>
              </div>
            </Presence>
            <Presence show={idle && !!hint && !undo && !toast}>
              <div key={hint?.id} className="world-coach" role="note">
                <span>{hint?.text}</span>
                <button className="pop-x" aria-label="İpucunu kapat" onClick={() => hint && doneHint(hint.id)}>
                  ✕
                </button>
              </div>
            </Presence>
          </div>
        ) : (
          fallback
        )}

        {can3D && (
          <WorldDock
            space={here}
            ctx={ctx}
            layout={hereLayout}
            tab={tab}
            onTab={openTab}
            using={using}
            onCloseUse={() => setUsing(null)}
            posedAt={posedAt}
            channels={channels}
            onAction={runAction}
            onChannel={nextChannel}
            onMove={startMove}
            onRotate={(r) => {
              const err = rotateItem(r);
              if (err) setToast(err);
            }}
            onRemove={removeItem}
            me={me}
            dancing={dancing}
            onCloseMe={() => setMe(false)}
            onEmote={doEmote}
            onPets={() => {
              setMe(false);
              setPetPick(true);
            }}
            onLook={(t) => {
              setMe(false);
              setLookTab(t);
            }}
            held={held}
            onRotateHeld={(rot) => held && setHeld({ ...held, rot })}
            onCancelHeld={closeEdit}
            undo={held ? null : undo}
            onUndo={runUndo}
            items={inventoryFor(here)}
            owned={owned}
            onHold={hold}
            onCover={(slot, id) => {
              if (!hereLayout || (hereLayout[slot] ?? defaultCover(here, slot, ctx)) === id) return;
              offerUndo(here, hereLayout, `${slot === 'floor' ? '🟫 Zemin' : '🧱 Duvar'} değişti`);
              persist(here, { ...hereLayout, [slot]: id });
            }}
            goCollection={goCollection}
            onPlace={placeFromShop}
            onSay={(t) => say(t)}
            linkNote={linkNote}
            nick={nick}
            onNick={(n) => {
              const v = n.trim().slice(0, 16) || 'Ben';
              setNick(v);
              write(NICK_KEY, v);
              say(`🏷️ Benim adım ${v}!`, true);
            }}
            onBought={(it, qty) => {
              const t = pos.current;
              if (t) emitFx({ kind: 'confetti', x: t.x + 0.5, z: t.y + 0.5, y: 1.4 });
              say(qty > 1 ? `🎉 ${qty} tane ${it.name}!` : `🎉 Yaşasın, ${it.name}!`, true);
            }}
            free={free}
            room={hereRoom}
            canAdd={stats.rooms.length < CFG.world.maxRooms}
            onAddRoom={() => setBuilder({ edit: false })}
            onEditRoom={() => setBuilder({ edit: true })}
            onBlocks={() => setBlocks(true)}
            onExplore={() => {
              if (ses.running) ses.pause('game').catch(() => {});
              setTab(null);
              setUsing(null);
              setMe(false);
              setExploring(true);
            }}
          />
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
          {mapDef.desc} Odan {mapDef.room.w}×{mapDef.room.h}, kütüphanen {mapDef.library.w}×{mapDef.library.h} karo.
        </p>
        {nextMap ? (
          <>
            <p className="muted small">
              Evin büyüyor: {nextMap.icon} <strong className="ink">{nextMap.name}</strong> için sayaçla {formatMinutes(toNext)} daha çalış. Odan ve kütüphanen yerinde genişler, eşyaların
              yerinde kalır.
            </p>
            <div className="pbar" aria-hidden>
              <span style={{ width: `${Math.min(100, ((stats.trustedMinutes - mapDef.hours * 60) / ((nextMap.hours - mapDef.hours) * 60)) * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="muted small">Evinin bütün aşamalarını açtın, odaların en büyük hâlinde!</p>
        )}
        <div className="map-row" aria-label="Evin aşamaları">
          {CFG.world.maps.map((m) => (
            <span key={m.id} className={`map-dot${m.id === mapDef.id ? ' on' : ''}${maps.unlocked.some((u) => u.id === m.id) ? '' : ' off'}`} title={`${m.name} · ${m.hours} saat`}>
              {m.icon}
            </span>
          ))}
        </div>
        <p className="small">
          Evinde {stats.rooms.length ? `${stats.rooms.length} oda daha var` : 'henüz ek oda yok'}: <strong>➕ Oda ekle</strong> ile istediğin türde (teras da olur) yeni odalar yapıp şeklini karo
          karo çizebilirsin (en çok {CFG.world.maxRooms}).
        </p>
        <p className="small">
          Terasına gelenler: {stats.creatures.length ? stats.creatures.map((c) => c.icon).join(' ') : <span className="muted">2 gün çalışınca ilk kelebekler gelir.</span>}
        </p>
        <button className="btn" onClick={goGarden}>
          🌳 Ağaç bahçeme git
        </button>
      </section>

      {lookTab && (
        <Suspense fallback={null}>
          <AvatarEditor initialTab={lookTab} onClose={() => setLookTab(null)} />
        </Suspense>
      )}
      {petPick && <PetPicker onClose={() => setPetPick(false)} />}
      {builder && (
        <RoomBuilder
          room={builder.edit ? hereRoom : undefined}
          count={stats.rooms.length}
          onClose={() => setBuilder(null)}
          onSave={async (r) => {
            if (builder.edit && hereRoom) {
              const sp = roomSpace(hereRoom.id);
              if (hereRoom.kind !== r.kind || JSON.stringify(hereRoom.cells ?? null) !== JSON.stringify(r.cells ?? null)) reshaped.current = sp;
              await updateRoom(hereRoom.id, r);
              setToast(`${r.name} güncellendi.`);
            } else {
              const row = await addRoom(r);
              sfx.plant();
              setToast(`${kindById(r.kind).icon} ${r.name} eklendi!`);
              goRoom(roomSpace(row.id));
            }
          }}
          onDelete={
            builder.edit && hereRoom
              ? async () => {
                  const room = hereRoom;
                  closeEdit();
                  setUsing(null);
                  goRoom('room');
                  await deleteRoom(room.id);
                  setToast(`${room.name} silindi, eşyaları envanterine döndü.`);
                }
              : undefined
          }
        />
      )}
      {blocks && hereRoom && (
        <RoomBlocks
          room={hereRoom}
          onClose={() => setBlocks(false)}
          onSave={async (cells) => {
            reshaped.current = roomSpace(hereRoom.id);
            await updateRoom(hereRoom.id, { kind: hereRoom.kind, shape: hereRoom.shape, size: hereRoom.size, name: hereRoom.name, cells });
            sfx.place();
          }}
        />
      )}
      {shelf && <ShelfView books={reading.books} tab={shelfTab} onClose={() => setShelf(false)} />}
      {music && placedAt(music) && (
        <MusicSheet title={`${itemById(placedAt(music)!.item)?.icon ?? '🎧'} ${itemById(placedAt(music)!.item)?.name ?? 'Müzik'}`} source={powerKey(music.space, placedAt(music)!)} onClose={() => setMusic(null)} />
      )}
      {notesOpen && (
        <NoteBoardSheet
          notes={board}
          onAdd={async (text, color) => {
            try {
              const n = await api.addBoardNote(text, color);
              setBoard((b) => [...b, n]);
              sfx.pop();
            } catch {
              setToast('Not asılamadı, bağlantını kontrol et.');
            }
          }}
          onToggle={(n) => {
            setBoard((b) => b.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)));
            if (!n.done) sfx.plant();
            api.updateBoardNote(n.id, { done: !n.done }).catch(() => api.listBoardNotes().then(setBoard).catch(() => {}));
          }}
          onDelete={(n) => {
            setBoard((b) => b.filter((x) => x.id !== n.id));
            sfx.pop();
            api.deleteBoardNote(n.id).catch(() => api.listBoardNotes().then(setBoard).catch(() => {}));
          }}
          onClose={() => setNotesOpen(false)}
        />
      )}
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
          <Suspense fallback={<div className="explore explore-loading">🚶 {placeName} hazırlanıyor…</div>}>
            <Explore
              plan={plan}
              map={mapDef}
              layouts={layouts}
              creatures={isTerrace(here, ctx) ? stats.creatures : []}
              today={today}
              start={pos.current ?? start}
              quality={quality}
              look={stats.equipped.look}
              perks={perksOf(stats.level.index)}
              starsGot={stats.starsToday}
              onStar={collectStar}
              onClose={() => setExploring(false)}
              paused={shelf || !!book || !!storage || !!music || notesOpen || !!lookTab || petPick}
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
              pets={stats.equipped.pets}
              inventoryFor={inventoryFor}
              owned={owned}
              onCover={(sp, slot, id) => persist(sp, { ...layoutOf(sp), [slot]: id })}
              onPlace={placeItem}
              onShop={() => {
                setExploring(false);
                openTab('shop', false);
              }}
              carryNew={exploreCarry}
              onMe={(k) => (k === 'pets' ? setPetPick(true) : setLookTab(k))}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
