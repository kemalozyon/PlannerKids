// Oyunlaştırma: hepsi mevcut kayıtlardan türetilir.
// Uzun vadeli ilerleme = aylık ormanlar + seriyle açılan ağaç türleri + rozetler.
import { addDays, parseLocalDate, weekStart } from './date';
import { SPECIES, STAGES, monthOf, priceOf, stageIndex } from './forest';
import { completedPlanDays } from './plan';
import type { ForestTree, PlanItem, Reflection, StudyLog } from './types';

export interface Badge {
  id: string;
  icon: string;
  title: string;
  desc: string;
  unlocked: boolean;
  progress: number; // 0–1
  hint?: string;
}

/** Bir günün cüzdanı: kazanılan dakika, harcanan, kalan. */
export interface Wallet {
  date: string;
  earned: number;
  spent: number;
  left: number;
}

export interface GameInput {
  logs: StudyLog[];
  reflections: Reflection[];
  trees: ForestTree[];
  doneTasks: number;
  today: string;
  /** Günlük planlar (yoksa boş) */
  plans?: PlanItem[];
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
  /** Bu ay içinde en az bir bitki alabilecek kadar parası kalan günler (bugün dahil) */
  wallets: Wallet[];
  unlockedSpecies: Set<string>;
  /** Son dikilen tür — önizlemede kullanılır */
  favoriteSpecies: string;
  badges: Badge[];
  /** Planı tamamen bitirilmiş günler */
  planDays: string[];
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
  const spent = trees.filter((t) => t.date === date).reduce((sum, t) => sum + priceOf(t.stage), 0);
  return { date, earned, spent, left: Math.max(0, earned - spent) };
}

/** Verilen ayda hâlâ bir şey alabilecek cüzdanlar (en yeni önce). */
export function walletsFor(month: string, dayTotals: Map<string, number>, trees: ForestTree[], today: string): Wallet[] {
  return [...dayTotals.keys()]
    .filter((d) => monthOf(d) === month && d <= today)
    .map((d) => walletOf(d, dayTotals, trees))
    .filter((w) => w.left >= STAGES[0].min)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function computeStats({ logs, reflections, trees, doneTasks, today, plans = [] }: GameInput): GameStats {
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
  // Bugünün cüzdanı yeni bir fiyata ulaştıysa (harcama cüzdanı azaltır, kutlama tetiklemez)
  const was = stageIndex(prev.today.left);
  const now = stageIndex(next.today.left);
  if (next.today.earned > prev.today.earned && now > was && now >= 0) {
    out.push({
      kind: 'stage',
      icon: ['🌰', '🌼', '🌿', '🌳', '🌲'][now],
      title: `Cüzdanında ${next.today.left} dk var!`,
      detail: now === 0 ? 'Bir tohum alıp ormanına dikebilirsin.' : `Artık ${STAGES[now].name.toLowerCase()} alabilirsin.`,
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
  const had = new Set(prev.badges.filter((x) => x.unlocked).map((x) => x.id));
  for (const badge of next.badges) {
    if (badge.unlocked && !had.has(badge.id)) {
      out.push({ kind: 'badge', icon: badge.icon, title: `Yeni rozet: ${badge.title}`, detail: badge.desc });
    }
  }
  return out;
}
