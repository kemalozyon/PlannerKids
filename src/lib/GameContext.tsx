import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from './ApiContext';
import { toLocalDate } from './date';
import { computeStats, diffStats, type Celebration, type GameStats } from './game';
import type { Equipped, RoomInput, TreeElmas, UserRoom } from './types';
import type { SpaceId, SpaceLayout } from './world';

interface GameCtx {
  stats: GameStats | null;
  /** Kayıt/görev/değerlendirme değiştikten sonra çağır; yeni gelişmeler kutlanır. */
  refresh: () => Promise<void>;
  celebrate: (c: Celebration) => void;
  /** Dükkândan satın al (bakiye yetmezse hata fırlatır) */
  /** Eşya satın al (tekrar alınabilende adetli) */
  buy: (itemId: string, qty?: number) => Promise<void>;
  openChest: (week: string, itemId: string) => Promise<void>;
  /** Nadir ağaç ödülünü al (o günün eşyası) */
  openDrop: (date: string, itemId: string) => Promise<void>;
  /** Bir günün ağacındaki Elması al (Bahçem); alınan tutar */
  claimDay: (date: string) => Promise<number>;
  /** Gezintide yıldız topla (günün i. yıldızı) */
  collectStar: (i: number) => Promise<void>;
  equip: (e: Equipped) => Promise<void>;
  /** Odanın/bahçenin yerleşimini kaydet: hemen görünür, sunucuya sırayla gider (sunucu doğrular; reddederse kayıtlı
   *  hâl geri yüklenir ve hata fırlatılır) */
  saveSpace: (space: SpaceId, layout: SpaceLayout) => Promise<void>;
  /** Oda ekle / değiştir / sil (sonra yeniden yüklenir) */
  addRoom: (r: RoomInput) => Promise<UserRoom>;
  updateRoom: (id: string, r: RoomInput) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  /** Yeni haritaya taşın (evin dekoru baştan yapılır) */
  celebrations: (Celebration & { key: number })[];
  dismiss: (key: number) => void;
}

const Ctx = createContext<GameCtx | null>(null);

export function useGame(): GameCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('GameProvider yok');
  return c;
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

