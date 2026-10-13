// Uygulamanın saf mantığı: seri, cüzdan, orman, plan, ödül, okuma ve iki API katmanı.
// Çalıştırma: npm test (scripts/resolve-ts.mjs uzantısız importları çözer).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localApi, supabaseApi, type DemoDb } from './api';
import { addDays, formatMinutes, weekStart } from './date';
import { ITEMS, itemById } from './catalog';
import { balances, buyCheck, chestOf, chestPrize, dayTotalsOf, earnedEntries, inChestPool, owns, pendingEarnings, questsNow, studyElmas } from './economy';
import { CFG, ITEM_DEFS } from './config';
import { activeMs, beat, newSession, noteProblem, pause, resume, sessionMinutes, shownMs } from './session';
import { computeStreak, dropTier } from './streak';
import { renderConfigSql } from '../../scripts/config-sql.mjs';
import economyJson from '../config/economy.json' with { type: 'json' };
import itemsJson from '../config/items.json' with { type: 'json' };
import { levelOf, perksOf, skillsOf, skillTitle } from './level';
import { dailyStars, moveDir, nearest, resolveMove, standable, STAR_COUNT } from './explore';
import { computeStats, diffStats } from './game';
import {
  blockedTiles,
  canPlaceAt,
  creaturesOf,
  DEFAULT_ROOM,
  findPath,
  fixedTiles,
  footprint,
  forestOf,
  landsOf,
  layoutProblem,
  outdoorBlocked,
  outdoorMap,
  regionLayout,
  regionSize,
  spaceSize,
  treeKind,
  type SpaceLayout,
} from './world';
import { TREE_NAMES } from '../../supabase/functions/_shared/report';
import { estimateWords, SCENES, sceneEnd, wordAt } from './tour';
import { wordsFromAlignment } from '../../scripts/demo-words.mjs';
import { applyTemplate, dayPlan, TEMPLATES } from './plan';
import { computeReading } from './reading';
import { openRewards, rewardProgress } from './rewards';
import { DEFAULT_READING_GOALS, type Abandoned, type Book, type LedgerEntry, type OwnedItem, type PlanItem, type Reflection, type Reward, type StudyLog } from './types';

// 2026-10-12 pazartesi
const MON = '2026-10-12';
const log = (date: string, min: number, course = 'mat'): StudyLog => ({
  id: `${date}-${course}-${min}`,
  course_id: course,
  date,
  duration_minutes: min,
  note: null,
  created_at: '',
});
/** Verilen günlerde 30 dk çalışılmış */
const set = (...days: string[]) => (d: string) => (days.includes(d) ? 30 : 0);

test('tarih: hafta pazartesi başlar, süre biçimi', () => {
  assert.equal(weekStart('2026-10-18'), MON); // pazar → önceki pazartesi
  assert.equal(weekStart(MON), MON);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(formatMinutes(0), '0 dk');
  assert.equal(formatMinutes(125), '2 sa 5 dk');
});

test('seri: hafta sonu ve bugün seriyi bozmaz', () => {
  // 5–9 Ekim pzt–cum çalışıldı, hafta sonu boş, bugün (pzt) henüz boş
  const s = computeStreak(set('2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'), '2026-10-05', MON);
  assert.equal(s.streak, 5);
  assert.equal(s.best, 5);
});

test('seri: kaçırılan hafta içi günü sıfırlamaz, bir kademe düşürür; kademe günlük Elmas verir', () => {
  assert.deepEqual([2, 3, 7, 10, 14, 30, 45].map((r) => dropTier(r)), [0, 0, 3, 3, 7, 14, 14]);
  // 21 Eyl – 2 Eki iki tam iş haftası (seri 10), 5 Eki pzt kaçtı → 3; 6–9 Eki çalışıldı → 7
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
  const s = computeStreak(set(...days), days[0], '2026-10-09');
  assert.equal(s.streak, 7);
  assert.equal(s.best, 10);
  assert.equal(s.tier, 2);
  assert.deepEqual(
    [...s.bonus].map(([d, b]) => `${d.slice(5)}:${b}`).join(' '),
    '09-23:1 09-24:1 09-25:1 09-28:1 09-29:2 09-30:2 10-01:2 10-02:2 10-06:1 10-07:1 10-08:1 10-09:2',
  );
  // Kısa gün (20 dk'dan az) seriyi sürdürür ama bonus vermez
  const short = computeStreak((d) => (d === '2026-09-23' ? 15 : set(...days)(d)), days[0], '2026-10-09');
  assert.equal(short.streak, 7);
  assert.equal(short.bonus.has('2026-09-23'), false);
  // İki günlük seri bir kaçırmada 0'a iner
  assert.equal(computeStreak(set('2026-10-05', '2026-10-06', '2026-10-08'), '2026-10-05', '2026-10-08').streak, 1);
});

