// Oyunlaştırma: hepsi mevcut kayıtlardan türetilir.
// Uzun vadeli ilerleme = aylık ormanlar + seriyle açılan ağaç türleri + rozetler.
import { addDays, parseLocalDate, weekStart } from './date';
import { SPECIES, STAGES, monthOf, pickFreeCell, priceOf, stageIndex } from './forest';
import { BIOMES, islandProgress } from './island';
import { completedPlanDays } from './plan';
import type { Abandoned, ForestTree, PlanItem, Reflection, StudyLog } from './types';
import { wiltsOf, type Wilt } from './wilt';

export interface Badge {
  id: string;
  icon: string;
  title: string;
  desc: string;
  unlocked: boolean;
  progress: number; // 0–1
  hint?: string;
}

/** Bir günün cüzdanı: kazanılan dakika, o günün ağacına harcanan, kalan. */
export interface Wallet {
  date: string;
  earned: number;
  spent: number;
  left: number;
  /** O güne dikilen ağaç (günde en fazla bir) */
  tree: ForestTree | null;
}

/**
 * O gün için yapılabilecek iş:
 * - plant: henüz ağaç yok ve en az bir tohumluk para var
 * - grow: ağaç var ve o günün parası daha büyük bir evreye yetiyor
 */
export function dayAction(w: Wallet): { kind: 'plant' | 'grow'; stage: number } | null {
  const best = stageIndex(w.earned);
  if (!w.tree) return best >= 0 ? { kind: 'plant', stage: best } : null;
  return best > w.tree.stage ? { kind: 'grow', stage: best } : null;
}

export interface GameInput {
  logs: StudyLog[];
  reflections: Reflection[];
  trees: ForestTree[];
  doneTasks: number;
  today: string;
  /** Günlük planlar (yoksa boş) */
  plans?: PlanItem[];
  /** Yarıda bırakılan sayaç oturumları (yoksa boş) */
  abandoned?: Abandoned[];
}

export interface GameStats {
  streak: number;
  /** Seri var ama bugün henüz çalışılmadı → nazik hatırlatma */
  todayPending: boolean;
  bestStreak: number;
  restUsedThisWeek: boolean;
  todayMinutes: number;
  /** Bugünün cüzdanı */
  today: Wallet;
  totalMinutes: number;
  dayTotals: Map<string, number>;
  trees: ForestTree[];
  /** Bu ay içinde ağacı dikilmeyi ya da büyütülmeyi bekleyen günler (bugün dahil) */
  wallets: Wallet[];
  unlockedSpecies: Set<string>;
  /** Son dikilen tür — önizlemede kullanılır */
  favoriteSpecies: string;
  badges: Badge[];
  /** Planı tamamen bitirilmiş günler */
  planDays: string[];
  /** Solgun fidanlar ve canlanıp canlanmadıkları */
  wilts: Wilt[];
}

const isWeekend = (d: string) => [0, 6].includes(parseLocalDate(d).getDay());

/**
 * Yumuşak seri kuralları:
 * - Hafta sonu çalışmak seriyi büyütür, çalışmamak bozmaz.
 * - Her hafta 1 "dinlenme hakkı": kaçırılan bir hafta içi günü seriyi bozmaz.
 * - Bugün henüz bitmediği için bugünün boş olması seriyi bozmaz.
 */
export function computeStreak(studied: (d: string) => boolean, first: string | null, today: string) {
  let run = 0;
  let best = 0;
  const restUsed = new Set<string>();
  if (first) {
    for (let d = first; d <= today; d = addDays(d, 1)) {
      if (studied(d)) run++;
      else if (d === today || isWeekend(d) || run === 0) {
        /* seriyi bozmaz */
      } else if (!restUsed.has(weekStart(d))) restUsed.add(weekStart(d));
      else run = 0;
      best = Math.max(best, run);
    }
  }
  return { streak: run, best, restUsedThisWeek: restUsed.has(weekStart(today)) };
}

export function walletOf(date: string, dayTotals: Map<string, number>, trees: ForestTree[]): Wallet {
  const earned = dayTotals.get(date) ?? 0;
  const own = trees.filter((t) => t.date === date);
  // Eski verilerde bir günde birden çok bitki olabilir: en büyüğü o günün ağacı sayılır
  const tree = own.reduce<ForestTree | null>((best, t) => (!best || t.stage > best.stage ? t : best), null);
  const spent = own.reduce((sum, t) => sum + priceOf(t.stage), 0);
  return { date, earned, spent, left: Math.max(0, earned - spent), tree };
}

