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
import { canPlace, dailyStars, EDGE, moveDir, nearest, obstacles, PLAYER_R, resolveMove, STAR_COUNT } from './explore';
import { pickFreeCell, stageIndex, CELLS } from './forest';
import { autoPlantPlan, computeStats, dayAction, diffStats, walletOf, walletsFor } from './game';
import { cellPosition, islandLayout, islandProgress, wiltSpots } from './island';
import { applyTemplate, dayPlan, TEMPLATES } from './plan';
import { computeReading, parcelCells } from './reading';
import { openRewards, rewardProgress } from './rewards';
import { REVIVE_MIN, wiltsOf } from './wilt';
import { DEFAULT_READING_GOALS, type Book, type ForestTree, type LedgerEntry, type OwnedItem, type PlanItem, type Reflection, type Reward, type StudyLog } from './types';

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

test('orman: fiyat evresi, boş hücre', () => {
  assert.equal(stageIndex(29), -1);
  assert.equal(stageIndex(30), 0);
  assert.equal(stageIndex(180), 4);
  const taken = new Set<number>();
  for (let i = 0; i < CELLS; i++) taken.add(pickFreeCell(taken, `s${i}`)!);
  assert.equal(taken.size, CELLS); // hepsi dolabildi, çakışma yok
  assert.equal(pickFreeCell(taken, 'x'), null);
});

const tree = (date: string, stage: number, id = `t-${date}`): ForestTree => ({ id, date, stage, species: 'elma', month: date.slice(0, 7), cell: 0 });

test('günde tek ağaç: dikilmemiş gün dikilir, parası yeten gün büyütülür', () => {
  const totals = new Map([
    ['2026-10-01', 40], // ağaç yok → tohum dik
    ['2026-10-02', 25], // tohuma yetmez
    ['2026-10-05', 95], // tohum dikili, küçük ağaca yetiyor → büyüt
    ['2026-10-06', 70], // çiçek dikili, 90'a yetmez → bekleyen yok
    [MON, 30],
  ]);
  const trees = [tree('2026-10-05', 0), tree('2026-10-06', 1)];
  const w = walletsFor('2026-10', totals, trees, MON);
  assert.deepEqual(
    w.map((x) => [x.date, dayAction(x)]),
    [
      [MON, { kind: 'plant', stage: 0 }],
      ['2026-10-05', { kind: 'grow', stage: 2 }],
      ['2026-10-01', { kind: 'plant', stage: 0 }],
    ],
  );
  assert.equal(walletOf('2026-10-06', totals, trees).left, 10);
});

test('geçmiş ay: her güne bir ağaç dikilir ya da paranın yettiği evreye büyütülür', () => {
  const totals = new Map([
    ['2026-09-10', 130], // ağaç yok → büyük ağaç
    ['2026-09-11', 200], // tohum dikili → dev ağaca büyüt
    ['2026-09-12', 20], // yetmez
    ['2026-10-01', 100], // bu ay: dokunulmaz
  ]);
  const steps = autoPlantPlan(totals, [tree('2026-09-11', 0, 'eski')], MON);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[1], { kind: 'grow', id: 'eski', stage: 4 });
  assert.equal(steps[0].kind, 'plant');
  if (steps[0].kind === 'plant') {
    assert.equal(steps[0].tree.stage, 3);
    assert.equal(steps[0].tree.month, '2026-09');
    assert.notEqual(steps[0].tree.cell, 0); // eski ağacın hücresi dolu
  }
});