test('istatistik + kutlama: her seans bir ağaç, elle yazılan ağaç vermez; yeni arazi kutlanır', () => {
  const base = { reflections: [], doneTasks: 0, today: MON };
  const l = (id: string, min: number, extra: Partial<StudyLog> = {}): StudyLog => ({ ...log(MON, min), id, created_at: `${MON}T1${id.length}:00:00Z`, ...extra });
  const before = computeStats({ ...base, logs: [l('a', 20)] });
  const after = computeStats({ ...base, logs: [l('a', 20), l('bb', 50)] });
  assert.deepEqual(after.forest.map((t) => t.kind), ['cali', 'cam']);
  assert.equal(after.treeCount, 2);
  const c = diffStats(before, after).find((x) => x.kind === 'tree')!;
  assert.match(c.title, /Yeni ağaç: Çam/);
  const manual = computeStats({ ...base, logs: [l('a', 20), l('m', 90, { source: 'manual' })] });
  assert.equal(manual.treeCount, 1);
  assert.equal(manual.todayMinutes, 110);
  assert.equal(manual.trustedMinutes, 20);
  assert.deepEqual(diffStats(before, manual).filter((x) => x.kind === 'tree'), []);
  // 5 saatte dere açılır
  const big = computeStats({ ...base, logs: Array.from({ length: 5 }, (_, i) => l(`x${i}`, 60)) });
  assert.ok(diffStats(before, big).some((x) => x.kind === 'land' && /Dere/.test(x.title)));
  // Yarım seans kuru ağaç
  const dry = computeStats({ ...base, logs: [l('a', 20)], abandoned: [{ id: 'y', date: MON, minutes: 12, created_at: `${MON}T09:00:00Z` }] });
  assert.deepEqual(dry.forest.map((t) => [t.kind, t.dry]), [['kuru', true], ['cali', false]]);
  assert.equal(dry.treeCount, 1);
});

test('plan: her ders kendi planıyla sınırlı sayılır, onay bekleyen işaretlenir', () => {
  const plans: PlanItem[] = [
    { id: '1', date: MON, course_id: 'mat', minutes: 30, note: null, approved: true },
    { id: '2', date: MON, course_id: 'tr', minutes: 20, note: null, approved: false },
  ];
  const p = dayPlan(MON, plans, [log(MON, 50, 'mat'), log(MON, 10, 'tr')])!;
  assert.equal(p.planned, 50);
  assert.equal(p.done, 40); // matematik 50 değil 30 sayılır
  assert.equal(p.complete, false);
  assert.equal(p.pending, true);
  assert.equal(p.rows[0].item.course_id, 'tr'); // bitmeyen üstte
  assert.equal(dayPlan('2026-10-13', plans, []), null);
});

test('plan şablonu: okul haftası hafta içi 4 derse 20 dk, pazar boş', () => {
  const courses = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, color: '#000', created_at: '' }));
  const items = applyTemplate(TEMPLATES.find((t) => t.id === 'okul')!, MON, courses);
  assert.equal(items.filter((i) => i.date === MON).length, 4);
  assert.ok(items.every((i) => i.minutes > 0));
  assert.equal(items.filter((i) => i.date === '2026-10-18').length, 0);
});

test('ödül: başlangıç gününden itibaren sayar, verilenler listede yok', () => {
  const r = (over: Partial<Reward>): Reward => ({
    id: 'r',
    title: 'Sinema',
    kind: 'minutes',
    target: 100,
    given_by: null,
    start_date: '2026-10-10',
    claimed_on: null,
    created_at: '',
    ...over,
  });
  const x = { dayTotals: new Map([['2026-10-09', 500], ['2026-10-11', 60], [MON, 60]]), streak: 3, books: [] as Book[], planDays: [] };
  const p = rewardProgress(r({}), x);
  assert.equal(p.value, 100);
  assert.equal(p.reached, true);
  assert.equal(rewardProgress(r({ target: 200 }), x).leftText, '80 dk kaldı');
  assert.equal(openRewards([r({ claimed_on: MON })], x).length, 0);
});

test('okuma: bugünün sayfaları ve bu ay biten kitaplar', () => {
  const book: Book = {
    id: 'b',
    title: 'K',
    author: null,
    pages: 120,
    genre: 'Macera',
    recommended_by: null,
    color: '#000',
    status: 'done',
    current_page: 120,
    started_on: '2026-10-01',
    finished_on: MON,
    rating: 5,
    fav_character: null,
    review: null,
    created_at: '',
  };
  const logs = [{ id: 'l', book_id: 'b', date: MON, minutes: 15, pages: 20, to_page: 120, created_at: '' }];
  const s = computeReading([book], logs, DEFAULT_READING_GOALS, MON);
  assert.equal(s.todayPages, 20);
  assert.equal(s.monthDone, 1);
  assert.equal(s.done.length, 1);
});

test('demo API: ders silinince kayıt ve planları da silinir', async () => {
  const empty = (): DemoDb => ({ courses: [], logs: [], tasks: [], reflections: [] });
  const api = localApi(empty);
  const c = await api.addCourse('Mat', '#000');
  await api.addLog({ course_id: c.id, date: MON, duration_minutes: 30, note: null });
  await api.savePlans(MON, MON, [{ date: MON, course_id: c.id, minutes: 30, note: null }], true);
  const task = await api.addTask({ title: 'iş', date: MON, course_id: c.id });
  await api.deleteCourse(c.id);
  assert.equal((await api.listLogs(MON, MON)).length, 0);
  assert.equal((await api.listPlans(MON, MON)).length, 0);
  assert.equal((await api.listTasks(MON)).find((t) => t.id === task.id)?.course_id, null);
});

test('demo API: plan kaydı yalnızca verilen aralığı değiştirir', async () => {
  const api = localApi(() => ({ courses: [], logs: [], tasks: [], reflections: [] }));
  const row = (date: string) => ({ date, course_id: 'c', minutes: 20, note: null });
  await api.savePlans(MON, '2026-10-18', [row(MON), row('2026-10-14')], true);
  await api.savePlans('2026-10-14', '2026-10-18', [row('2026-10-15')], false);
  const all = await api.listPlans(MON, '2026-10-18');
  assert.deepEqual(all.map((p) => [p.date, p.approved]).sort(), [
    [MON, true],
    ['2026-10-15', false],
  ]);
});

