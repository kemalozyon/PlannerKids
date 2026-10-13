import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from './ApiContext';
import { toLocalDate } from './date';
import { monthOf } from './forest';
import { autoPlantPlan, computeStats, diffStats, type Celebration, type GameStats } from './game';
import type { Api, Equipped, ForestTree, Placement, StudyLog } from './types';

interface GameCtx {
  stats: GameStats | null;
  /** Kayıt/görev/değerlendirme değiştikten sonra çağır; yeni gelişmeler kutlanır. */
  refresh: () => Promise<void>;
  plant: (t: Omit<ForestTree, 'id'>) => Promise<void>;
  move: (id: string, cell: number) => Promise<void>;
  /** Dikili bitkiyi farkı o günün cüzdanından ödeyerek büyütür */
  upgrade: (id: string, stage: number) => Promise<void>;
  celebrate: (c: Celebration) => void;
  /** Dükkândan satın al (bakiye yetmezse hata fırlatır) */
  buy: (itemId: string) => Promise<void>;
  openChest: (week: string, itemId: string) => Promise<void>;
  /** Gezintide yıldız topla (günün i. yıldızı) */
  collectStar: (i: number) => Promise<void>;
  place: (p: Omit<Placement, 'id'>) => Promise<void>;
  movePlaced: (id: string, x: number, z: number, rot: number) => Promise<void>;
  removePlaced: (id: string) => Promise<void>;
  equip: (e: Equipped) => Promise<void>;
  celebrations: (Celebration & { key: number })[];
  dismiss: (key: number) => void;
}

const Ctx = createContext<GameCtx | null>(null);

export function useGame(): GameCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('GameProvider yok');
  return c;
}

/** Geçmiş aylarda dikilmemiş/büyütülmemiş günleri tamamlar (bkz. autoPlantPlan). Güncel ağaç listesini döner. */
async function autoPlantPastMonths(api: Api, logs: StudyLog[], trees: ForestTree[], today: string) {
  const dayTotals = new Map<string, number>();
  logs.forEach((l) => dayTotals.set(l.date, (dayTotals.get(l.date) ?? 0) + l.duration_minutes));
  const out = [...trees];
  for (const step of autoPlantPlan(dayTotals, trees, today)) {
    try {
      if (step.kind === 'plant') out.push(await api.plantTree(step.tree));
      else {
        await api.upgradeTree(step.id, step.stage);
        const i = out.findIndex((t) => t.id === step.id);
        out[i] = { ...out[i], stage: step.stage };
      }
    } catch {
      /* başka sekme aynı anda yapmış olabilir */
    }
  }
  return out;
}

/** Bu ayın adası boşsa son yerleşimli ayın eşyaları taşınır (geçmiş aylar anı olarak kalır) */
async function carryPlacements(api: Api, placements: Placement[], month: string): Promise<Placement[]> {
  if (!placements.length || placements.some((p) => p.month === month)) return placements;
  const last = placements.map((p) => p.month).filter((m) => m < month).sort().at(-1);
  if (!last) return placements;
  const out = [...placements];
  for (const p of placements.filter((q) => q.month === last)) {
    try {
      out.push(await api.placeItem({ month, owned_id: p.owned_id, x: p.x, z: p.z, rot: p.rot }));
    } catch {
      /* başka sekme aynı anda taşımış olabilir */
    }
  }
  return out;
}

/** Eski sürümde yıldızlar tarayıcıda tutuluyordu (ct-stars-v1): bugünkü yıldızlar bir kez deftere taşınır */
function legacyStars(today: string): number[] {
  try {
    const raw = localStorage.getItem('ct-stars-v1');
    if (!raw) return [];
    localStorage.removeItem('ct-stars-v1');
    const s = JSON.parse(raw) as { date?: string; got?: number[] };
    return s.date === today && Array.isArray(s.got) ? s.got : [];
  } catch {
    return [];
  }
}

