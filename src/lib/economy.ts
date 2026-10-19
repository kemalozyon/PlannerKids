// Oyun ekonomisi: 💎 Elmas yalnızca ders çalışarak kazanılır. Kazançları sunucu hesaplar ve deftere yazar
// (0010_economy_v2.sql → economy_sync); istemci deftere yazamaz. Buradaki saf fonksiyonlar aynı kuralları
// uygular: demo API ve ekrandaki ilerleme bunları kullanır. Bütün sayılar src/config/economy.json'da.
//
// Ders Elmas'ı, seri, sandık ve görevler yalnızca sayaçla ölçülen (timer) ve eski (legacy) kayıtları sayar. Sayaç
// dakikaları ayrıca canlı seans bonusu verir; elle yazılan süre (manual) düşük bir günlük tavanla Elmas verir;
// ailenin verdiği görevler bitince Elmas verir. Hepsi günlük tavanın (study.dailyCap) içinde. Bir günde çok uzun
// sayaçla çalışmak (world.drop) bir de nadir ağaç ödülü (eşya) verir.
//
// Ağaçtan talep (elmas.claim, 0036_tree_claim.sql): güne bağlı kazançlar (ders, canlı, elle, seri, plan, "nasıl
// geçti", günlük görev, aile görevi) claim.from gününden itibaren deftere kendiliğinden yazılmaz; o günün ağacında
// bekler ve çocuk Bahçem'de ağaca dokunup alınca yazılır (claim_day). Hiç kaybolmaz; alındıktan sonra o gün daha
// çok çalışılırsa yeni Elmas yine ağaçta birikir. Haftalık görevler ve kitaplar kendiliğinden gelir.
import { itemById, ITEMS, type Item, type UnlockKind } from './catalog';
import { CFG, type QuestConfig } from './config';
import { addDays, toLocalDate, weekStart } from './date';
import { rng } from './rng';
import { completedPlanDays } from './plan';
import { computeStreak } from './streak';
import type { Book, LedgerEntry, NewLedgerEntry, OwnedItem, PlanItem, Reflection, StudyLog, Task } from './types';

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

/** Günün sayaçla ölçülen dakikaları (canlı seans bonusu; eski kayıtlar sayılmaz) */
export function timerTotalsOf(logs: StudyLog[]): Map<string, number> {
  const m = new Map<string, number>();
  logs.filter((l) => l.source === 'timer').forEach((l) => m.set(l.date, (m.get(l.date) ?? 0) + l.duration_minutes));
  return m;
}

/** Günün elle yazılan dakikaları: yalnızca kayıt gününden en çok lateDays gün sonra yazılanlar (geçmişe toplu yazı
 *  Elmas vermez). Sunucu yazılma gününü UTC'ye göre alır (created_at::date). */
export function manualTotalsOf(logs: StudyLog[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) {
    if (l.source !== 'manual' || toLocalDate(new Date(l.created_at)) > addDays(l.date, E.manual.lateDays)) continue;
    m.set(l.date, (m.get(l.date) ?? 0) + l.duration_minutes);
  }
  return m;
}

/** Bir günün çalışma Elmas'ı: ders (güvenilir dakika), canlı seans bonusu (sayaç dakikası), elle yazılan süre;
 *  üçü birlikte en çok dailyCap (sırayla: önce ders, sonra bonus, sonra elle yazılan) */
export function dayElmas(date: string, trustedMin: number, timerMin: number, manualMin: number): { study: number; live: number; manual: number } {
  const cap = E.study.dailyCap;
  const study = studyElmas(trustedMin);
  const live = date >= E.live.from ? Math.max(0, Math.min(Math.floor(timerMin * E.live.bonus), cap - study)) : 0;
  const manual = date >= E.manual.from ? Math.max(0, Math.min(Math.floor(manualMin / E.manual.minutesPer), E.manual.capPerDay, cap - study - live)) : 0;
  return { study, live, manual };
}

/** Elmas kazandıran aile görevleri: bitmiş ve gününün ilk perDay aile görevi olan (oluşturulma sırasıyla). Sıra
 *  bitmemişleri de sayar: birini geri alıp başkasını bitirmek fazladan Elmas vermez. */
export function paidTasks(tasks: Task[], today: string): Task[] {
  const rank = new Map<string, number>();
  return tasks
    .filter((t) => t.from_parent && t.date <= addDays(today, 1))
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .filter((t) => {
      const n = (rank.get(t.date) ?? 0) + 1;
      rank.set(t.date, n);
      return t.done && n <= E.task.perDay;
    });
}

/** Günün dakikasından Elmas: kademeler (bugün her dakikaya 1; azalan getiri de kurulabilir), en fazla dailyCap */
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
  /** Aile görevleri için */
  tasks?: Task[];
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