test('Supabase API: 1000 satırdan uzun geçmişi sayfa sayfa okur', async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => log(addDays('2020-01-01', i), 10));
  const ranges: [number, number][] = [];
  // Zincirlenebilir sahte sorgu: range() çağrılınca o dilimi döner
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'eq']) query[m] = () => query;
  query.range = (a: number, b: number) => {
    ranges.push([a, b]);
    return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
  };
  const sb = { from: () => query } as unknown as SupabaseClient;
  const got = await supabaseApi(sb).listLogs('2000-01-01', MON);
  assert.equal(got.length, 2345);
  assert.deepEqual(ranges, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test('seans: süre sunucu kurallarıyla; haber gelmezse son beat + tolerans; hareketsizlik geri alınır', () => {
  const cfg = CFG.session;
  const t0 = Date.parse('2026-10-12T15:00:00Z');
  const min = 60_000;
  let s = newSession('s1', 'mat', MON, t0);
  s = beat(s, t0 + 10 * min); // hiç beat gelmemişti: 10 dk > tolerans → durmuş sayılır
  assert.equal(s.status, 'paused');
  assert.equal(activeMs(s, t0 + 10 * min), cfg.graceSeconds * 1000);
  s = resume(s, t0 + 20 * min);
  for (let m = 21; m <= 50; m++) s = beat(s, t0 + m * min);
  assert.equal(s.status, 'running');
  assert.equal(activeMs(s, t0 + 50 * min), cfg.graceSeconds * 1000 + 30 * min);
  // Ekranda süre tolerans beklemeden akar; sunucu en fazla son beat + tolerans sayar
  assert.equal(shownMs(s, t0 + 60 * min), cfg.graceSeconds * 1000 + 40 * min);
  assert.equal(activeMs(s, t0 + 60 * min), cfg.graceSeconds * 1000 + 30 * min + cfg.graceSeconds * 1000);
  // Hareketsizlik: son 10 dk sayılmaz
  const idle = pause(s, t0 + 50 * min, 10 * 60);
  assert.equal(idle.active_ms, cfg.graceSeconds * 1000 + 20 * min);
  assert.equal(sessionMinutes(idle, t0 + 99 * min), 21);
  // Geri alma en fazla hareketsizlik süresi + cevap süresi kadar
  const huge = pause(s, t0 + 50 * min, 99_999);
  assert.equal(huge.active_ms, Math.max(0, cfg.graceSeconds * 1000 + 30 * min - (cfg.idleMinutes * 60 + cfg.idleAnswerSeconds) * 1000));
  // Duraklatılmışken süre artmaz
  assert.equal(activeMs(idle, t0 + 500 * min), idle.active_ms);
  assert.match(noteProblem('ab')!, /en az 3/);
  assert.equal(noteProblem(' Kesirler '), null);
});

test('demo API: seans — not zorunlu, kayıt timer olur ve Elmas yazılır; elle yazılan Elmas vermez', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-12T12:00:00') });
  const today = '2026-10-12';
  const api = localApi(() => ({ courses: [{ id: 'mat', name: 'Matematik', color: '', created_at: '' }], logs: [], tasks: [], reflections: [] }));
  await api.addLog({ course_id: 'mat', date: today, duration_minutes: 90, note: 'elle' });
  await api.syncEconomy();
  assert.equal(balances(await api.listLedger()).crystal, 0);
  const { session } = await api.startSession('mat', today);
  await assert.rejects(api.startSession('mat', today), /Zaten açık/);
  for (let m = 1; m <= 35; m++) {
    t.mock.timers.tick(60_000);
    await api.beatSession(session.id);
  }
  await assert.rejects(api.finishSession(session.id, 'mat', 'ab'), /en az 3/);
  const r = await api.finishSession(session.id, 'mat', 'Kesirler');
  assert.deepEqual([r.log.duration_minutes, r.log.source, r.log.session_id], [35, 'timer', session.id]);
  assert.equal(await api.getOpenSession(), null);
  const led = await api.listLedger();
  assert.equal(led.find((e) => e.kind === 'study')?.amount, 3);
  assert.equal(led.find((e) => e.kind === 'quest')?.ref, `day30:${today}`);
  // Yarıda bırakılan uzun seans solgun fidan bırakır
  const b = await api.startSession('mat', today);
  for (let m = 1; m <= 6; m++) {
    t.mock.timers.tick(60_000);
    await api.beatSession(b.session.id);
  }
  assert.equal((await api.abandonSession(b.session.id)).status, 'abandoned');
  assert.deepEqual((await api.listAbandoned()).map((x) => x.minutes), [6]);
  // Yıldız: günde 8, yalnızca bugün; para değildir
  await api.collectStar(today, 0);
  await api.collectStar(today, 0);
  await assert.rejects(api.collectStar(today, 8), /toplanamaz/);
  assert.equal(balances(await api.listLedger()).star, 1);
});

// ---------- Dünya: karo ızgarası, yerleştirme, yol bulma, orman ----------
const ctx0 = { totalMinutes: 0, booksDone: 0 };
const owned1 = () => 1;

