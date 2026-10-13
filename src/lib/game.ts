// Oyunlaştırma: hepsi mevcut kayıtlardan türetilir.
// Uzun vadeli ilerleme = aylık ormanlar + seriyle açılan ağaç türleri + rozetler.
import { weekStart } from './date';
import { SPECIES, STAGES, monthOf, pickFreeCell, priceOf, stageIndex } from './forest';
import { BIOMES, islandProgress } from './island';
import { completedPlanDays } from './plan';
import { balances, chestsNow, dayTotalsOf, freezeDates, QUESTS, questsNow, type ChestState, type QuestState, type UnlockProgress } from './economy';
import { computeStreak } from './streak';
import { levelOf, skillsOf, type LevelInfo, type Skill } from './level';
import {
  DEFAULT_EQUIPPED,
  type Abandoned,
  type Book,
  type Course,
  type Equipped,
  type ForestTree,
  type LedgerEntry,
  type OwnedItem,
  type Placement,
  type PlanItem,
  type Reflection,
  type StudyLog,
} from './types';
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
  // Oyun ekonomisi (0008 yoksa boş)
  ledger?: LedgerEntry[];
  owned?: OwnedItem[];
  placements?: Placement[];
  equipped?: Equipped | null;
  books?: Book[];
  courses?: Course[];
}

