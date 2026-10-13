// Oyun ekonomisi: 💎 Elmas yalnızca ders çalışarak kazanılır. Kazançları sunucu hesaplar ve deftere yazar
// (0010_economy_v2.sql → economy_sync); istemci deftere yazamaz. Buradaki saf fonksiyonlar aynı kuralları
// uygular: demo API ve ekrandaki ilerleme bunları kullanır. Bütün sayılar src/config/economy.json'da.
//
// Yalnızca sayaçla ölçülen (timer) ve eski (legacy) kayıtlar sayılır; elle yazılan süre (manual) Elmas vermez.
import { itemById, ITEMS, type Item } from './catalog';
import { CFG, type QuestConfig } from './config';
import { addDays, toLocalDate, weekStart } from './date';
import { rng } from './island';
import { completedPlanDays } from './plan';
import { computeStreak } from './streak';
import type { Book, LedgerEntry, NewLedgerEntry, OwnedItem, PlanItem, Reflection, StudyLog } from './types';

const E = CFG.elmas;
export const GIFT_MAX = E.giftMax;
/** Günde saklanan yıldız sayısı (explore.ts → dailyStars) */
export const STARS_PER_DAY = CFG.stars.perDay;
/** Haftalık sandık hedefi */
export const CHEST_DAYS = CFG.chest.days;
export const CHEST_MINUTES = CFG.chest.minutes;

export type QuestDef = QuestConfig;
/** Görevler yalnızca ders hedefleridir ve yalnızca Elmas verir */
export const QUESTS: QuestDef[] = E.quests;

/** Elmas ve seri hesabına giren kayıtlar: sayaçla ölçülenler ve eski kayıtlar */
export const trusted = (logs: StudyLog[]) => logs.filter((l) => l.source !== 'manual');

/** Günün güvenilir dakikaları */
export function dayTotalsOf(logs: StudyLog[]): Map<string, number> {
  const m = new Map<string, number>();
  trusted(logs).forEach((l) => m.set(l.date, (m.get(l.date) ?? 0) + l.duration_minutes));
  return m;
}

/** Günün dakikasından Elmas: kademeler azalan getiriyle (ilk saat 10 dk = 1, sonra 20, sonra 30), en fazla dailyCap */
export function studyElmas(minutes: number, study = E.study): number {
  let prev = 0;
  let total = 0;
  for (const t of study.tiers) {
    total += Math.floor(Math.max(0, Math.min(minutes, t.upTo) - prev) / t.minutesPer);
    prev = t.upTo;
  }
  return Math.min(total, study.dailyCap);
}

export interface EconomyInput {
  logs: StudyLog[];
  plans: PlanItem[];
  books: Book[];
  reflections?: Reflection[];
  /** Seri dondurmalar için */
  owned?: OwnedItem[];
  today: string;
}

/** Kayıtlardan hesaplanan, görevlerin ve kazançların ortak verisi */
interface Facts {
  dayTotals: Map<string, number>;
  planDays: string[];
  logs: StudyLog[];
  books: Book[];
  today: string;
}

function factsOf({ logs, plans, books, today }: EconomyInput): Facts {
  const ok = trusted(logs);
  return { dayTotals: dayTotalsOf(ok), planDays: completedPlanDays(plans, ok).filter((d) => d <= today), logs: ok, books, today };
}

const inWeek = (d: string, monday: string) => d >= monday && d <= addDays(monday, 6);

/** Bir görevin bir gün/hafta için ilerlemesi */
function questProgress(id: string, period: string, f: Facts): number {
  switch (id) {
    case 'day30':
      return f.dayTotals.get(period) ?? 0;
    case 'week5days':
      return [...f.dayTotals].filter(([d, m]) => m > 0 && inWeek(d, period)).length;
    case 'week3plans':
      return f.planDays.filter((d) => inWeek(d, period)).length;
    case 'week3courses':
      return new Set(f.logs.filter((l) => inWeek(l.date, period)).map((l) => l.course_id)).size;
    case 'weekBook':
      return f.books.filter((b) => b.finished_on && inWeek(b.finished_on, period)).length;
  }
  return 0;
}

/** Seri dondurmaların satın alındığı günler */
export const freezeDates = (owned: OwnedItem[]) => owned.filter((o) => o.item_id === 'freeze').map((o) => toLocalDate(new Date(o.created_at)));