/** En iyi seri (güvenilir kayıtlardan; seriyle açılan odalar için, sunucuda economy_best_streak) */
export function bestStreakOf(logs: StudyLog[], owned: OwnedItem[], today: string): number {
  const totals = dayTotalsOf(logs);
  const first = [...totals.keys()].filter((d) => d <= today && (totals.get(d) ?? 0) > 0).sort()[0] ?? null;
  return computeStreak((d) => totals.get(d) ?? 0, first, today, freezeDates(owned)).best;
}

/** Ağaçtan talep edilen ilk gün (öncesi kendiliğinden deftere yazılır) */
export const CLAIM_FROM = E.claim.from;

/** Kazanç; güne bağlıysa `day` (o günün ağacında bekler) */
export type Earned = NewLedgerEntry & { day?: string };

/** Ağaçta bekleyen kazanç mı (güne bağlı ve claim.from'dan sonra) */
export const claimable = (e: Earned) => !!e.day && e.day >= CLAIM_FROM;

/** Kayıtların hak ettirdiği bütün Elmas kazançları (geçmiş dahil). Hediye ve yıldızlar burada yok. */
export function earnedEntries(input: EconomyInput): Earned[] {
  const f = factsOf(input);
  const out: Earned[] = [];
  const add = (kind: NewLedgerEntry['kind'], ref: string, amount: number, day?: string) => amount > 0 && out.push({ currency: 'crystal', kind, ref, amount, ...(day ? { day } : {}) });
  const days = [...f.dayTotals.keys()].filter((d) => d <= f.today && (f.dayTotals.get(d) ?? 0) > 0).sort();
  const timer = timerTotalsOf(input.logs);
  const manual = manualTotalsOf(input.logs);
  for (const d of new Set([...days, ...[...manual.keys()].filter((d) => d <= f.today)])) {
    const e = dayElmas(d, f.dayTotals.get(d) ?? 0, timer.get(d) ?? 0, manual.get(d) ?? 0);
    add('study', d, e.study, d);
    add('live', d, e.live, d);
    add('manual', d, e.manual, d);
  }
  for (const t of paidTasks(input.tasks ?? [], f.today)) add('task', t.id, E.task.each, t.date);
  const streak = computeStreak((d) => f.dayTotals.get(d) ?? 0, days[0] ?? null, f.today, freezeDates(input.owned ?? []));
  for (const [d, b] of streak.bonus) add('streak', d, b, d);
  for (const d of f.planDays) add('plan', d, E.plan, d);
  for (const r of input.reflections ?? []) {
    if (r.date <= f.today && r.rating != null && (r.note ?? '').trim().length >= E.reflection.minNote && (f.dayTotals.get(r.date) ?? 0) > 0) {
      add('reflection', r.date, E.reflection.bonus, r.date);
    }
  }
  for (const b of bonusBooks(f.books, f.today)) add('book', b.id, E.book.bonus);
  // Görevler: her gün ve her hafta için (geçmiş haftalar da sayılır)
  const weeks = new Set([...days, ...f.books.map((b) => b.finished_on ?? '').filter((d) => d && d <= f.today)].map(weekStart));
  for (const q of QUESTS) {
    for (const period of q.scope === 'day' ? days : weeks) {
      if (questProgress(q.id, period, f) >= q.target) add('quest', `${q.id}:${period}`, q.reward, q.scope === 'day' ? period : undefined);
    }
  }
  return out;
}

const key = (e: Pick<NewLedgerEntry, 'currency' | 'kind' | 'ref'>) => `${e.currency}|${e.kind}|${e.ref}`;

/** Deftere kendiliğinden yazılacaklar: yeni kazançlar ve artanlar, ağaçta bekleyenler hariç (kazanç hiç azalmaz;
 *  sunucudaki economy_sync'in aynısı) */
export function pendingEarnings(ledger: LedgerEntry[], earned: Earned[]): Earned[] {
  const have = new Map(ledger.map((e) => [key(e), e.amount]));
  return earned.filter((e) => !claimable(e) && (have.get(key(e)) ?? 0) < e.amount);
}

/** Bir günün ağacından alınınca deftere yazılacaklar (claim_day) */
export function dayEarnings(ledger: LedgerEntry[], earned: Earned[], day: string): Earned[] {
  const have = new Map(ledger.map((e) => [key(e), e.amount]));
  return earned.filter((e) => claimable(e) && e.day === day && (have.get(key(e)) ?? 0) < e.amount);
}

