// Oyunlaştırma: hepsi mevcut kayıtlardan türetilir.
// Uzun vadeli ilerleme = her çalışılan günün ağacıyla dolan aylık bahçeler + çalıştıkça açılan haritalar + rozetler.
// Elmas, seri, seviye ve haritalar yalnızca sayaçla ölçülen (ve eski) kayıtlardan gelir; ağaçlar elle yazılan
// süreyle de dikilir (çocuk bazen sayaç tutmadan çalışır).
import { weekStart } from './date';
import { completedPlanDays } from './plan';
import { balances, chestsNow, dayTotalsOf, freezeDates, QUESTS, questsNow, trusted, type ChestState, type QuestState, type UnlockProgress } from './economy';
import { computeStreak } from './streak';
import { levelOf, skillsOf, type LevelInfo, type Skill } from './level';
import { CFG } from './config';
import { normalizeEquipped } from './avatar';
import { creaturesOf, dayTrees, mapsOf, roomsOf, type DayTree, type SpaceId, type SpaceLayout } from './world';
import {
  type WorldState,
  type Abandoned,
  type Book,
  type Course,
  type Equipped,
  type LedgerEntry,
  type OwnedItem,
  type PlanItem,
  type Reflection,
  type StudyLog,
} from './types';

export interface Badge {
  id: string;
  icon: string;
  title: string;
  desc: string;
  unlocked: boolean;
  progress: number; // 0–1
  hint?: string;
}

export interface GameInput {
  logs: StudyLog[];
  reflections: Reflection[];
  doneTasks: number;
  today: string;
  /** Günlük planlar (yoksa boş) */
  plans?: PlanItem[];
  /** Yarıda bırakılan seanslar: kuru ağaç (yoksa boş) */
  abandoned?: Abandoned[];
  // Oyun ekonomisi (0008 yoksa boş)
  ledger?: LedgerEntry[];
  owned?: OwnedItem[];
  /** Kayıttaki görünüş (eski biçim de olabilir) */
  equipped?: unknown;
  books?: Book[];
  courses?: Course[];
  /** Kayıtlı dünya alanları (0012 yoksa boş) */
  spaces?: Partial<Record<SpaceId, SpaceLayout>>;
  /** Kullanıcının haritası (0015 yoksa ilk harita) */
}