test('istatistik + kutlama: yeni dakika yeni evre ve rozet getirir', () => {
  const base = { reflections: [], trees: [], doneTasks: 0, today: MON };
  const before = computeStats({ ...base, logs: [log(MON, 20)] });
  const after = computeStats({ ...base, logs: [log(MON, 20), log(MON, 15)] });
  assert.equal(after.today.left, 35);
  const kinds = diffStats(before, after).map((c) => c.kind);
  assert.ok(kinds.includes('stage'));
  // Ağaç zaten dikiliyse ve yeni evreye ulaşılmadıysa "dik" kutlaması tekrar çıkmaz
  const planted = computeStats({ ...base, trees: [tree(MON, 0)], logs: [log(MON, 20), log(MON, 15)] });
  const more = computeStats({ ...base, trees: [tree(MON, 0)], logs: [log(MON, 20), log(MON, 15), log(MON, 10)] });
  assert.deepEqual(diffStats(planted, more).filter((c) => c.kind === 'stage'), []);
  const grow = computeStats({ ...base, trees: [tree(MON, 0)], logs: [log(MON, 20), log(MON, 15), log(MON, 30)] });
  assert.match(diffStats(planted, grow).find((c) => c.kind === 'stage')!.title, /çiçek olabilir/);
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

test('okuma: bu ay biten ve dikilmeyen kitap parsel bekler; parsel 4’er büyür', () => {
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
  const s = computeReading([book], logs, [], DEFAULT_READING_GOALS, MON);
  assert.equal(s.pendingTrees.length, 1);
  assert.equal(s.todayPages, 20);
  assert.equal(s.monthDone, 1);
  assert.equal(computeReading([book], logs, [{ id: 't', book_id: 'b', month: '2026-10', cell: 0 }], DEFAULT_READING_GOALS, MON).pendingTrees.length, 0);
  assert.equal(parcelCells(0), 4);
  assert.equal(parcelCells(5), 8);
  assert.equal(parcelCells(1, 9), 12);
});

test('demo API: ders silinince kayıt ve planları da silinir; aynı hücreye ya da aynı güne iki ağaç olmaz', async () => {
  const empty = (): DemoDb => ({ courses: [], logs: [], tasks: [], reflections: [] });
  const api = localApi(empty);
  const c = await api.addCourse('Mat', '#000');
  await api.addLog({ course_id: c.id, date: MON, duration_minutes: 30, note: null });
  await api.savePlans(MON, MON, [{ date: MON, course_id: c.id, minutes: 30, note: null }], true);
  const task = await api.addTask({ title: 'iş', date: MON, course_id: c.id });
  await api.plantTree({ date: MON, stage: 0, species: 'elma', month: '2026-10', cell: 3 });
  await assert.rejects(api.plantTree({ date: '2026-10-11', stage: 0, species: 'elma', month: '2026-10', cell: 3 }), /dolu/);
  await assert.rejects(api.plantTree({ date: MON, stage: 0, species: 'elma', month: '2026-10', cell: 4 }), /zaten bir ağaç/);
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

test('solgun fidan: iptalden sonra aynı gün 10 dk çalışılınca canlanır', () => {
  const ab = (id: string, date: string, created_at: string) => ({ id, date, minutes: 12, created_at });
  const at = (date: string, min: number, created_at: string): StudyLog => ({ ...log(date, min), id: `${date}-${created_at}`, created_at });
  const logs = [
    at(MON, 30, `${MON}T08:00:00.000Z`), // iptalden önce: sayılmaz
    at(MON, 6, `${MON}T10:00:00.000Z`),
    at(MON, 5, `${MON}T11:00:00.000Z`),
    at('2026-10-11', 20, '2026-10-11T12:00:00.000Z'), // başka gün: sayılmaz
  ];
  const [a, b] = wiltsOf([ab('a', MON, `${MON}T09:00:00.000Z`), ab('b', MON, `${MON}T10:30:00.000Z`)], logs);
  assert.deepEqual([a.after, a.revived], [11, true]);
  assert.deepEqual([b.after, b.revived], [5, false]);
  assert.equal(REVIVE_MIN, 10);
});

test('ada: saat arttıkça biyomlar açılır ve ada büyür', () => {
  const start = islandProgress(0);
  assert.equal(start.level, 1);
  assert.deepEqual(start.next && [start.next.biome.id, start.next.minutesLeft], ['cicek', 180]);
  const mid = islandProgress(26 * 60);
  assert.ok(mid.unlocked.has('gol') && mid.unlocked.has('tavsan') && !mid.unlocked.has('civciv'));
  assert.ok(mid.radius > start.radius);
  assert.equal(islandProgress(1e6).next, null);
});

test('ada: süsler aynı ay için hep aynı, ızgaraya ve göle girmez, kıyıdan taşmaz', () => {
  const p = islandProgress(60 * 60);
  const a = islandLayout('2026-10', p);
  assert.deepEqual(a, islandLayout('2026-10', p));
  assert.notDeepEqual(a.decor, islandLayout('2026-09', p).decor);
  assert.ok(a.pond && a.campfire);
  for (const d of a.decor) {
    assert.ok(!(Math.abs(d.x) < 4.35 && Math.abs(d.z) < 4.35), 'süs ızgarada');
    assert.ok(Math.hypot(d.x, d.z) <= p.radius, 'süs adanın dışında');
    assert.ok(Math.hypot(d.x - a.pond!.x, d.z - a.pond!.z) > a.pond!.r, 'süs gölette');
  }
  // Izgara hücreleri ortada: 0 sol üst, 63 sağ alt
  assert.deepEqual(cellPosition(0), [-3.5, -3.5]);
  assert.deepEqual(cellPosition(63), [3.5, 3.5]);
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

const tree3d = (cell: number, stage: number): ForestTree => ({ id: `t${cell}`, date: MON, month: '2026-10', cell, stage, species: 'elma' });

test('gezinti: karakter engellerin içine girmez, kayarak geçer, kıyıdan düşmez', () => {
  const obs = [{ x: 0, z: 0, r: 0.3 }];
  const min = 0.3 + PLAYER_R;
  // Dümdüz ağaca yürüyünce kenarında durur
  const hit = resolveMove([-1, 0], [0, 0.0], obs, 8);
  assert.ok(Math.hypot(...hit) >= min - 1e-9);
  // Çapraz gelince ağacın etrafından kayar (z yönünde ilerler)
  const slide = resolveMove([-0.6, -0.1], [-0.4, 0.05], obs, 8);
  assert.ok(Math.hypot(...slide) >= min - 1e-9);
  assert.ok(slide[1] > -0.1);
  // Engel yoksa olduğu gibi
  assert.deepEqual(resolveMove([2, 2], [2.1, 2], obs, 8), [2.1, 2]);
  // Kıyı: yarıçap - EDGE'den öteye gidemez
  const edge = resolveMove([6, 0], [9, 0], [], 8);
  assert.ok(Math.abs(Math.hypot(...edge) - (8 - EDGE)) < 1e-9);
});

test('gezinti: engeller — büyük ağaç, kaya, gölet; fidan ve çiçek değil', () => {
  const p = islandProgress(60 * 60);
  const layout = islandLayout('2026-10', p);
  const obs = obstacles([tree3d(0, 0), tree3d(1, 1), tree3d(2, 4)], layout);
  const [x, z] = cellPosition(2);
  assert.ok(obs.some((o) => o.x === x && o.z === z));
  assert.ok(!obs.some((o) => o.x === cellPosition(0)[0] && o.z === cellPosition(0)[1]));
  assert.ok(obs.some((o) => layout.pond && o.x === layout.pond.x && o.r > layout.pond.r));
  const rocks = layout.decor.filter((d) => d.kind === 'rock' || d.kind === 'stone' || d.kind === 'log' || d.kind === 'stump').length;
  assert.equal(obs.length, 1 + rocks + (layout.pond ? 1 : 0) + (layout.campfire ? 1 : 0));
});

test('gezinti: joystick yönü kameraya göre', () => {
  const close = (a: [number, number], b: [number, number]) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `${a} ≠ ${b}`);
  // Kamera +z'de (yaw 0): ileri = -z, sağ = +x
  close(moveDir(0, 1, 0), [0, -1]);
  close(moveDir(1, 0, 0), [1, 0]);
  // Kamera +x'te (yaw 90°): ileri = -x
  close(moveDir(0, 1, Math.PI / 2), [-1, 0]);
  // Çapraz basınca hız 1'i geçmez
  assert.ok(Math.hypot(...moveDir(1, 1, 0.3)) <= 1 + 1e-9);
  assert.equal(nearest([0, 0], [{ x: 1, z: 0 }, { x: 0.5, z: 0 }], 2)?.x, 0.5);
  assert.equal(nearest([0, 0], [{ x: 3, z: 0 }], 2), null);
});

test('gezinti: günün yıldızları sabit ve boş yerlerde; eşya yerleştirme kuralları', () => {
  const p = islandProgress(60 * 60);
  const layout = islandLayout('2026-10', p);
  const trees = [tree3d(0, 3), tree3d(9, 4), tree3d(27, 2)];
  const a = dailyStars(MON, trees, layout, p.radius);
  assert.equal(a.length, STAR_COUNT);
  assert.deepEqual(a, dailyStars(MON, trees, layout, p.radius));
  assert.notDeepEqual(a, dailyStars(addDays(MON, 1), trees, layout, p.radius));
  const obs = obstacles(trees, layout);
  for (const s of a) {
    assert.ok(Math.hypot(s.x, s.z) <= p.radius - EDGE, 'kıyıdan taşmaz');
    assert.ok(!obs.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < o.r + 0.2), 'engelin üstünde değil');
  }
  // Yerleştirme: ızgaraya, kıyı dışına ve başka eşyanın üstüne konamaz
  assert.equal(canPlace(0, 0, 0.5, p.radius, []), false);
  assert.equal(canPlace(p.radius, 0, 0.5, p.radius, []), false);
  assert.equal(canPlace(0, p.radius - 1.4, 0.4, p.radius, []), true);
  assert.equal(canPlace(0, p.radius - 1.4, 0.4, p.radius, [{ x: 0.3, z: p.radius - 1.4, r: 0.3 }]), false);
  // Üzerinden yürünen yol çarpışmaya girmez, çadır girer
  const withPlaced = obstacles([], layout, [{ x: 0, z: 6, r: 0.75 }, { x: 2, z: 6, r: 0.5, walk: true }]);
  assert.equal(withPlaced.length, obstacles([], layout).length + 1);
  // Solgun fidan yerleri de aynı yardımcıdan, her seferinde aynı
  const w = [{ item: { id: 'a-1' } }, { item: { id: 'a-2' } }];
  assert.deepEqual(wiltSpots(w, layout, p.radius), wiltSpots(w, layout, p.radius));
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

test('sahiplik: ücretsiz, satın alınan, başarıyla açılan; satın alma kontrolü', () => {
  const p = { bestStreak: 12, planDays: 10, gold: 0, level: 1 };
  assert.ok(owns(itemById('char:female-b')!, [], p));
  assert.ok(!owns(itemById('pet:cat')!, [], p));
  assert.ok(owns(itemById('pet:cat')!, [{ id: 'x', item_id: 'pet:cat', via: 'buy', ref: null, created_at: '' }], p));
  assert.ok(owns(itemById('pet:giraffe')!, [], p)); // 10 planlı gün
  assert.ok(!owns(itemById('pet:lion')!, [], p)); // 30 günlük seri
  assert.match(buyCheck('pet:cat', 10, [], 0)!, /50 💎 daha/);
  assert.equal(buyCheck('pet:cat', 60, [], 0), null);
  assert.match(buyCheck('pet:cat', 99, [{ id: 'x', item_id: 'pet:cat', via: 'buy', ref: null, created_at: '' }], 0)!, /zaten/);
  assert.equal(buyCheck('yapi:tent', 99, [{ id: 'x', item_id: 'yapi:tent', via: 'buy', ref: null, created_at: '' }], 0), null);
  assert.match(buyCheck('sus:fence', 2, [], 0)!, /8 💎 daha/);
  assert.match(buyCheck('freeze', 99, [], 2)!, /En fazla 2/);
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
  await assert.rejects(api.buyItem('pet:panda'), /Bakiye yetmiyor/);
  await assert.rejects(api.giftCrystals(CFG.elmas.giftMax + 1, 'x'), /Hediye/);
  await api.giftCrystals(30, 'test');
  await api.buyItem('pet:cat');
  await assert.rejects(api.buyItem('pet:cat'), /zaten sende/);
  assert.equal(balances(await api.listLedger()).crystal, bal + 30 - 60);
  await assert.rejects(api.buyItem('pet:lion'), /satılmıyor/);
  await assert.rejects(api.openChest(PREV, 'pet:cat'), /sandıktan çıkmaz/);
  await api.openChest(PREV, 'pet:tiger');
  await assert.rejects(api.openChest(PREV, 'pet:tiger'), /zaten açıldı/);
  await assert.rejects(api.openChest(MON, 'pet:tiger'), /henüz açılmadı/);
  const cat = (await api.listOwned()).find((o) => o.item_id === 'pet:cat')!;
  await api.placeItem({ month: '2026-10', owned_id: cat.id, x: 5, z: 1, rot: 0 });
  await assert.rejects(api.placeItem({ month: '2026-10', owned_id: cat.id, x: 6, z: 1, rot: 0 }), /zaten adada/);
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