/** Ağaçlarda bekleyen Elmas: gün → tutar (sunucuda economy_pending) */
export function treeElmasOf(ledger: LedgerEntry[], earned: Earned[]): Map<string, number> {
  const have = new Map(ledger.map((e) => [key(e), e.amount]));
  const out = new Map<string, number>();
  for (const e of earned) {
    if (!claimable(e)) continue;
    const gain = e.amount - (have.get(key(e)) ?? 0);
    if (gain > 0) out.set(e.day!, (out.get(e.day!) ?? 0) + gain);
  }
  return out;
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
export const inChestPool = (i: Item) => i.acquire.kind === 'chest' || (i.category === 'dis' && i.acquire.kind === 'buy');

/** Sandıktan çıkacak eşya: haftaya göre sabit (yeniden açınca değişmez). Sandığa özel eşyalar + Elmasla alınan dış mekân süsleri
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

// ---------- Nadir ağaç ödülü ----------
const DROP = CFG.world.drop;
export const DROP_MINUTES = DROP.minutes;

export interface DropState {
  date: string;
  /** Günün güvenilir (sayaç + eski) dakikaları */
  minutes: number;
  opened: boolean;
}

/** Yalnızca nadir ağaç gününden çıkan eşyalar (items.json → drop; sunucu item_defs.def->>'drop') */
export const inDropPool = (i: Item) => i.acquire.kind === 'drop';

/** Ödül hak edilen günler: from gününden beri en az DROP_MINUTES güvenilir dakika (elle yazılan sayılmaz), eskiden yeniye */
export function dropsOf(dayTotals: Map<string, number>, owned: OwnedItem[], today: string): DropState[] {
  const out: DropState[] = [];
  for (const [date, minutes] of dayTotals) {
    if (minutes >= DROP_MINUTES && date >= DROP.from && date <= addDays(today, 1)) {
      out.push({ date, minutes, opened: owned.some((o) => o.via === 'drop' && o.ref === date) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Günün ödülü: tarihe göre sabit; önce henüz sende olmayan nadir eşyalar, hepsi sendeyse herhangi biri (bir tane daha) */
export function dropPrize(date: string, owned: OwnedItem[]): Item {
  const have = new Set(owned.map((o) => o.item_id));
  const all = ITEMS.filter(inDropPool);
  const fresh = all.filter((i) => !have.has(i.id));
  const pool = fresh.length ? fresh : all;
  const total = pool.reduce((s, i) => s + WEIGHT[i.rarity], 0);
  let pick = rng(`nadir:${date}`)() * total;
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
  /** Toplam (güvenilir) çalışma saati */
  hours: number;
  /** Ağaç sayısı: çalışılan gün */
  trees: number;
}

export function unlockValue(by: UnlockKind, p: UnlockProgress): number {
  return { streak: p.bestStreak, plans: p.planDays, gold: p.gold, level: p.level, hours: p.hours, trees: p.trees }[by];
}

export function owns(item: Item, owned: OwnedItem[], p: UnlockProgress): boolean {
  const a = item.acquire;
  if (a.kind === 'free') return true;
  if (a.kind === 'unlock') return unlockValue(a.by, p) >= a.target;
  return owned.some((o) => o.item_id === item.id);
}

/**
 * Bir eşyadan kaç tane yerleştirilebilir (sunucuda world_owned): satılan/sandık/nadir ağaç eşyası sahip olunan adet;
 * başarıyla açılan açıldıysa 1; ücretsiz başlangıç eşyası 1, ücretsiz kaplama sınırsız.
 */
export function ownedCount(item: Item, owned: OwnedItem[], p: UnlockProgress): number {
  const a = item.acquire;
  if (a.kind === 'buy' || a.kind === 'chest' || a.kind === 'drop') return owned.filter((o) => o.item_id === item.id).length;
  if (a.kind === 'unlock') return ['hours', 'level', 'trees'].includes(a.by) && unlockValue(a.by, p) >= a.target ? 1 : 0;
  return item.placement ? 1 : Infinity;
}

/** Kilitli eşyanın nasıl açılacağı */
export function unlockHint(item: Item): string {
  const a = item.acquire;
  if (a.kind === 'chest') return '📦 Yalnızca haftalık sandıktan';
  if (a.kind === 'drop') return `🌟 Yalnızca nadir ağaç gününden: bir günde ${DROP_MINUTES} dk sayaçla çalış`;
  if (a.kind !== 'unlock') return '';
  if (a.by === 'streak') return `🔥 ${a.target} günlük seri yap`;
  if (a.by === 'plans') return `📋 ${a.target} günün planını tamamla`;
  if (a.by === 'gold') return a.target === 1 ? '🥇 Bir derste altına ulaş' : `🥇 ${a.target} derste altına ulaş`;
  if (a.by === 'hours') return `⏱️ Toplam ${a.target} saat çalış`;
  if (a.by === 'trees') return item.category === 'evcil' ? `🌳 Bahçelerinde ${a.target} ağaç olunca kendiliğinden gelir` : `🌳 Bahçelerinde ${a.target} ağaç olsun`;
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