export interface GameStats {
  /** Kademeli seri: kaçırılan gün bir alt kademeye düşürür (streak.ts) */
  streak: number;
  /** Seri kademesi (0: yok) */
  streakTier: number;
  /** Seri var ama bugün henüz çalışılmadı → nazik hatırlatma */
  todayPending: boolean;
  bestStreak: number;
  /** Bugünün bütün kayıtları (elle yazılanlar dahil) */
  todayMinutes: number;
  /** Bütün kayıtlar (rapor ve geçmiş için) */
  totalMinutes: number;
  dayTotals: Map<string, number>;
  /** Sayaçla ölçülen (ve eski) toplam: seviye, haritalar ve kilitler buna göre */
  trustedMinutes: number;
  /** Her çalışılan günün ağacı (kuru dahil), eskiden yeniye */
  forest: DayTree[];
  /** Kuru olmayan ağaç (çalışılan gün) sayısı */
  treeCount: number;
  /** Arazi: bugünkü aşama (saatten türer), açılanlar, sıradaki */
  world: WorldState;
  maps: ReturnType<typeof mapsOf>;
  /** Seriyle açılan odalar (en iyi seriden) ve sıradaki */
  rooms: ReturnType<typeof roomsOf>;
  /** Bahçelere gelen canlılar */
  creatures: ReturnType<typeof creaturesOf>;
  booksDone: number;
  badges: Badge[];
  /** Planı tamamen bitirilmiş günler */
  planDays: string[];
  // ---------- Oyun ekonomisi ----------
  /** 💎 Elmas bakiyesi */
  crystals: number;
  /** Bugüne kadar toplanan ⭐ (harcanmaz) */
  stars: number;
  ledger: LedgerEntry[];
  owned: OwnedItem[];
  equipped: Equipped;
  spaces: Partial<Record<SpaceId, SpaceLayout>>;
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

export function computeStats({
  logs,
  reflections,
  doneTasks,
  today,
  plans = [],
  abandoned = [],
  ledger = [],
  owned = [],
  equipped = null,
  books = [],
  courses = [],
  spaces = {},
}: GameInput): GameStats {
  const dayTotals = new Map<string, number>();
  for (const l of logs) dayTotals.set(l.date, (dayTotals.get(l.date) ?? 0) + l.duration_minutes);
  const totalMinutes = logs.reduce((s, l) => s + l.duration_minutes, 0);
  const todayMinutes = dayTotals.get(today) ?? 0;
  const reflectionDays = reflections.filter((r) => r.rating != null || (r.note ?? '').trim()).length;

  // Seri, seviye ve orman yalnızca güvenilir kayıtlarla (elle yazılan süre sayılmaz)
  const ok = trusted(logs);
  const trustedTotals = dayTotalsOf(ok);
  const trustedMinutes = ok.reduce((s, l) => s + l.duration_minutes, 0);
  const first = [...trustedTotals.keys()].filter((d) => (trustedTotals.get(d) ?? 0) > 0).sort()[0] ?? null;
  const { streak, best: bestStreak, tier: streakTier, freezesLeft, bonus: streakBonus } = computeStreak((d) => trustedTotals.get(d) ?? 0, first, today, freezeDates(owned));

  const forest = dayTrees(logs, abandoned, new Set(streakBonus.keys()));
  const living = forest.filter((t) => !t.dry);
  const atLeast = (stage: number) => living.filter((t) => t.stageIndex >= stage).length;
  const perMonth = new Map<string, number>();
  living.forEach((t) => perMonth.set(t.month, (perMonth.get(t.month) ?? 0) + 1));

  const weekCourses = new Map<string, Set<string>>();
  for (const l of logs) {
    const w = weekStart(l.date);
    if (!weekCourses.has(w)) weekCourses.set(w, new Set());
    weekCourses.get(w)!.add(l.course_id);
  }
  const planDays = completedPlanDays(plans, logs).filter((d) => d <= today);
  const maxCoursesInWeek = Math.max(0, ...[...weekCourses.values()].map((s) => s.size));
  const maps = mapsOf(trustedMinutes);
  const ws: WorldState = { map: maps.current.id };
  const booksDone = books.filter((b) => b.status === 'done').length;
  const stages = CFG.world.stages;
  const species = new Set(living.map((t) => t.species.id)).size;

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
    b('plant1', '🌱', 'İlk Ağaç', 'Çalıştığın ilk gün bahçene ağaç dikilir', living.length, 1),
    b('streak3', '🔥', 'Isınma Turu', '3 günlük seri yap', bestStreak, 3),
    b('streak7', '⚡', 'Bir Hafta', '7 günlük seri yap', bestStreak, 7),
    b('streak30', '🏔️', 'Dağ Gibi', '30 günlük seri yap', bestStreak, 30),
    b('grove10', '🌳', 'Koru', 'Bahçelerinde 10 ağaç olsun', living.length, 10),
    b('big1', '🌳', 'Koca Ağaç', `Bir günde ${stages[3].min} dk çalışıp büyük ağaç dik`, atLeast(3), 1),
    b('giant1', '🌲', 'Dev', `Bir günde ${stages[4].min} dk çalışıp dev ağaç dik`, atLeast(4), 1),
    b('forester', '🏕️', 'Ormancı', '50 gün çalışıp 50 ağaç dik', living.length, 50),
    b('species8', '🌸', 'Botanikçi', '8 farklı türde ağacın olsun', species, 8),
    b('map2', '🗺️', 'Kâşif', 'İkinci haritayı aç', maps.unlocked.length, 2),
    b('feel7', '😊', 'Duygu Günlüğü', '7 gün "nasıl geçti" yaz', reflectionDays, 7),
    b('tasks10', '✅', 'Liste Avcısı', '10 görevi bitir', doneTasks, 10),
    b('variety', '🎨', 'Çok Yönlü', 'Bir haftada 3 farklı derse çalış', maxCoursesInWeek, 3),
    b('plan1', '📋', 'Planlı Gün', 'Bir günün planını tamamla', planDays.length, 1),
    b('plan10', '🗓️', 'Plan Ustası', '10 günün planını tamamla', planDays.length, 10),
    b('month15', '🌲', 'Gür Bahçe', 'Bir ayda 15 ağaç dik', Math.max(0, ...perMonth.values()), 15),
  ];

  const level = levelOf(trustedMinutes);
  const skills = skillsOf(courses, ok);
  const bal = balances(ledger);