/** Verilen ayda ağacı dikilmeyi ya da büyütülmeyi bekleyen günler (en yeni önce). */
export function walletsFor(month: string, dayTotals: Map<string, number>, trees: ForestTree[], today: string): Wallet[] {
  return [...dayTotals.keys()]
    .filter((d) => monthOf(d) === month && d <= today)
    .map((d) => walletOf(d, dayTotals, trees))
    .filter((w) => dayAction(w))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type AutoStep =
  | { kind: 'plant'; tree: Omit<ForestTree, 'id'> }
  | { kind: 'grow'; id: string; stage: number };

/**
 * Geçmiş aylarda emek kaybolmasın: ağacı dikilmemiş günlere o günün parasının yettiği en büyük ağacı
 * diker, dikilmiş ama büyütülmemiş ağaçları da paranın yettiği evreye büyütür.
 */
export function autoPlantPlan(dayTotals: Map<string, number>, trees: ForestTree[], today: string): AutoStep[] {
  const thisMonth = monthOf(today);
  const steps: AutoStep[] = [];
  const taken = new Map<string, Set<number>>();
  const cellsOf = (month: string) => {
    if (!taken.has(month)) taken.set(month, new Set(trees.filter((t) => t.month === month).map((t) => t.cell)));
    return taken.get(month)!;
  };
  for (const date of [...dayTotals.keys()].sort()) {
    const month = monthOf(date);
    if (month >= thisMonth) continue;
    const w = walletOf(date, dayTotals, trees);
    const act = dayAction(w);
    if (!act) continue;
    if (act.kind === 'grow') {
      steps.push({ kind: 'grow', id: w.tree!.id, stage: act.stage });
      continue;
    }
    const cell = pickFreeCell(cellsOf(month), date);
    if (cell == null) continue; // o ayın ormanı dolu
    cellsOf(month).add(cell);
    steps.push({ kind: 'plant', tree: { date, stage: act.stage, species: SPECIES[0].id, month, cell } });
  }
  return steps;
}

export function computeStats({ logs, reflections, trees, doneTasks, today, plans = [], abandoned = [] }: GameInput): GameStats {
  const dayTotals = new Map<string, number>();
  for (const l of logs) dayTotals.set(l.date, (dayTotals.get(l.date) ?? 0) + l.duration_minutes);
  const totalMinutes = logs.reduce((s, l) => s + l.duration_minutes, 0);
  const todayMinutes = dayTotals.get(today) ?? 0;
  const reflectionDays = reflections.filter((r) => r.rating != null || (r.note ?? '').trim()).length;

  const studied = (d: string) => (dayTotals.get(d) ?? 0) > 0;
  const days = [...dayTotals.keys()].filter(studied).sort();
  const { streak, best: bestStreak, restUsedThisWeek } = computeStreak(studied, days[0] ?? null, today);

  const treesAtLeast = (stage: number) => trees.filter((t) => t.stage >= stage).length;

  const weekCourses = new Map<string, Set<string>>();
  for (const l of logs) {
    const w = weekStart(l.date);
    if (!weekCourses.has(w)) weekCourses.set(w, new Set());
    weekCourses.get(w)!.add(l.course_id);
  }
  const planDays = completedPlanDays(plans, logs).filter((d) => d <= today);

  const maxCoursesInWeek = Math.max(0, ...[...weekCourses.values()].map((s) => s.size));

  const b = (id: string, icon: string, title: string, desc: string, value: number, target: number): Badge => ({
    id,
    icon,
    title,
    desc,
    unlocked: value >= target,
    progress: Math.min(1, value / target),
    hint: value >= target ? undefined : `${Math.min(value, target)}/${target}`,
  });

  const badges: Badge[] = [
    b('plant1', '🌱', 'İlk Tohum', 'Ormanına ilk bitkini dik', trees.length, 1),
    b('streak3', '🔥', 'Isınma Turu', '3 günlük seri yap', bestStreak, 3),
    b('streak7', '⚡', 'Bir Hafta', '7 günlük seri yap', bestStreak, 7),
    b('streak30', '🏔️', 'Dağ Gibi', '30 günlük seri yap', bestStreak, 30),
    b('bloom5', '🌸', 'Çiçek Bahçesi', 'Çiçek ya da daha büyük 5 bitki dik', treesAtLeast(1), 5),
    b('big1', '🌳', 'Koca Ağaç', 'İlk büyük ağacını dik', treesAtLeast(3), 1),
    b('giant1', '🌲', 'Dev', 'İlk dev ağacını dik', treesAtLeast(4), 1),
    b('forester', '🏕️', 'Ormancı', '20 bitki dik', trees.length, 20),
    b('feel7', '😊', 'Duygu Günlüğü', '7 gün "nasıl geçti" yaz', reflectionDays, 7),
    b('tasks10', '✅', 'Liste Avcısı', '10 görevi bitir', doneTasks, 10),
    b('variety', '🎨', 'Çok Yönlü', 'Bir haftada 3 farklı derse çalış', maxCoursesInWeek, 3),
    b('plan1', '📋', 'Planlı Gün', 'Bir günün planını tamamla', planDays.length, 1),
    b('plan10', '🗓️', 'Plan Ustası', '10 günün planını tamamla', planDays.length, 10),
    b('month15', '🗺️', 'Gür Orman', 'Bir ayda 15 bitki dik', Math.max(0, ...countByMonth(trees).values()), 15),
  ];

  const lastTree = [...trees].sort((a, z) => a.date.localeCompare(z.date)).at(-1);

  return {
    streak,
    todayPending: streak > 0 && !studied(today),
    bestStreak,
    restUsedThisWeek,
    todayMinutes,
    today: walletOf(today, dayTotals, trees),
    totalMinutes,
    dayTotals,
    trees,
    wallets: walletsFor(monthOf(today), dayTotals, trees, today),
    unlockedSpecies: new Set(SPECIES.filter((s) => bestStreak >= s.unlock).map((s) => s.id)),
    favoriteSpecies: lastTree?.species ?? SPECIES[0].id,
    badges,
    planDays,
    wilts: wiltsOf(abandoned, logs),
  };
}

function countByMonth(trees: ForestTree[]) {
  const m = new Map<string, number>();
  trees.forEach((t) => m.set(t.month, (m.get(t.month) ?? 0) + 1));
  return m;
}

export type Celebration = { kind: 'stage' | 'badge' | 'species' | 'streak'; title: string; detail: string; icon: string };

/** İki durum arasındaki kutlanacak gelişmeleri bulur. */
export function diffStats(prev: GameStats, next: GameStats): Celebration[] {
  const out: Celebration[] = [];
  // Bugün çalışılan dakika yeni bir evreye yettiyse: ağaç yoksa dikmeye, varsa büyütmeye çağır
  const was = stageIndex(prev.today.earned);
  const now = stageIndex(next.today.earned);
  const has = next.today.tree?.stage ?? -1;
  if (next.today.earned > prev.today.earned && now > was && now > has) {
    const name = STAGES[now].name.toLowerCase();
    out.push({
      kind: 'stage',
      icon: ['🌰', '🌼', '🌿', '🌳', '🌲'][now],
      title: has < 0 ? `Bugün ${name} dikebilirsin!` : `Ağacın ${name} olabilir!`,
      detail: has < 0 ? 'Ormanına gidip bugünün ağacını dik.' : `Bugün ${next.today.earned} dk çalıştın. Ormanda ağacını büyüt.`,
    });
  }
  if (next.streak > prev.streak && next.streak >= 2 && prev.todayPending) {
    out.push({ kind: 'streak', icon: '🔥', title: `${next.streak} günlük seri!`, detail: 'Harika gidiyorsun.' });
  }
  for (const s of SPECIES) {
    if (next.unlockedSpecies.has(s.id) && !prev.unlockedSpecies.has(s.id)) {
      out.push({ kind: 'species', icon: '🔓', title: `Yeni ağaç: ${s.name}!`, detail: 'Bir sonraki bitkinde seçebilirsin.' });
    }
  }
  // Solgun fidan canlandı
  const wasRevived = new Set(prev.wilts.filter((w) => w.revived).map((w) => w.item.id));
  for (const w of next.wilts) {
    if (w.revived && !wasRevived.has(w.item.id) && prev.wilts.some((p) => p.item.id === w.item.id)) {
      out.push({ kind: 'stage', icon: '🌱', title: 'Solgun fidanını kurtardın!', detail: 'Çalışmaya döndün, fidan yeniden yeşerdi.' });
    }
  }
  // Ada büyüdü: yeni biyom ya da hayvan
  const islandWas = islandProgress(prev.totalMinutes).unlocked;
  const islandNow = islandProgress(next.totalMinutes).unlocked;
  for (const b of BIOMES) {
    if (!islandWas.has(b.id) && islandNow.has(b.id)) {
      out.push({ kind: 'species', icon: b.icon, title: `Adan büyüdü: ${b.name}!`, detail: b.desc });
    }
  }
  const had = new Set(prev.badges.filter((x) => x.unlocked).map((x) => x.id));
  for (const badge of next.badges) {
    if (badge.unlocked && !had.has(badge.id)) {
      out.push({ kind: 'badge', icon: badge.icon, title: `Yeni rozet: ${badge.title}`, detail: badge.desc });
    }
  }
  return out;
}