export function GameProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [stats, setStats] = useState<GameStats | null>(null);
  const [celebrations, setCelebrations] = useState<(Celebration & { key: number })[]>([]);
  const prev = useRef<GameStats | null>(null);
  const seq = useRef(0);

  const celebrate = useCallback((c: Celebration) => {
    setCelebrations((cs) => [...cs, { ...c, key: ++seq.current }]);
  }, []);

  /** Henüz sunucuya ulaşmamış yerleşimler: arada gelen tam yükleme onları eski hâliyle ezmesin */
  const unsaved = useRef(new Map<SpaceId, SpaceLayout>());
  const refresh = useCallback(async () => {
    const today = toLocalDate();
    const [logs, reflections, doneTasks, plans, ledger0, owned, equipped, books, courses, spaces, rooms, seeds] = await Promise.all([
      api.listLogs('2000-01-01', today),
      api.listReflections('2000-01-01', today),
      api.countDoneTasks(),
      // Plan tablosu henüz kurulmadıysa (0005 çalıştırılmadı) oyun yine çalışsın
      api.listPlans('2000-01-01', today).catch(() => []),
      // 0008 çalıştırılmadıysa oyun ekonomisi olmadan devam
      api.listLedger().catch(() => null),
      api.listOwned().catch(() => []),
      api.getEquipped().catch(() => null),
      api.listBooks().catch(() => []),
      api.listCourses().catch(() => []),
      // 0012 çalıştırılmadıysa varsayılan oda
      api.listSpaces().catch(() => []),
      // 0023 çalıştırılmadıysa eklenen oda yok
      api.listRooms().catch(() => []),
      // 0031 çalıştırılmadıysa ağaç türü tarihten
      api.listDaySeeds().catch(() => []),
    ]);
    let ledger = ledger0 ?? [];
    let treeElmas: TreeElmas[] = [];
    if (ledger0) {
      // Elmas'ı sunucu kayıtlardan hesaplar; deftere yalnızca o yazar (0010 yoksa eski defterle devam)
      for (const i of legacyStars(today)) await api.collectStar(today, i).catch(() => {});
      ledger = await api
        .syncEconomy()
        .then(() => api.listLedger())
        .catch(() => ledger);
      // Ağaçlarda bekleyen Elmas (0036 çalıştırılmadıysa yok)
      treeElmas = await api.listTreeElmas().catch(() => []);
    }
    const next = computeStats({
      logs,
      reflections,
      doneTasks,
      today,
      plans,
      ledger,
      owned,
      equipped,
      books,
      courses,
      spaces: { ...Object.fromEntries(spaces.map((s) => [s.space, s.layout])), ...Object.fromEntries(unsaved.current) },
      rooms,
      seeds,
      treeElmas,
    });
    // İlk yüklemede kutlama yok; yalnızca bu oturumdaki gelişmeler
    if (prev.current) diffStats(prev.current, next).forEach(celebrate);
    prev.current = next;
    setStats(next);
  }, [api, celebrate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const after = useCallback(
    <A extends unknown[]>(f: (...a: A) => Promise<unknown>) =>
      async (...a: A) => {
        await f(...a);
        await refresh();
      },
    [refresh],
  );

  // Yerleşim kaydı: hemen görünür (bütün veri yeniden yüklenmez); sunucuya sırayla gider, alan başına yalnızca son
  // hâl. Sunucu reddederse kayıtlı hâl geri yüklenir ve bekleyenlerin hepsi hata alır.
  const saveQ = useRef<{ next: Map<SpaceId, SpaceLayout>; run: Promise<void> | null }>({ next: new Map(), run: null });
  const saveSpace = useCallback(
    (space: SpaceId, layout: SpaceLayout) => {
      const patch = (s: GameStats | null) => s && { ...s, spaces: { ...s.spaces, [space]: layout } };
      prev.current = patch(prev.current);
      setStats(patch);
      const q = saveQ.current;
      unsaved.current.set(space, layout);
      q.next.set(space, layout);
      q.run ??= (async () => {
        try {
          while (q.next.size) {
            const [s, l] = q.next.entries().next().value!;
            q.next.delete(s);
            await api.saveSpace(s, l);
            if (unsaved.current.get(s) === l) unsaved.current.delete(s);
          }
          q.run = null;
        } catch (e) {
          q.next.clear();
          unsaved.current.clear();
          q.run = null;
          await refresh();
          throw e;
        }
      })();
      return q.run;
    },
    [api, refresh],
  );

  const addRoom = useCallback(
    async (r: RoomInput) => {
      const row = await api.addRoom(r);
      await refresh();
      return row;
    },
    [api, refresh],
  );

  const dismiss = useCallback((key: number) => setCelebrations((cs) => cs.filter((c) => c.key !== key)), []);

  return (
    <Ctx.Provider
      value={{
        stats,
        refresh,
        celebrate,
        celebrations,
        dismiss,
        buy: after((id: string, qty?: number) => api.buyItem(id, qty)),
        openChest: after((week: string, id: string) => api.openChest(week, id)),
        openDrop: after((date: string, id: string) => api.openDrop(date, id)),
        claimDay: async (date: string) => {
          const n = await api.claimDay(date);
          await refresh();
          return n;
        },
        collectStar: after((i: number) => api.collectStar(toLocalDate(), i)),
        equip: after((e: Equipped) => api.saveEquipped(e)),
        saveSpace,
        addRoom,
        updateRoom: after((id: string, r: RoomInput) => api.updateRoom(id, r)),
        deleteRoom: after(async (id: string) => {
          unsaved.current.delete(`r:${id}`);
          await api.deleteRoom(id);
        }),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