  return {
    streak,
    streakTier,
    todayPending: streak > 0 && !((trustedTotals.get(today) ?? 0) > 0),
    bestStreak,
    todayMinutes,
    totalMinutes,
    dayTotals,
    trustedMinutes,
    forest,
    treeCount: living.length,
    world: ws,
    maps,
    rooms: roomsOf(bestStreak),
    creatures: creaturesOf(living.length),
    booksDone,
    badges,
    planDays,
    crystals: bal.crystal,
    stars: bal.star,
    ledger,
    owned,
    equipped: normalizeEquipped(equipped),
    spaces,
    quests: questsNow({ logs, plans, books, today }),
    chests: chestsNow(today, trustedTotals, owned),
    level,
    skills,
    unlock: {
      bestStreak,
      planDays: planDays.length,
      gold: skills.filter((k) => k.tier === 3).length,
      level: level.index,
      hours: trustedMinutes / 60,
      trees: living.length,
    },
    freezesLeft,
    starsToday: ledger
      .filter((e) => e.currency === 'star' && e.kind === 'star' && e.ref.startsWith(`${today}:`))
      .map((e) => Number(e.ref.split(':')[1])),
  };
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

export type Celebration = { kind: 'tree' | 'badge' | 'land' | 'streak'; title: string; detail: string; icon: string };

/** İki durum arasındaki kutlanacak gelişmeleri bulur. */
export function diffStats(prev: GameStats, next: GameStats): Celebration[] {
  const out: Celebration[] = [];
  // Bugünün ağacı: yeni dikildi ya da büyüdü
  const had = new Map(prev.forest.map((t) => [t.id, t]));
  for (const t of next.forest) {
    if (t.dry) continue;
    const was = had.get(t.id);
    if (!was || was.dry) {
      out.push({
        kind: 'tree',
        icon: t.icon,
        title: `Bugünün ağacı: ${t.name}!`,
        detail: `Bugün çalıştın, ${t.species.name.toLocaleLowerCase('tr-TR')} ağacın bu ayın bahçesine dikildi. Çalıştıkça büyüyecek.`,
      });
    } else if (t.stageIndex > was.stageIndex) {
      out.push({ kind: 'tree', icon: t.species.icon, title: `Ağacın büyüdü: ${t.name}!`, detail: `Bugün ${t.minutes} dk çalıştın.` });
    }
  }
  if (next.streak > prev.streak && next.streak >= 2 && prev.todayPending) {
    out.push({ kind: 'streak', icon: '🔥', title: `${next.streak} günlük seri!`, detail: 'Harika gidiyorsun.' });
  }
  // Dünya büyüdü: arazi genişledi, yeni canlı geldi
  const wasMap = new Set(prev.maps.unlocked.map((m) => m.id));
  for (const m of next.maps.unlocked) {
    if (!wasMap.has(m.id)) out.push({ kind: 'land', icon: m.icon, title: `Arazin genişledi: ${m.name}!`, detail: `${m.desc} Eşyaların yerinde duruyor.` });
  }
  const wasRoom = new Set(prev.rooms.unlocked.map((r) => r.id));
  for (const r of next.rooms.unlocked) {
    if (!wasRoom.has(r.id)) out.push({ kind: 'land', icon: r.icon, title: `Evinde yeni oda açıldı: ${r.name}!`, detail: `${r.streak} günlük seriyle kazandın, artık hep senin. ${r.desc}` });
  }
  const wasCreature = new Set(prev.creatures.map((c) => c.id));
  for (const c of next.creatures) {
    if (!wasCreature.has(c.id)) out.push({ kind: 'land', icon: c.icon, title: `Bahçene bir ${c.name.toLocaleLowerCase('tr-TR')} geldi!`, detail: 'Ağaçların çoğaldıkça yeni canlılar gelir.' });
  }
  // Yeni Elmas kazançları tek kutlamada
  const seen = new Set(prev.ledger.map((e) => e.id));
  const earned = next.ledger.filter((e) => !seen.has(e.id) && e.amount > 0 && e.kind !== 'star' && e.kind !== 'gift');
  const gems = earned.filter((e) => e.currency === 'crystal').reduce((sum, e) => sum + e.amount, 0);
  if (gems > 0) {
    const why = [...new Set(earned.map((e) => LEDGER_LABEL[e.kind]?.(e.ref)).filter(Boolean))].slice(0, 3).join(' · ');
    out.push({ kind: 'badge', icon: '💎', title: `+${gems} Elmas kazandın!`, detail: why || 'Çalıştıkça Elmas birikir.' });
  }
  if (next.level.index > prev.level.index) {
    out.push({ kind: 'land', icon: next.level.level.icon, title: `Seviye atladın: ${next.level.level.name}!`, detail: next.level.level.perk });
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
  const hadBadge = new Set(prev.badges.filter((x) => x.unlocked).map((x) => x.id));
  for (const badge of next.badges) {
    if (badge.unlocked && !hadBadge.has(badge.id)) {
      out.push({ kind: 'badge', icon: badge.icon, title: `Yeni rozet: ${badge.title}`, detail: badge.desc });
    }
  }
  return out;
}
