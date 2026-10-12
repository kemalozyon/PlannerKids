// Uygulamanın saf mantığı: seri, cüzdan, orman, plan, ödül, okuma ve iki API katmanı.
// Çalıştırma: npm test (scripts/resolve-ts.mjs uzantısız importları çözer).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localApi, supabaseApi, type DemoDb } from './api';
import { addDays, formatMinutes, weekStart } from './date';
import { greedySpend, pickFreeCell, stageIndex, CELLS } from './forest';
import { computeStats, computeStreak, diffStats, walletsFor } from './game';
import { applyTemplate, dayPlan, TEMPLATES } from './plan';
import { computeReading, parcelCells } from './reading';
import { openRewards, rewardProgress } from './rewards';
import { DEFAULT_READING_GOALS, type Book, type ForestTree, type PlanItem, type Reward, type StudyLog } from './types';

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
const set = (...days: string[]) => (d: string) => days.includes(d);

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

test('seri: haftada bir dinlenme hakkı, ikinci boş gün sıfırlar', () => {
  const one = computeStreak(set('2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09'), '2026-10-05', '2026-10-09');
  assert.equal(one.streak, 4);
  const two = computeStreak(set('2026-10-05', '2026-10-06', '2026-10-09'), '2026-10-05', '2026-10-09');
  assert.equal(two.streak, 1);
  assert.equal(two.best, 2);
});

test('orman: fiyat evresi, açgözlü harcama, boş hücre', () => {
  assert.equal(stageIndex(29), -1);
  assert.equal(stageIndex(30), 0);
  assert.equal(stageIndex(180), 4);
  assert.deepEqual(greedySpend(170), [3, 0]);
  assert.deepEqual(greedySpend(29), []);
  const taken = new Set<number>();
  for (let i = 0; i < CELLS; i++) taken.add(pickFreeCell(taken, `s${i}`)!);
  assert.equal(taken.size, CELLS); // hepsi dolabildi, çakışma yok
  assert.equal(pickFreeCell(taken, 'x'), null);
});

test('cüzdan: yalnızca bu ayın, en az bir tohumluk parası kalan günleri', () => {
  const totals = new Map([
    ['2026-09-30', 100],
    ['2026-10-01', 40],
    ['2026-10-02', 25],
    ['2026-10-12', 90],
  ]);
  const trees: ForestTree[] = [{ id: 't', date: '2026-10-12', stage: 1, species: 'elma', month: '2026-10', cell: 0 }];
  const w = walletsFor('2026-10', totals, trees, MON);
  assert.deepEqual(
    w.map((x) => [x.date, x.left]),
    [
      ['2026-10-12', 30],
      ['2026-10-01', 40],
    ],
  );
});

test('istatistik + kutlama: yeni dakika yeni evre ve rozet getirir', () => {
  const base = { reflections: [], trees: [], doneTasks: 0, today: MON };
  const before = computeStats({ ...base, logs: [log(MON, 20)] });
  const after = computeStats({ ...base, logs: [log(MON, 20), log(MON, 15)] });
  assert.equal(after.today.left, 35);
  const kinds = diffStats(before, after).map((c) => c.kind);
  assert.ok(kinds.includes('stage'));
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

test('demo API: ders silinince kayıt ve planları da silinir, aynı hücreye iki bitki olmaz', async () => {
  const empty = (): DemoDb => ({ courses: [], logs: [], tasks: [], reflections: [] });
  const api = localApi(empty);
  const c = await api.addCourse('Mat', '#000');
  await api.addLog({ course_id: c.id, date: MON, duration_minutes: 30, note: null });
  await api.savePlans(MON, MON, [{ date: MON, course_id: c.id, minutes: 30, note: null }], true);
  const task = await api.addTask({ title: 'iş', date: MON, course_id: c.id });
  await api.plantTree({ date: MON, stage: 0, species: 'elma', month: '2026-10', cell: 3 });
  await assert.rejects(api.plantTree({ date: MON, stage: 0, species: 'elma', month: '2026-10', cell: 3 }));
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