/** Kitap bonusu alan kitaplar: her hafta (bitiş tarihine göre) ilk perWeek kitap */
function bonusBooks(books: Book[], today: string): Book[] {
  const done = books
    .filter((b) => b.finished_on && b.finished_on <= today)
    .sort((a, b) => a.finished_on!.localeCompare(b.finished_on!) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const perWeek = new Map<string, number>();
  return done.filter((b) => {
    const w = weekStart(b.finished_on!);
    const n = (perWeek.get(w) ?? 0) + 1;
    perWeek.set(w, n);
    return n <= E.book.perWeek;
  });
}

/** Kayıtların hak ettirdiği bütün Elmas kazançları (geçmiş dahil). Hediye ve yıldızlar burada yok. */
export function earnedEntries(input: EconomyInput): NewLedgerEntry[] {
  const f = factsOf(input);
  const out: NewLedgerEntry[] = [];
  const add = (kind: NewLedgerEntry['kind'], ref: string, amount: number) => amount > 0 && out.push({ currency: 'crystal', kind, ref, amount });
  const days = [...f.dayTotals.keys()].filter((d) => d <= f.today && (f.dayTotals.get(d) ?? 0) > 0).sort();
  for (const d of days) add('study', d, studyElmas(f.dayTotals.get(d)!));
  const streak = computeStreak((d) => f.dayTotals.get(d) ?? 0, days[0] ?? null, f.today, freezeDates(input.owned ?? []));
  for (const [d, b] of streak.bonus) add('streak', d, b);
  for (const d of f.planDays) add('plan', d, E.plan);
  for (const r of input.reflections ?? []) {
    if (r.date <= f.today && r.rating != null && (r.note ?? '').trim().length >= E.reflection.minNote && (f.dayTotals.get(r.date) ?? 0) > 0) {
      add('reflection', r.date, E.reflection.bonus);
    }
  }
  for (const b of bonusBooks(f.books, f.today)) add('book', b.id, E.book.bonus);
  // Görevler: her gün ve her hafta için (geçmiş haftalar da sayılır)
  const weeks = new Set([...days, ...f.books.map((b) => b.finished_on ?? '').filter((d) => d && d <= f.today)].map(weekStart));
  for (const q of QUESTS) {
    for (const period of q.scope === 'day' ? days : weeks) {
      if (questProgress(q.id, period, f) >= q.target) add('quest', `${q.id}:${period}`, q.reward);
    }
  }
  return out;
}

const key = (e: Pick<NewLedgerEntry, 'currency' | 'kind' | 'ref'>) => `${e.currency}|${e.kind}|${e.ref}`;

/** Deftere yazılacaklar: yeni kazançlar ve artanlar (kazanç hiç azalmaz; sunucudaki economy_sync'in aynısı) */
export function pendingEarnings(ledger: LedgerEntry[], earned: NewLedgerEntry[]): NewLedgerEntry[] {
  const have = new Map(ledger.map((e) => [key(e), e.amount]));
  return earned.filter((e) => (have.get(key(e)) ?? 0) < e.amount);
}

/** 💎 bakiye ve ⭐ toplanan yıldız sayısı */
export function balances(ledger: LedgerEntry[]): { crystal: number; star: number } {
  const b = { crystal: 0, star: 0 };
  ledger.forEach((e) => (b[e.currency] += e.amount));
  return b;
}

export interface QuestState extends QuestDef {
  ref: string;
  progress: number;
  done: boolean;
}

/** Bugünün ve bu haftanın görevleri */
export function questsNow(input: EconomyInput): QuestState[] {
  const f = factsOf(input);
  const week = weekStart(input.today);
  return QUESTS.map((q) => {
    const period = q.scope === 'day' ? input.today : week;
    const progress = questProgress(q.id, period, f);
    return { ...q, ref: `${q.id}:${period}`, progress: Math.min(progress, q.target), done: progress >= q.target };
  });
}

// ---------- Haftalık sandık ----------
export interface ChestState {
  week: string;
  days: number;
  minutes: number;
  ready: boolean;
  opened: boolean;
}

export function chestOf(week: string, dayTotals: Map<string, number>, owned: OwnedItem[]): ChestState {
  let days = 0;
  let minutes = 0;
  for (let i = 0; i < 7; i++) {
    const m = dayTotals.get(addDays(week, i)) ?? 0;
    if (m > 0) days++;
    minutes += m;
  }
  return {
    week,
    days,
    minutes,
    ready: days >= CHEST_DAYS && minutes >= CHEST_MINUTES,
    opened: owned.some((o) => o.via === 'chest' && o.ref === week),
  };
}

/** Bu hafta ve geçen hafta: hedefi tutup açılmamış sandıklar en önde */
export function chestsNow(today: string, dayTotals: Map<string, number>, owned: OwnedItem[]): ChestState[] {
  const thisWeek = weekStart(today);
  return [addDays(thisWeek, -7), thisWeek].map((w) => chestOf(w, dayTotals, owned));
}

const WEIGHT = { yaygin: 6, nadir: 3, efsanevi: 1 } as const;

/** Sandıktan çıkabilen eşyalar */
export const inChestPool = (i: Item) => i.acquire.kind === 'chest' || (i.category === 'yapi' && i.acquire.kind === 'buy');

/** Sandıktan çıkacak eşya: haftaya göre sabit (yeniden açınca değişmez). Sandığa özel eşyalar + Elmasla alınan yapılar
 * (sunucu item_defs.in_chest ile aynı havuzu denetler). */
export function chestPrize(week: string, owned: OwnedItem[]): Item {
  const have = new Set(owned.map((o) => o.item_id));
  const pool = ITEMS.filter((i) => inChestPool(i) && (i.acquire.kind !== 'chest' || i.repeat || !have.has(i.id)));
  const total = pool.reduce((s, i) => s + WEIGHT[i.rarity], 0);
  let pick = rng(`sandik:${week}`)() * total;
  for (const i of pool) {
    pick -= WEIGHT[i.rarity];
    if (pick < 0) return i;
  }
  return pool[pool.length - 1];
}

// ---------- Sahiplik ----------
/** Başarıyla açılan eşyalar için ilerleme */
export interface UnlockProgress {
  bestStreak: number;
  planDays: number;
  /** Altın seviyedeki ders sayısı */
  gold: number;
  /** Seviye sırası (level.ts) */
  level: number;
}

export function unlockValue(by: 'streak' | 'plans' | 'gold' | 'level', p: UnlockProgress): number {
  return by === 'streak' ? p.bestStreak : by === 'plans' ? p.planDays : by === 'gold' ? p.gold : p.level;
}

export function owns(item: Item, owned: OwnedItem[], p: UnlockProgress): boolean {
  const a = item.acquire;
  if (a.kind === 'free') return true;
  if (a.kind === 'unlock') return unlockValue(a.by, p) >= a.target;
  return owned.some((o) => o.item_id === item.id);
}

/** Kilitli eşyanın nasıl açılacağı */
export function unlockHint(item: Item): string {
  const a = item.acquire;
  if (a.kind === 'chest') return '📦 Yalnızca haftalık sandıktan';
  if (a.kind !== 'unlock') return '';
  if (a.by === 'streak') return `🔥 ${a.target} günlük seri yap`;
  if (a.by === 'plans') return `📋 ${a.target} günün planını tamamla`;
  if (a.by === 'gold') return a.target === 1 ? '🥇 Bir derste altına ulaş' : `🥇 ${a.target} derste altına ulaş`;
  return `⭐ ${['Çırak', 'Kâşif', 'Orman Bekçisi', 'Bahçıvan', 'Orman Ustası', 'Orman Bilgesi', 'Efsane'][a.target]} seviyesine ulaş`;
}

/** Satın alınabilir mi; değilse nedeni */
export function buyCheck(itemId: string, elmas: number, owned: OwnedItem[], unusedFreezes: number): string | null {
  const item = itemById(itemId);
  if (!item || item.acquire.kind !== 'buy') return 'Bu eşya satılmıyor.';
  if (!item.repeat && owned.some((o) => o.item_id === itemId)) return 'Bu eşya zaten sende.';
  if (item.id === 'freeze' && unusedFreezes >= CFG.freeze.max) return `En fazla ${CFG.freeze.max} dondurma biriktirebilirsin.`;
  const { price } = item.acquire;
  if (elmas < price) return `${price - elmas} 💎 daha lazım. Çalıştıkça Elmas kazanırsın!`;
  return null;
}