export interface GameStats {
  /** Kademeli seri: kaçırılan gün bir alt kademeye düşürür (streak.ts) */
  streak: number;
  /** Seri kademesi (0: yok) ve o kademenin günlük bonusu */
  streakTier: number;
  /** Seri var ama bugün henüz çalışılmadı → nazik hatırlatma */
  todayPending: boolean;
  bestStreak: number;
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
  // ---------- Oyun ekonomisi ----------
  /** 💎 Elmas bakiyesi */
  crystals: number;
  /** Bugüne kadar toplanan ⭐ (harcanmaz) */
  stars: number;
  ledger: LedgerEntry[];
  owned: OwnedItem[];
  placements: Placement[];
  equipped: Equipped;
  /** Bugünün ve bu haftanın görevleri */
  quests: QuestState[];
  /** Geçen hafta ve bu hafta */
  chests: ChestState[];
  level: LevelInfo;
  skills: Skill[];
  /** Başarıyla açılan eşyalar için ilerleme */
  unlock: UnlockProgress;
  /** Kullanılmamış seri dondurma */
  freezesLeft: number;
  /** Bugün toplanan yıldızların sırası (0–7) */
  starsToday: number[];
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

export function computeStats({
  logs,
  reflections,
  trees,
  doneTasks,
  today,
  plans = [],
  abandoned = [],
  ledger = [],
  owned = [],
  placements = [],
  equipped = null,
  books = [],
  courses = [],
}: GameInput): GameStats {
  const dayTotals = new Map<string, number>();
  for (const l of logs) dayTotals.set(l.date, (dayTotals.get(l.date) ?? 0) + l.duration_minutes);
  const totalMinutes = logs.reduce((s, l) => s + l.duration_minutes, 0);
  const todayMinutes = dayTotals.get(today) ?? 0;
  const reflectionDays = reflections.filter((r) => r.rating != null || (r.note ?? '').trim()).length;

  const studied = (d: string) => (dayTotals.get(d) ?? 0) > 0;
  // Seri ve ekonomi yalnızca güvenilir kayıtlarla (elle yazılan süre sayılmaz)
  const trustedTotals = dayTotalsOf(logs);
  const first = [...trustedTotals.keys()].filter((d) => (trustedTotals.get(d) ?? 0) > 0).sort()[0] ?? null;
  const { streak, best: bestStreak, tier: streakTier, freezesLeft } = computeStreak((d) => trustedTotals.get(d) ?? 0, first, today, freezeDates(owned));

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
  const level = levelOf(totalMinutes);
  const skills = skillsOf(courses, logs);
  const bal = balances(ledger);

  return {
    streak,
    streakTier,
    todayPending: streak > 0 && !studied(today),
    bestStreak,
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
    crystals: bal.crystal,
    stars: bal.star,
    ledger,
    owned,
    placements,
    equipped: equipped ?? DEFAULT_EQUIPPED,
    quests: questsNow({ logs, plans, books, today }),
    chests: chestsNow(today, trustedTotals, owned),
    level,
    skills,
    unlock: { bestStreak, planDays: planDays.length, gold: skills.filter((k) => k.tier === 3).length, level: level.index },
    freezesLeft,
    starsToday: ledger
      .filter((e) => e.currency === 'star' && e.kind === 'star' && e.ref.startsWith(`${today}:`))
      .map((e) => Number(e.ref.split(':')[1])),
  };
}

function countByMonth(trees: ForestTree[]) {
  const m = new Map<string, number>();
  trees.forEach((t) => m.set(t.month, (m.get(t.month) ?? 0) + 1));
  return m;
}

/** Elmas kazancının kısa açıklaması (kutlamada ve aile panelinde) */
export const LEDGER_LABEL: Partial<Record<LedgerEntry['kind'], (ref: string) => string>> = {
  study: () => 'Ders çalıştın',
  streak: () => 'Serin sürüyor',
  reflection: () => 'Gününü değerlendirdin',
  plan: () => 'Planını tamamladın',
  book: () => 'Kitap bitirdin',
  quest: (ref) => QUESTS.find((q) => q.id === ref.split(':')[0])?.title ?? 'Görev',
  gift: () => 'Aile hediyesi',
};

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
  // Yeni Elmas kazançları tek kutlamada
  const seen = new Set(prev.ledger.map((e) => e.id));
  const fresh = next.ledger.filter((e) => !seen.has(e.id) && e.amount > 0 && e.kind !== 'star' && e.kind !== 'gift');
  const gems = fresh.filter((e) => e.currency === 'crystal').reduce((sum, e) => sum + e.amount, 0);
  if (gems > 0) {
    const why = [...new Set(fresh.map((e) => LEDGER_LABEL[e.kind]?.(e.ref)).filter(Boolean))].slice(0, 3).join(' · ');
    out.push({ kind: 'badge', icon: '💎', title: `+${gems} Elmas kazandın!`, detail: why || 'Çalıştıkça Elmas birikir.' });
  }
  if (next.level.index > prev.level.index) {
    out.push({ kind: 'species', icon: next.level.level.icon, title: `Seviye atladın: ${next.level.level.name}!`, detail: next.level.level.perk });
  }
  for (const k of next.skills) {
    const was = prev.skills.find((x) => x.course.id === k.course.id)?.tier ?? 0;
    if (k.tier > was && k.tier >= 1) {
      const t = ['', 'Bronz', 'Gümüş', 'Altın'][k.tier];
      out.push({ kind: 'badge', icon: ['', '🥉', '🥈', '🥇'][k.tier], title: `${k.course.name}: ${t} ${k.title}!`, detail: k.tier === 3 ? 'Yeni bir karakter açıldı olabilir, dükkâna bak.' : 'Bu derse çalıştıkça unvanın parlar.' });
    }
  }
  const readyNow = next.chests.find((c) => c.ready && !c.opened);
  if (readyNow && !prev.chests.some((c) => c.week === readyNow.week && c.ready)) {
    out.push({ kind: 'badge', icon: '📦', title: 'Haftalık sandığın hazır!', detail: 'Bugün ekranından açabilirsin.' });
  }
  const had = new Set(prev.badges.filter((x) => x.unlocked).map((x) => x.id));
  for (const badge of next.badges) {
    if (badge.unlocked && !had.has(badge.id)) {
      out.push({ kind: 'badge', icon: badge.icon, title: `Yeni rozet: ${badge.title}`, detail: badge.desc });
    }
  }
  return out;
}