test('dünya: ayak izi dönüşle değişir; yerleşim sınır, sabit karo, çakışma ve envanteri denetler', () => {
  assert.deepEqual(footprint({ w: 2, h: 1 }, 3, 2, 0).map((t) => `${t.x},${t.y}`), ['3,2', '4,2']);
  assert.deepEqual(footprint({ w: 2, h: 1 }, 3, 2, 90).map((t) => `${t.x},${t.y}`), ['3,2', '3,3']);
  assert.equal(layoutProblem('room', DEFAULT_ROOM, ctx0, owned1), null);
  const room = (items: SpaceLayout['items'], extra: Partial<SpaceLayout> = {}): SpaceLayout => ({ items, ...extra });
  const msg = (l: SpaceLayout, own = owned1, space: 'room' | 'garden' = 'room', ctx = ctx0) => layoutProblem(space, l, ctx, own)?.message ?? null;
  assert.match(msg(room([{ item: 'mob:masa', x: 7, y: 3, rot: 0 }]))!, /dışına/);
  assert.equal(msg(room([{ item: 'mob:masa', x: 7, y: 3, rot: 90 }])), null);
  assert.match(msg(room([{ item: 'mob:masa', x: 6, y: 0, rot: 0 }]))!, /boş değil/); // kapı
  assert.match(msg(room([{ item: 'mob:masa', x: 1, y: 1, rot: 0 }, { item: 'mob:sandalye', x: 2, y: 1, rot: 0 }]))!, /dolu/);
  assert.match(msg(room([{ item: 'mob:sehpa', x: 1, y: 1, rot: 180 }]))!, /döndürülemez/);
  assert.match(msg(room([{ item: 'dis:cit', x: 1, y: 1, rot: 0 }]))!, /dışarıda/);
  assert.match(msg(room([], { floor: 'zemin:dama' }), (i) => (i.id === 'zemin:dama' ? 0 : 1))!, /kaplama/);
  // Halı (zemin katmanı) üstüne koltuk konur; iki halı üst üste konmaz
  const own2 = () => 2;
  assert.equal(msg(room([{ item: 'mob:hali', x: 2, y: 3, rot: 0 }, { item: 'mob:koltuk-mavi', x: 2, y: 3, rot: 0 }]), own2), null);
  assert.match(msg(room([{ item: 'mob:hali', x: 2, y: 3, rot: 0 }, { item: 'mob:hali-yuvarlak', x: 3, y: 3, rot: 0 }]), own2)!, /dolu/);
  // Envanter: iki koltuk için iki tane gerekir; diğer alanlarda kullanılanlar da sayılır
  const two = room([{ item: 'mob:koltuk-mavi', x: 2, y: 3, rot: 0 }, { item: 'mob:koltuk-mavi', x: 2, y: 5, rot: 0 }]);
  assert.match(msg(two)!, /envanterinde yok/);
  assert.equal(layoutProblem('room', two, ctx0, own2), null);
  assert.match(layoutProblem('room', two, ctx0, own2, () => 1)!.message, /envanterinde yok/);
  // Önizleme: konabilir/konamaz
  assert.equal(canPlaceAt('room', DEFAULT_ROOM, ctx0, { item: 'mob:yatak', x: 6, y: 5, rot: 0 }), true);
  assert.equal(canPlaceAt('room', DEFAULT_ROOM, ctx0, { item: 'mob:yatak', x: 2, y: 0, rot: 0 }), false);
  assert.equal(canPlaceAt('room', DEFAULT_ROOM, ctx0, { item: 'mob:masa', x: 2, y: 0, rot: 0 }, 1), true, 'kendi yerine geri konur');
  // Kütüphane odası 36 kitapta açılır; kapısı da o zaman
  assert.match(layoutProblem('library', { items: [] }, ctx0, owned1)!.message, /açılmadı/);
  assert.equal(fixedTiles('room', ctx0).has('0,5'), false);
  assert.equal(fixedTiles('room', { ...ctx0, booksDone: CFG.world.library.books }).get('0,5')?.to, 'library');
});

test('dünya: bahçe yalnızca çalıştıkça büyür; dere, tepe, göl, köprü açılır', () => {
  assert.deepEqual(spaceSize('garden', ctx0), { w: 10, h: 10 });
  assert.equal(landsOf(0).next?.id, 'dere');
  const five = { totalMinutes: 5 * 60, booksDone: 0 };
  assert.deepEqual(spaceSize('garden', five), { w: 12, h: 11 });
  const f = fixedTiles('garden', five);
  assert.equal(f.get('10,0')?.kind, 'water');
  assert.equal(f.get('10,2')?.kind, 'bridge', 'köprü suyun üstünde');
  assert.equal(fixedTiles('garden', ctx0).has('10,0'), false);
  assert.equal(f.get('2,4')?.kind, 'door');
  const sixty = fixedTiles('garden', { totalMinutes: 60 * 60, booksDone: 0 });
  assert.equal(sixty.get('12,11')?.kind, 'bridge');
  assert.equal(sixty.get('12,10')?.kind, 'water');
  assert.deepEqual(landsOf(1e6).unlocked.map((l) => l.id), ['aciklik', 'dere', 'tepe', 'gol', 'kopru', 'sihir']);
  // Yürüme: ev ve su yürünmez, kapı ve köprü yürünür
  const b = blockedTiles('garden', { items: [] }, five);
  assert.ok(b.has('1,1') && b.has('10,0') && !b.has('10,2') && !b.has('2,4'));
});

