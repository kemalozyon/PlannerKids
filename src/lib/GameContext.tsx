import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from './ApiContext';
import { toLocalDate } from './date';
import { autoPlantPlan, computeStats, diffStats, type Celebration, type GameStats } from './game';
import type { Api, ForestTree, StudyLog } from './types';

interface GameCtx {
  stats: GameStats | null;
  /** Kayıt/görev/değerlendirme değiştikten sonra çağır; yeni gelişmeler kutlanır. */
  refresh: () => Promise<void>;
  plant: (t: Omit<ForestTree, 'id'>) => Promise<void>;
  move: (id: string, cell: number) => Promise<void>;
  /** Dikili bitkiyi farkı o günün cüzdanından ödeyerek büyütür */
  upgrade: (id: string, stage: number) => Promise<void>;
  celebrate: (c: Celebration) => void;
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
    const [logs, reflections, doneTasks, trees0, plans, abandoned] = await Promise.all([
      api.listLogs('2000-01-01', today),
      api.listReflections('2000-01-01', today),
      api.countDoneTasks(),
      api.listTrees(),
      // Plan tablosu henüz kurulmadıysa (0005 çalıştırılmadı) oyun yine çalışsın
      api.listPlans('2000-01-01', today).catch(() => []),
      // 0007 çalıştırılmadıysa solgun fidan olmadan devam
      api.listAbandoned().catch(() => []),
    ]);
    const trees = await autoPlantPastMonths(api, logs, trees0, today);
    const next = computeStats({ logs, reflections, trees, doneTasks, today, plans, abandoned });
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

  const dismiss = useCallback((key: number) => setCelebrations((cs) => cs.filter((c) => c.key !== key)), []);

  return (
    <Ctx.Provider value={{ stats, refresh, plant, move, upgrade, celebrate, celebrations, dismiss }}>{children}</Ctx.Provider>
  );
}