/** Kayıtlı görünüş yoksa eski gezinti seçimi (ct-avatar-v1) kullanılır */
function legacyAvatar(): Equipped | null {
  try {
    const v = localStorage.getItem('ct-avatar-v1');
    return v ? { character: `char:${v.replace('character-', '')}`, accessory: null, pets: [] } : null;
  } catch {
    return null;
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [stats, setStats] = useState<GameStats | null>(null);
  const [celebrations, setCelebrations] = useState<(Celebration & { key: number })[]>([]);
  const prev = useRef<GameStats | null>(null);
  const seq = useRef(0);

  const celebrate = useCallback((c: Celebration) => {
    setCelebrations((cs) => [...cs, { ...c, key: ++seq.current }]);
  }, []);

  const refresh = useCallback(async () => {
    const today = toLocalDate();
    const [logs, reflections, doneTasks, trees0, plans, abandoned, ledger0, owned, placements0, equipped, books, courses] = await Promise.all([
      api.listLogs('2000-01-01', today),
      api.listReflections('2000-01-01', today),
      api.countDoneTasks(),
      api.listTrees(),
      // Plan tablosu henüz kurulmadıysa (0005 çalıştırılmadı) oyun yine çalışsın
      api.listPlans('2000-01-01', today).catch(() => []),
      // 0007 çalıştırılmadıysa solgun fidan olmadan devam
      api.listAbandoned().catch(() => []),
      // 0008 çalıştırılmadıysa oyun ekonomisi olmadan devam
      api.listLedger().catch(() => null),
      api.listOwned().catch(() => []),
      api.listPlacements().catch(() => []),
      api.getEquipped().catch(() => null),
      api.listBooks().catch(() => []),
      api.listCourses().catch(() => []),
    ]);
    const trees = await autoPlantPastMonths(api, logs, trees0, today);
    let ledger = ledger0 ?? [];
    let placements = placements0;
    if (ledger0) {
      // Elmas'ı sunucu kayıtlardan hesaplar; deftere yalnızca o yazar (0010 yoksa eski defterle devam)
      for (const i of legacyStars(today)) await api.collectStar(today, i).catch(() => {});
      ledger = await api
        .syncEconomy()
        .then(() => api.listLedger())
        .catch(() => ledger);
      placements = await carryPlacements(api, placements, monthOf(today));
    }
    const next = computeStats({
      logs,
      reflections,
      trees,
      doneTasks,
      today,
      plans,
      abandoned,
      ledger,
      owned,
      placements,
      equipped: equipped ?? legacyAvatar(),
      books,
      courses,
    });
    // İlk yüklemede kutlama yok; yalnızca bu oturumdaki gelişmeler
    if (prev.current) diffStats(prev.current, next).forEach(celebrate);
    prev.current = next;
    setStats(next);
  }, [api, celebrate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const plant = useCallback(
    async (t: Omit<ForestTree, 'id'>) => {
      await api.plantTree(t);
      await refresh();
    },
    [api, refresh],
  );

  const move = useCallback(
    async (id: string, cell: number) => {
      await api.moveTree(id, cell);
      await refresh();
    },
    [api, refresh],
  );

  const upgrade = useCallback(
    async (id: string, stage: number) => {
      await api.upgradeTree(id, stage);
      await refresh();
    },
    [api, refresh],
  );

  const buy = useCallback(
    async (itemId: string) => {
      await api.buyItem(itemId);
      await refresh();
    },
    [api, refresh],
  );
  const openChest = useCallback(
    async (week: string, itemId: string) => {
      await api.openChest(week, itemId);
      await refresh();
    },
    [api, refresh],
  );
  const collectStar = useCallback(
    async (i: number) => {
      await api.collectStar(toLocalDate(), i);
      await refresh();
    },
    [api, refresh],
  );
  const place = useCallback(
    async (p: Omit<Placement, 'id'>) => {
      await api.placeItem(p);
      await refresh();
    },
    [api, refresh],
  );
  const movePlaced = useCallback(
    async (id: string, x: number, z: number, rot: number) => {
      await api.movePlacement(id, x, z, rot);
      await refresh();
    },
    [api, refresh],
  );
  const removePlaced = useCallback(
    async (id: string) => {
      await api.removePlacement(id);
      await refresh();
    },
    [api, refresh],
  );
  const equip = useCallback(
    async (e: Equipped) => {
      await api.saveEquipped(e);
      await refresh();
    },
    [api, refresh],
  );

  const dismiss = useCallback((key: number) => setCelebrations((cs) => cs.filter((c) => c.key !== key)), []);

  return (
    <Ctx.Provider
      value={{ stats, refresh, plant, move, upgrade, celebrate, celebrations, dismiss, buy, openChest, collectStar, place, movePlaced, removePlaced, equip }}
    >
      {children}
    </Ctx.Provider>
  );
}