test('dünya: A* tıklanan karoya engellerin etrafından yürür; dolu karoya tıklanınca yanına gider', () => {
  const blocked = new Set(['1,0', '1,1', '1,2']);
  const p = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 4, 4, blocked)!;
  assert.equal(p.length, 8); // aşağıdan dolaşır
  assert.deepEqual(p.at(-1), { x: 2, y: 0 });
  assert.ok(p.every((t) => !blocked.has(`${t.x},${t.y}`)));
  const adj = findPath({ x: 0, y: 3 }, { x: 1, y: 1 }, 4, 4, blocked)!;
  assert.ok(!blocked.has(`${adj.at(-1)!.x},${adj.at(-1)!.y}`));
  assert.equal(Math.abs(adj.at(-1)!.x - 1) + Math.abs(adj.at(-1)!.y - 1), 1);
  assert.equal(findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, 4, 4, new Set(['1,0', '0,1'])), null);
  // Odada masa ve sandalyenin çevresinden kapıya
  const room = blockedTiles('room', DEFAULT_ROOM, ctx0);
  assert.ok(findPath({ x: 4, y: 4 }, { x: 6, y: 0 }, 8, 8, room));
});

test('orman: her seans bir ağaç (türü süreye göre), yerleri seans kimliğinden ve her açılışta aynı', () => {
  assert.deepEqual([0, 14, 15, 30, 44, 45, 60, 89, 90, 300].map((m) => treeKind(m).id), ['fidan', 'fidan', 'cali', 'genc', 'genc', 'cam', 'mese', 'mese', 'dev', 'dev']);
  const logs = Array.from({ length: 30 }, (_, i) => ({ ...log(addDays(MON, -(i % 20)), 10 + i * 3), id: `s${i}`, created_at: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T10:00:00Z` }));
  const abandoned: Abandoned[] = [
    { id: 'k1', date: MON, minutes: 12, created_at: `${MON}T08:00:00Z` },
    { id: 'k2', date: MON, minutes: 3, created_at: `${MON}T08:30:00Z` },
  ];
  const trees = forestOf([...logs, { ...log(MON, 50, 'tr'), id: 'manual', source: 'manual' }], abandoned);
  assert.equal(trees.length, 31, 'elle yazılan ve 5 dk altı yarım seans ağaç vermez');
  assert.equal(trees.filter((t) => t.dry).length, 1);
  const oct = trees.filter((t) => t.month === '2026-10');
  const a = regionLayout(oct);
  const b = regionLayout([...oct].reverse().sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id)));
  assert.deepEqual([...a.spots], [...b.spots], 'aynı ağaçlar hep aynı yerde');
  assert.equal(a.spots.size, oct.length);
  const keys = [...a.spots.values()].map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(keys).size, keys.length, 'iki ağaç aynı karoda değil');
  assert.ok([...a.spots.values()].every((t) => t.y !== CFG.world.garden.pathRow && t.x < a.size && t.y < a.size), 'patika boş kalır');
  // Yeni ağaç eskilerin yerini değiştirmez
  const more = regionLayout([...oct, { ...oct[0], id: 'yeni', at: '2026-10-30T10:00:00Z' }]);
  if (more.size === a.size) for (const [id, t] of a.spots) assert.deepEqual(more.spots.get(id), t);
  assert.equal(regionSize(0), CFG.world.region.min);
  assert.equal(regionSize(1000), CFG.world.region.max);
  assert.deepEqual(creaturesOf(0), []);
  assert.deepEqual(creaturesOf(10).map((c) => c.id), ['kelebek', 'kus', 'tavsan']);
});

test('dış mekân: bahçe solda, en yeni ay yanında; patika yürünür, ağaçlar yürünmez; yıldızlar boş karoda', () => {
  const trees = forestOf(
    [
      { ...log('2026-09-10', 40), id: 'e1', created_at: '2026-09-10T10:00:00Z' },
      { ...log(MON, 20), id: 'k1', created_at: `${MON}T10:00:00Z` },
    ],
    [],
  );
  const map = outdoorMap(ctx0, trees, '2026-10');
  assert.deepEqual(map.regions.map((r) => [r.month, r.ox]), [
    ['2026-10', 11],
    ['2026-09', 11 + CFG.world.region.min + 1],
  ]);
  const blocked = outdoorBlocked(map, { items: [] }, ctx0);
  assert.ok(!blocked.has(`10,${CFG.world.garden.pathRow}`), 'bahçeden bölgeye patika');
  assert.ok(blocked.has('10,0'), 'bölgeler arası boşluk');
  const spot = map.regions[0].spots.get('k1')!;
  assert.ok(blocked.has(`${11 + spot.x},${spot.y}`));
  assert.ok(findPath({ x: 2, y: 5 }, { x: map.regions[1].ox + 1, y: CFG.world.garden.pathRow }, map.width, map.height, blocked), 'eski aya yürünebilir');
  const stars = dailyStars(MON, map, blocked);
  assert.equal(stars.length, STAR_COUNT);
  assert.deepEqual(stars, dailyStars(MON, map, blocked));
  assert.notDeepEqual(stars, dailyStars(addDays(MON, 1), map, blocked));
  assert.ok(stars.every((s) => !blocked.has(`${Math.floor(s.x)},${Math.floor(s.z)}`)));
});

test('gezinti: karakter dolu karolara girmez, kenarından kayar; joystick kameraya göre', () => {
  const blocked = new Set(['2,0', '2,1']);
  assert.equal(standable(1.5, 0.5, blocked, 4, 4), true);
  assert.equal(standable(1.9, 0.5, blocked, 4, 4), false);
  // Sağa ve aşağı giderken duvara sürtünüp aşağı kayar
  const [x, z] = resolveMove([1.5, 0.5], [1.9, 0.9], blocked, 4, 4);
  assert.equal(x, 1.5);
  assert.ok(z > 0.5);
  assert.deepEqual(resolveMove([0.5, 0.5], [-0.5, 0.5], blocked, 4, 4), [0.5, 0.5], 'alanın dışına çıkmaz');
  const close = (a: [number, number], b: [number, number]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} ≈ ${b}`));
  close(moveDir(0, 1, 0), [0, -1]);
  close(moveDir(1, 0, 0), [1, 0]);
  close(moveDir(0, 1, Math.PI / 2), [-1, 0]);
  assert.ok(Math.hypot(...moveDir(1, 1, 0.3)) <= 1 + 1e-9);
  assert.equal(nearest([0, 0], [{ x: 1, z: 0 }, { x: 0.5, z: 0 }], 2)?.x, 0.5);
  assert.equal(nearest([0, 0], [{ x: 3, z: 0 }], 2), null);
});

test('rapor: ağaç adları config ile aynı', () => {
  assert.deepEqual(
    TREE_NAMES.map((t) => [t.min, t.name]),
    CFG.world.trees.map((t) => [t.min, t.name]),
  );
});

// ---------- Oyun ekonomisi ----------
const entry = (e: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'ref' | 'amount'>): LedgerEntry => ({ id: `${e.kind}:${e.ref}`, currency: 'crystal', note: null, created_at: '', ...e });
const PREV = addDays(MON, -7); // geçen haftanın pazartesisi (5 Ekim)
const weekLogs = [0, 1, 2, 3, 4].map((i) => log(addDays(PREV, i), 40)).concat(log(addDays(PREV, 1), 10, 'tr'), log(addDays(PREV, 1), 10, 'fen'));
const plan1: PlanItem = { id: 'p1', date: PREV, course_id: 'mat', minutes: 30, note: null, approved: true };
const finished: Book = { ...({} as Book), id: 'kitap', title: 'K', finished_on: addDays(PREV, 2), status: 'done', created_at: '' };

test('Elmas: azalan getiri, günlük tavan', () => {
  assert.deepEqual([9, 45, 60, 90, 120, 150, 180, 600].map((m) => studyElmas(m)), [0, 4, 6, 7, 9, 10, 11, 11]);
  assert.equal(studyElmas(600, { tiers: [{ upTo: 1000, minutesPer: 10 }], dailyCap: 12 }), 12);
});

const refl = (date: string, note: string, rating: number | null = 4): Reflection => ({ date, rating, note, updated_at: '' });

test('Elmas: çalışma, seri, plan, öz değerlendirme, kitap ve görevler; elle yazılan sayılmaz', () => {
  const manual: StudyLog = { ...log(addDays(PREV, 2), 100, 'tr'), id: 'm', source: 'manual' };
  const books = [finished, { ...finished, id: 'k2' }, { ...finished, id: 'k3' }];
  const reflections = [refl(PREV, 'Kesirleri anladım bugün'), refl(addDays(PREV, 1), 'kısa'), refl(addDays(PREV, 5), 'Çalışmadığım gün yazdım')];
  const input = { logs: [...weekLogs, manual], plans: [plan1], books, reflections, today: MON };
  const earned = earnedEntries(input);
  const get = (kind: string, ref: string) => earned.find((e) => e.kind === kind && e.ref === ref)?.amount;
  assert.equal(get('study', PREV), 4);
  assert.equal(get('study', addDays(PREV, 1)), 6); // 40 + 10 + 10
  assert.equal(get('study', addDays(PREV, 2)), 4, 'elle yazılan 100 dk sayılmaz');
  assert.deepEqual(earned.filter((e) => e.kind === 'streak').map((e) => e.ref), [2, 3, 4].map((i) => addDays(PREV, i)));
  assert.equal(get('plan', PREV), CFG.elmas.plan);
  assert.deepEqual(earned.filter((e) => e.kind === 'reflection').map((e) => e.ref), [PREV]);
  assert.deepEqual(earned.filter((e) => e.kind === 'book').map((e) => e.ref), ['k2', 'k3'], 'haftada en çok 2 kitap (aynı gün bitenlerde sıra: eklenme, id)');
  assert.equal(get('quest', `week5days:${PREV}`), 5);
  assert.equal(get('quest', `week3courses:${PREV}`), 3);
  assert.equal(get('quest', `weekBook:${PREV}`), 5);
  assert.equal(get('quest', `day30:${PREV}`), 2);
  assert.equal(get('quest', `week3plans:${PREV}`), undefined);
  assert.ok(earned.every((e) => e.currency === 'crystal'));
  // Yazılmış olan tekrar yazılmaz; gün ilerleyip artan yazılır, azalan yazılmaz
  const ledger = earned.map((e) => entry(e));
  assert.equal(pendingEarnings(ledger, earned).length, 0);
  const more = earnedEntries({ ...input, logs: [...input.logs, log(PREV, 30)] });
  assert.deepEqual(pendingEarnings(ledger, more).map((e) => [e.kind, e.ref, e.amount]), [['study', PREV, 6]]);
  assert.deepEqual(pendingEarnings(ledger, earnedEntries({ ...input, logs: [] })), []);
  assert.deepEqual(balances([...ledger, entry({ kind: 'buy', ref: 'o', amount: -30 }), entry({ currency: 'star', kind: 'star', ref: `${MON}:0`, amount: 1 })]), {
    crystal: earned.reduce((s, e) => s + e.amount, 0) - 30,
    star: 1,
  });
});

test('görevler: bugünün ve bu haftanın ilerlemesi; yalnızca Elmas verir', () => {
  const q = questsNow({ logs: [log(MON, 25)], plans: [], books: [], today: MON });
  const by = (id: string) => q.find((x) => x.id === id)!;
  assert.equal(by('day30').progress, 25);
  assert.equal(by('day30').done, false);
  assert.equal(by('week5days').ref, `week5days:${MON}`);
  assert.equal(q.some((x) => x.id === 'stars5'), false, 'oyun görevi yok');
});

test('sandık: 5 gün + 150 dk; ödül haftaya göre sabit, satın alınamaz', () => {
  const totals = dayTotalsOf(weekLogs);
  const c = chestOf(PREV, totals, []);
  assert.deepEqual([c.days, c.minutes, c.ready, c.opened], [5, 220, true, false]);
  assert.equal(chestOf(MON, totals, []).ready, false);
  const opened: OwnedItem = { id: 'o', item_id: 'pet:tiger', via: 'chest', ref: PREV, created_at: '' };
  assert.equal(chestOf(PREV, totals, [opened]).opened, true);
  assert.equal(chestPrize(PREV, []).id, chestPrize(PREV, []).id);
  const prizes = new Set(Array.from({ length: 30 }, (_, i) => chestPrize(addDays(PREV, 7 * i), []).id));
  assert.ok(prizes.size > 3, 'haftalar farklı eşyalar verir');
  for (const id of prizes) {
    const it = itemById(id)!;
    assert.ok(inChestPool(it));
  }
  assert.equal(buyCheck('pet:tiger', 999, [], 0), 'Bu eşya satılmıyor.');
});

test('sahiplik: ücretsiz, satın alınan, başarıyla açılan; canlılar satın alınamaz', () => {
  const p = { bestStreak: 12, planDays: 10, gold: 0, level: 1, hours: 20, trees: 15 };
  const o = (item_id: string) => ({ id: 'x', item_id, via: 'buy' as const, ref: null, created_at: '' });
  assert.ok(owns(itemById('char:female-b')!, [], p));
  assert.ok(owns(itemById('pet:cat')!, [], p), '12 ağaçta kedi gelir');
  assert.ok(!owns(itemById('pet:dog')!, [], p), '18 ağaçta köpek');
  assert.ok(owns(itemById('pet:giraffe')!, [], p)); // 10 planlı gün
  assert.ok(!owns(itemById('pet:lion')!, [], p)); // 30 günlük seri
  assert.ok(!owns(itemById('isik:yildiz')!, [], p), '100 saatte yıldız lambası');
  assert.ok(owns(itemById('isik:yildiz')!, [], { ...p, hours: 100 }));
  assert.equal(buyCheck('pet:cat', 999, [], 0), 'Bu eşya satılmıyor.');
  assert.match(buyCheck('mob:koltuk-mavi', 10, [], 0)!, /30 💎 daha/);
  assert.equal(buyCheck('mob:koltuk-mavi', 40, [o('mob:koltuk-mavi')], 0), null, 'mobilyadan birden fazla alınır');
  assert.match(buyCheck('zemin:dama', 99, [o('zemin:dama')], 0)!, /zaten/);
  assert.match(buyCheck('freeze', 99, [], 2)!, /En fazla 2/);
  // 15–20 başlangıç eşyası ve gereken kategoriler
  const shop = ITEMS.filter((i) => i.acquire.kind === 'buy' && !['karakter', 'aksesuar', 'diger'].includes(i.category));
  assert.ok(shop.length >= 15, `${shop.length} eşya`);
  for (const c of ['mobilya', 'zemin', 'duvar', 'bitki', 'isik', 'dis']) assert.ok(shop.some((i) => i.category === c), c);
  for (const i of ITEMS.filter((x) => x.placement)) assert.ok(i.model && i.w && i.h && i.rotations?.length, i.id);
});

test('seri dondurma: bir kademe düşüşünü engeller, satın alındıktan en çok 7 gün öncesine kadar', () => {
  // 28 Eyl – 9 Eki: 29 ve 30 Eyl boş, hafta sonları boş
  const studied = (d: string) => (['2026-09-29', '2026-09-30'].includes(d) || d.endsWith('-10-03') || d.endsWith('-10-04') ? 0 : 30);
  const plain = computeStreak(studied, '2026-09-28', '2026-10-09');
  assert.equal(plain.streak, 7); // 29 Eyl'de 1 → 0, 1 Eki'den beri
  const frozen = computeStreak(studied, '2026-09-28', '2026-10-09', ['2026-10-05', '2026-10-05']);
  assert.equal(frozen.streak, 8); // iki kaçırma da donduruldu
  assert.equal(frozen.freezesUsed, 2);
  assert.equal(frozen.freezesLeft, 0);
  // 8 gün sonra alınan dondurma eski kaçırmayı kapatmaz, bekler
  const late = computeStreak(studied, '2026-09-28', '2026-10-09', ['2026-10-08']);
  assert.deepEqual([late.streak, late.freezesLeft], [7, 1]);
});

test('seviye ve ders yetenekleri', () => {
  assert.equal(levelOf(0).level.name, 'Çırak');
  assert.equal(levelOf(5 * 60).level.name, 'Kâşif');
  assert.equal(levelOf(10 * 60).progress, 0.5);
  assert.equal(levelOf(1e6).next, null);
  assert.deepEqual(perksOf(2), { runBoost: 1.15, doubleJump: true, glide: false, trail: false });
  assert.equal(skillTitle('Matematik').title, 'Bilge');
  assert.equal(skillTitle('Türkçe').title, 'Hikâyeci');
  assert.equal(skillTitle('İngilizce').title, 'Gezgin');
  assert.equal(skillTitle('Robotik').title, 'Usta');
  const courses = [
    { id: 'mat', name: 'Matematik', color: '', created_at: '' },
    { id: 'tr', name: 'Türkçe', color: '', created_at: '' },
  ];
  const k = skillsOf(courses, [log(MON, 15 * 60), log(MON, 130, 'tr')]);
  assert.equal(k[0].tier, 3);
  assert.equal(k[1].tier, 1);
  assert.equal(k[1].weakest, true);
  assert.equal(k[0].weakest, false);
});

test('demo API: Elmas kayıtlardan yazılır, bakiye yetmezse satın alınamaz, sandık bir kez açılır', async () => {
  const api = localApi(() => ({ courses: [], logs: weekLogs, tasks: [], reflections: [] }));
  await api.syncEconomy();
  await api.syncEconomy();
  const bal = balances(await api.listLedger()).crystal;
  // çalışma 4+6+4+4+4, seri 1+1+1, görevler: 5 gün, 3 ders, 5 × day30
  assert.equal(bal, 22 + 3 + 5 + 3 + 5 * 2);
  await assert.rejects(api.buyItem('mob:yatak'), /Bakiye yetmiyor/);
  await assert.rejects(api.giftCrystals(CFG.elmas.giftMax + 1, 'x'), /Hediye/);
  await api.giftCrystals(30, 'test');
  await api.buyItem('zemin:dama');
  await assert.rejects(api.buyItem('zemin:dama'), /zaten sende/);
  assert.equal(balances(await api.listLedger()).crystal, bal + 30 - 35);
  await assert.rejects(api.buyItem('pet:cat'), /satılmıyor/);
  await assert.rejects(api.openChest(PREV, 'mob:masa'), /sandıktan çıkmaz/);
  await api.openChest(PREV, 'dis:halka');
  await assert.rejects(api.openChest(PREV, 'dis:halka'), /zaten açıldı/);
  await assert.rejects(api.openChest(MON, 'dis:halka'), /henüz açılmadı/);
});

test('demo API: yerleşim sunucu kurallarıyla kaydedilir', async () => {
  const api = localApi(() => ({ courses: [], logs: weekLogs, tasks: [], reflections: [] }));
  await api.saveSpace('room', { ...DEFAULT_ROOM, floor: 'zemin:ahsap' });
  await assert.rejects(api.saveSpace('room', { items: [{ item: 'mob:koltuk-mavi', x: 3, y: 3, rot: 0 }] }), /envanterinde yok/);
  await api.syncEconomy();
  await api.buyItem('mob:koltuk-mavi');
  await api.saveSpace('room', { items: [{ item: 'mob:koltuk-mavi', x: 3, y: 3, rot: 0 }] });
  await assert.rejects(api.saveSpace('garden', { items: [{ item: 'mob:koltuk-mavi', x: 3, y: 3, rot: 0 }] }), /içeride/);
  await assert.rejects(api.saveSpace('library', { items: [] }), /açılmadı/);
  const spaces = await api.listSpaces();
  assert.deepEqual(spaces.map((x) => [x.space, x.layout.items.length]), [['room', 1]]);
});

test('ekonomi: son config migration\'ı src/config ile aynı (npm run config:sql)', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('_config.sql')).sort();
  assert.ok(files.length, 'config migration yok');
  const sql = readFileSync(new URL(files.at(-1)!, dir), 'utf8');
  assert.equal(sql, renderConfigSql(economyJson, itemsJson), `${files.at(-1)} eski: npm run config:sql`);
  // Eşya listesi uygulamanın kataloğuyla aynı; sandık havuzu iki tarafta aynı
  assert.deepEqual(ITEM_DEFS.map((d) => d.id), ITEMS.map((i) => i.id));
  assert.deepEqual(ITEMS.filter(inChestPool).map((i) => i.id), [...sql.matchAll(/\('([\w:-]+)', '\w+', (?:\d+|null), (?:true|false), true,/g)].map((m) => m[1]));
});

test('tanıtım: sahneler hedefli ve sırayla; kelime zamanları (tahmin ve ElevenLabs hizalaması)', () => {
  assert.ok(SCENES.length >= 8);
  assert.equal(new Set(SCENES.map((x) => x.id)).size, SCENES.length);
  for (const sc of SCENES) assert.ok(sc.hash && sc.target && sc.text.split(' ').length > 5, sc.id);
  const w = estimateWords('Merhaba! Burası senin dünyan.');
  assert.deepEqual(w.map((x) => x.w), ['Merhaba!', 'Burası', 'senin', 'dünyan.']);
  assert.ok(w.every((x, i) => x.e > x.s && (i === 0 || x.s >= w[i - 1].e)));
  assert.ok(w[1].s - w[0].e > 0.3, 'ünlemden sonra duraklama');
  assert.equal(wordAt(w, 0), -1);
  assert.equal(wordAt(w, w[2].s + 0.01), 2);
  assert.ok(sceneEnd(w) > w[3].e);
  const chars = [...'Hadi gel!'];
  const al = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08) };
  assert.deepEqual(wordsFromAlignment(al), [
    { w: 'Hadi', s: 0, e: 0.38 },
    { w: 'gel!', s: 0.5, e: 0.88 },
  ]);
});
