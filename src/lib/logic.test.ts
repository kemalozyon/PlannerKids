// Uygulamanın saf mantığı: seri, cüzdan, orman, plan, ödül, okuma ve iki API katmanı.
// Çalıştırma: npm test (scripts/resolve-ts.mjs uzantısız importları çözer).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localApi, supabaseApi, type DemoDb } from './api';
import { addDays, formatMinutes, weekStart } from './date';
import { has, ITEMS, itemById, poseOf } from './catalog';
import { balances, bestStreakOf, buyCheck, chestOf, chestPrize, dayTotalsOf, earnedEntries, inChestPool, owns, pendingEarnings, questsNow, studyElmas } from './economy';
import { BEHAVIORS, CFG, DISPENSE, ITEM_DEFS, SOUNDS } from './config';
import { activeMs, beat, newSession, noteProblem, pause, resume, sessionMinutes, shownMs } from './session';
import { computeStreak, dropTier } from './streak';
import { renderConfigSql } from '../../scripts/config-sql.mjs';
import economyJson from '../config/economy.json' with { type: 'json' };
import itemsJson from '../config/items.json' with { type: 'json' };
import { levelOf, perksOf, skillsOf, skillTitle } from './level';
import { carrySpot, dailyStars, moveDir, nearest, resolveMove, standable, STAR_COUNT } from './explore';
import { computeStats, diffStats } from './game';
import {
  approachTile,
  blockedTiles,
  isMonthSpace,
  isRoom,
  cellRects,
  defaultCover,
  inCells,
  ROOM_KINDS,
  ROOM_SHAPES,
  ROOM_SIZES,
  roomInputProblem,
  roomSpace,
  canPlaceAt,
  creaturesOf,
  dayTrees,
  DEFAULT_ROOM,
  findPath,
  fixedTiles,
  footprint,
  isOn,
  moveItemTo,
  removeItemAt,
  rotateItemAt,
  applyAction,
  isOpen,
  itemActions,
  itemCounts,
  stateProblem,
  storeAt,
  takeOutAt,
  layoutProblem,
  MAPS,
  mapFor,
  mapsOf,
  monthSpace,
  monthState,
  onTopOf,
  plotOf,
  powerKey,
  sanitizeLayout,
  seatOf,
  seasonMonths,
  spaceSize,
  speciesOf,
  stageOf,
  supportOf,
  wallBlocked,
  type PlacedItem,
  type SpaceLayout,
  type WorldCtx,
} from './world';
import { canStep, entryOf, regionAt, regionOf, worldBlocked, worldPlan } from './worldPlan';
import { DEFAULT_LOOK, lookProblem, normalizeEquipped, normalizeLook, randomLook, slotItems, wear } from './avatar';
import { SUBS } from './catalog';
import { TREE_STAGES } from '../../supabase/functions/_shared/report';
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
    '09-23:10 09-24:10 09-25:10 09-28:10 09-29:20 09-30:20 10-01:20 10-02:20 10-06:10 10-07:10 10-08:10 10-09:20',
  );
  // Kısa gün (20 dk'dan az) seriyi sürdürür ama bonus vermez
  const short = computeStreak((d) => (d === '2026-09-23' ? 15 : set(...days)(d)), days[0], '2026-10-09');
  assert.equal(short.streak, 7);
  assert.equal(short.bonus.has('2026-09-23'), false);
  // İki günlük seri bir kaçırmada 0'a iner
  assert.equal(computeStreak(set('2026-10-05', '2026-10-06', '2026-10-08'), '2026-10-05', '2026-10-08').streak, 1);
});

test('istatistik + kutlama: her gün bir ağaç (elle yazılan da sayılır), gün içinde büyür; yeni harita kutlanır', () => {
  const base = { reflections: [], doneTasks: 0, today: MON };
  const l = (id: string, min: number, extra: Partial<StudyLog> = {}): StudyLog => ({ ...log(MON, min), id, created_at: `${MON}T1${id.length}:00:00Z`, ...extra });
  const none = computeStats({ ...base, logs: [] });
  const before = computeStats({ ...base, logs: [l('a', 20)] });
  assert.equal(before.forest.length, 1);
  assert.equal(before.forest[0].stage.id, 'kucuk');
  assert.match(diffStats(none, before).find((x) => x.kind === 'tree')!.title, /Bugünün ağacı/);
  // Aynı gün elle yazılan süre de sayılır: ağaç büyür, ama Elmas/seviye için güvenilir dakika değişmez
  const after = computeStats({ ...base, logs: [l('a', 20), l('m', 70, { source: 'manual' })] });
  assert.equal(after.forest.length, 1, 'günde tek ağaç');
  assert.deepEqual([after.forest[0].minutes, after.forest[0].manual, after.forest[0].stage.id], [90, 70, 'buyuk']);
  assert.equal(after.treeCount, 1);
  assert.equal(after.trustedMinutes, 20);
  assert.match(diffStats(before, after).find((x) => x.kind === 'tree')!.title, /Ağacın büyüdü/);
  // Yalnızca elle yazılmış bir gün de ağaç verir
  const manualDay = computeStats({ ...base, logs: [{ ...log(addDays(MON, -1), 30), source: 'manual' }] });
  assert.equal(manualDay.treeCount, 1);
  // 15 saatte arazi kendiliğinden genişler (yalnızca sayaçla ölçülen)
  const big = computeStats({ ...base, logs: Array.from({ length: 15 }, (_, i) => ({ ...log(addDays(MON, -i), 60), id: `x${i}` })) });
  assert.ok(diffStats(before, big).some((x) => x.kind === 'land' && /Dere Kenarı/.test(x.title)));
  assert.equal(big.world.map, 'dere');
  // Yarım seans: o gün başka kayıt yoksa kuru ağaç
  const dry = computeStats({ ...base, logs: [l('a', 20)], abandoned: [{ id: 'y', date: addDays(MON, -1), minutes: 12, created_at: '' }, { id: 'z', date: MON, minutes: 12, created_at: '' }] });
  assert.deepEqual(dry.forest.map((t) => [t.date, t.dry]), [[addDays(MON, -1), true], [MON, false]]);
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
  assert.equal(led.find((e) => e.kind === 'study')?.amount, 35);
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

// ---------- Dünya: haritalar, karo ızgarası, yerleştirme, yol bulma, günlük ağaçlar ----------
const ctx0: WorldCtx = { map: 'acik', today: MON, rooms: [] };
const owned1 = () => 1;

test('dünya: ayak izi dönüşle değişir; yerleşim sınır, sabit karo, çakışma ve envanteri denetler', () => {
  assert.deepEqual(footprint({ w: 2, h: 1 }, 3, 2, 0).map((t) => `${t.x},${t.y}`), ['3,2', '4,2']);
  assert.deepEqual(footprint({ w: 2, h: 1 }, 3, 2, 90).map((t) => `${t.x},${t.y}`), ['3,2', '3,3']);
  for (const m of MAPS) assert.equal(layoutProblem('room', DEFAULT_ROOM, { ...ctx0, map: m.id }, owned1), null, `başlangıç odası ${m.id}`);
  const room = (items: SpaceLayout['items'], extra: Partial<SpaceLayout> = {}): SpaceLayout => ({ items, ...extra });
  const msg = (l: SpaceLayout, own = owned1, space: 'room' | 'garden' = 'room', ctx = ctx0) => layoutProblem(space, l, ctx, own)?.message ?? null;
  assert.match(msg(room([{ item: 'mob:masa', x: 11, y: 3, rot: 0 }]))!, /dışına/);
  assert.equal(msg(room([{ item: 'mob:masa', x: 11, y: 3, rot: 90 }])), null);
  assert.match(msg(room([{ item: 'mob:masa', x: 3, y: 8, rot: 90 }]))!, /boş değil/); // ön kapı
  assert.match(msg(room([{ item: 'mob:masa', x: 1, y: 2, rot: 0 }, { item: 'mob:sandalye', x: 2, y: 2, rot: 0 }]))!, /dolu/);
  assert.match(msg(room([{ item: 'mob:sehpa', x: 1, y: 1, rot: 180 }]))!, /döndürülemez/);
  assert.match(msg(room([{ item: 'dis:cit', x: 1, y: 1, rot: 0 }]))!, /dışarıda/);
  assert.match(msg(room([{ item: 'mob:sandalye', x: 1, y: 1, rot: 0 }]), owned1, 'garden')!, /içeride/);
  assert.match(msg(room([], { floor: 'zemin:dama' }), (i) => (i.id === 'zemin:dama' ? 0 : 1))!, /kaplama/);
  // Halı (zemin katmanı) üstüne koltuk konur; iki halı üst üste konmaz
  const own2 = () => 2;
  assert.equal(msg(room([{ item: 'hali:dikdortgen', x: 2, y: 3, rot: 0 }, { item: 'mob:koltuk-mavi', x: 2, y: 3, rot: 0 }]), own2), null);
  assert.match(msg(room([{ item: 'hali:dikdortgen', x: 2, y: 3, rot: 0 }, { item: 'hali:yuvarlak', x: 3, y: 3, rot: 0 }]), own2)!, /dolu/);
  // Envanter: iki koltuk için iki tane gerekir; diğer alanlarda kullanılanlar da sayılır
  const two = room([{ item: 'mob:koltuk-mavi', x: 2, y: 3, rot: 0 }, { item: 'mob:koltuk-mavi', x: 2, y: 5, rot: 0 }]);
  assert.match(msg(two)!, /envanterinde yok/);
  assert.equal(layoutProblem('room', two, ctx0, own2), null);
  assert.match(layoutProblem('room', two, ctx0, own2, () => 1)!.message, /envanterinde yok/);
  // Önizleme: konabilir/konamaz
  assert.equal(canPlaceAt('room', DEFAULT_ROOM, ctx0, { item: 'mob:koltuk-mavi', x: 8, y: 7, rot: 0 }), true);
  assert.equal(canPlaceAt('room', DEFAULT_ROOM, ctx0, { item: 'mob:koltuk-mavi', x: 5, y: 0, rot: 0 }), false);
  assert.equal(canPlaceAt('room', DEFAULT_ROOM, ctx0, { item: 'mob:masa', x: 5, y: 0, rot: 0 }, 2), true, 'kendi yerine geri konur');
});

test('gezinti: taşınan eşya karakterin önüne konur; duvar süsü duvara bakınca', () => {
  const o = { x: 10, y: 0 };
  const desk = { w: 2, h: 1, placement: 'indoor' as const };
  // Karakter (13.5, 4.5) → yerel karo (3, 4)
  assert.deepEqual(carrySpot(desk, 0, 13.5, 4.5, 0, o), { x: 3, y: 5 }, 'güney');
  assert.deepEqual(carrySpot(desk, 0, 13.5, 4.5, Math.PI, o), { x: 3, y: 3 }, 'kuzey');
  assert.deepEqual(carrySpot(desk, 0, 13.5, 4.5, Math.PI / 2, o), { x: 4, y: 4 }, 'doğu');
  assert.deepEqual(carrySpot(desk, 0, 13.5, 4.5, -Math.PI / 2, o), { x: 1, y: 4 }, 'batı: ayak izi bitişik');
  assert.deepEqual(carrySpot(desk, 90, 13.5, 4.5, Math.PI / 2, o), { x: 4, y: 4 }, '90°: 1×2');
  assert.deepEqual(carrySpot({ w: 3, h: 1 }, 0, 13.5, 4.5, 0, o), { x: 2, y: 5 }, 'yanlamasına ortalı');
  const art = { w: 2, placement: 'wall' as const };
  assert.deepEqual(carrySpot(art, 0, 13.5, 0.5, Math.PI, o), { x: 3, y: -1 }, 'arka duvar');
  assert.deepEqual(carrySpot(art, 0, 10.5, 4.5, -Math.PI / 2, o), { x: -1, y: 4 }, 'sol duvar');
  assert.equal(carrySpot(art, 0, 13.5, 4.5, Math.PI, o), null, 'duvardan uzak');
});

test('dünya: küçük eşya masanın üstüne ya da yere konur; duvar süsü duvara asılır', () => {
  const own = () => 3;
  const desk = { item: 'mob:masa', x: 1, y: 2, rot: 0 };
  const lay = (...items: SpaceLayout['items']): SpaceLayout => ({ items });
  const msg = (l: SpaceLayout) => layoutProblem('room', l, ctx0, own)?.message ?? null;
  assert.equal(msg(lay(desk, { item: 'mob:laptop', x: 1, y: 2, rot: 0 }, { item: 'isik:masa-lambasi', x: 2, y: 2, rot: 0 })), null, 'masanın üstünde');
  assert.equal(msg(lay({ item: 'mob:laptop', x: 1, y: 2, rot: 0 }, desk)), null, 'sıra önemli değil');
  assert.equal(msg(lay(desk, { item: 'mob:laptop', x: 4, y: 4, rot: 0 })), null, 'yerde');
  assert.match(msg(lay(desk, { item: 'mob:laptop', x: 1, y: 2, rot: 0 }, { item: 'mob:radyo', x: 1, y: 2, rot: 0 }))!, /dolu/);
  assert.match(msg(lay(desk, { item: 'mob:tv', x: 2, y: 2, rot: 0 }))!, /Yarısı/);
  assert.match(msg(lay(desk, { item: 'mob:sandalye', x: 1, y: 2, rot: 0 }))!, /dolu/, 'büyük eşya masanın üstüne konmaz');
  const top = lay(desk, { item: 'mob:laptop', x: 1, y: 2, rot: 0 }, { item: 'mob:radyo', x: 6, y: 6, rot: 0 });
  assert.deepEqual(onTopOf(top, 0), [1]);
  assert.equal(supportOf(top, top.items[1]), 0);
  assert.equal(supportOf(top, top.items[2]), null);
  // Duvar: arka duvar y = -1, sol duvar x = -1; pencere ve kapının üstüne asılmaz
  assert.equal(msg(lay({ item: 'duvar:gezegenler', x: 1, y: -1, rot: 0 }, { item: 'duvar:harita', x: -1, y: 1, rot: 270 })), null);
  assert.match(msg(lay({ item: 'duvar:gezegenler', x: 6, y: -1, rot: 0 }))!, /boş değil/, 'pencere');
  assert.match(msg(lay({ item: 'duvar:harita', x: -1, y: 4, rot: 270 }))!, /boş değil/, 'kütüphane kapısı');
  assert.match(msg(lay({ item: 'duvar:gezegenler', x: 1, y: 2, rot: 0 }))!, /duvara/);
  assert.match(msg(lay({ item: 'duvar:gezegenler', x: 1, y: -1, rot: 270 }))!, /duvara/);
  assert.match(msg(lay({ item: 'duvar:harita', x: 11, y: -1, rot: 0 }))!, /dışına/);
  assert.match(msg(lay({ item: 'duvar:saat', x: 4, y: -1, rot: 0 }, { item: 'duvar:harita', x: 3, y: -1, rot: 0 }))!, /dolu/);
  assert.match(layoutProblem('garden', lay({ item: 'duvar:saat', x: 5, y: -1, rot: 0 }), ctx0, own)!.message, /odalara/);
  assert.ok(wallBlocked('library', ctx0).has('0,-1'), 'gömme rafların üstü');
  assert.equal(canPlaceAt('room', lay(desk), ctx0, { item: 'mob:laptop', x: 2, y: 2, rot: 0 }), true);
  // Oyunda kaldır, döndür, taşı (aynı alan): masayla üstündeki dizüstü birlikte envantere döner
  assert.deepEqual(removeItemAt(top, 0).items.map((p) => p.item), ['mob:radyo']);
  assert.deepEqual(removeItemAt(top, 2).items.map((p) => p.item), ['mob:masa', 'mob:laptop']);
  assert.equal(rotateItemAt('room', top, 0, ctx0)!.items[0].rot, 90);
  assert.equal(rotateItemAt('room', lay({ item: 'duvar:harita', x: 3, y: -1, rot: 0 }), 0, ctx0), null, 'duvar süsü dönmez');
  const moved = moveItemTo('room', top, 0, { x: 4, y: 4 }, 0, ctx0)!;
  assert.deepEqual(moved.items, [{ item: 'mob:radyo', x: 6, y: 6, rot: 0 }, { item: 'mob:masa', x: 4, y: 4, rot: 0 }]);
  assert.equal(moveItemTo('room', top, 0, { x: 5, y: 6 }, 0, ctx0), null, 'radyonun üstüne konmaz');
  assert.deepEqual(moveItemTo('room', lay({ item: 'duvar:harita', x: 3, y: -1, rot: 0 }), 0, { x: -1, y: 2 }, 0, ctx0)!.items[0], { item: 'duvar:harita', x: -1, y: 2, rot: 270 });
  // Ayıklama: kuralı bozan eşyalar envantere döner
  const bad = sanitizeLayout('room', lay(desk, { item: 'mob:masa', x: 3, y: 8, rot: 90 }, { item: 'yok', x: 0, y: 0, rot: 0 }, { item: 'mob:laptop', x: 1, y: 2, rot: 0 }), ctx0, owned1);
  assert.equal(bad.dropped, 2);
  assert.deepEqual(bad.layout.items.map((p) => p.item), ['mob:masa', 'mob:laptop']);
  assert.equal(bad.layout.floor, 'zemin:ahsap');
});

test('arazi: saatle yerinde büyür; büyüyünce eski yerleşimler geçerli kalır', () => {
  assert.deepEqual(spaceSize('room', ctx0), { w: 12, h: 10 });
  assert.deepEqual(spaceSize('room', { ...ctx0, map: 'sahil' }), { w: 20, h: 14 });
  assert.deepEqual([0, 14.9 * 60, 15 * 60, 79 * 60, 1e6].map((m) => mapFor(m).id), ['acik', 'acik', 'dere', 'tepe', 'sahil']);
  const m0 = mapsOf(0);
  assert.deepEqual([m0.current.id, m0.unlocked.map((m) => m.id), m0.next?.id], ['acik', ['acik'], 'dere']);
  assert.deepEqual([mapsOf(50 * 60).current.id, mapsOf(1e6).next], ['tepe', null]);
  const solidKind = (f: { kind: string }) => f.kind !== 'door' && f.kind !== 'gate';
  for (const [i, m] of MAPS.entries()) {
    const ctx = { ...ctx0, map: m.id };
    // Ev bloğu: kütüphane | oda, arka duvarlar hizalı; bahçe evin önünü tamamen kaplar
    assert.equal(m.library.h, m.room.h, `${m.id} kütüphane ve oda aynı derinlikte`);
    assert.ok(m.garden.w >= m.library.w + m.room.w, `${m.id} bahçe evden geniş`);
    for (const s of ['room', 'library', 'garden'] as const) assert.ok(m[s].fixed.filter((f) => f.kind === 'door' || f.kind === 'gate').every((f) => f.edge), `${m.id} ${s} kapı kenarı`);
    assert.equal(layoutProblem('room', DEFAULT_ROOM, ctx, owned1), null, `başlangıç odası ${m.id}`);
    if (!i) continue;
    const prev = MAPS[i - 1];
    const pctx = { ...ctx0, map: prev.id };
    assert.ok(m.hours > prev.hours);
    for (const s of ['room', 'library', 'garden'] as const) {
      assert.ok(m[s].w >= prev[s].w && m[s].h >= prev[s].h, `${m.id} ${s} küçülmez`);
      // Eski alanın içinde yeni bir sabit karo çıkmaz (kayıtlı eşyalar geçersiz olmasın); eski özellikler kalır
      const a = fixedTiles(s, pctx);
      const b = fixedTiles(s, ctx);
      for (const [k, f] of b) {
        const [x, y] = k.split(',').map(Number);
        if (x < prev[s].w && y < prev[s].h) assert.ok(a.has(k), `${m.id} ${s} ${k} ${f.kind} eski alanda yeni`);
      }
      for (const [k, f] of a) if (solidKind(f)) assert.equal(b.get(k)?.kind, f.kind, `${m.id} ${s} ${k} kalır`);
      const wa = wallBlocked(s, pctx);
      for (const k of wallBlocked(s, ctx)) assert.ok(wa.has(k) || Number(k.split(',')[0]) >= prev[s].w, `${m.id} ${s} duvar ${k}`);
    }
  }
  const g = fixedTiles('garden', ctx0);
  assert.deepEqual([g.get('12,0')?.to, g.get('23,6')?.to], ['room', 'forest']);
  const b = blockedTiles('garden', { items: [] }, { ...ctx0, map: 'dere' });
  assert.ok(b.has('25,0') && !b.has('25,6') && !b.has('12,0'), 'dere yürünmez, köprü ve kapı yürünür');
  assert.equal(fixedTiles('library', ctx0).get('0,0')?.kind, 'shelf');
});

test('dünya planı: ev, bahçe, yol ve ay bahçeleri tek dünyada; bölgeler arası yalnızca kapıdan geçilir', () => {
  for (const m of MAPS) {
    const plan = worldPlan({ ...ctx0, map: m.id });
    // Alanlar çakışmaz (yol parçaları kendi aralarında çakışabilir)
    const solid = plan.regions.filter((r) => r.id !== 'trail');
    let area = 0;
    for (const r of solid) {
      area += r.w * r.h;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) assert.equal(regionAt(plan, { x, y })?.id, r.id, `${m.id} ${r.id} ${x},${y}`);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= plan.w && r.y + r.h <= plan.h);
    }
    assert.equal(plan.grid.filter((i) => i && plan.regions[i - 1].id !== 'trail').length, area, `${m.id} çakışma yok`);
    for (const l of plan.links) {
      const [a, b] = l.split('>').map((t) => t.split(',').map(Number));
      assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, l);
      assert.notEqual(regionAt(plan, { x: a[0], y: a[1] })!.id, regionAt(plan, { x: b[0], y: b[1] })!.id, l);
    }
    // Odadan her açık ay bahçesine yürünür; kilitli bahçeye girilmez
    const blocked = worldBlocked(plan, {});
    const step = (a: { x: number; y: number }, b: { x: number; y: number }) => canStep(plan, a, b);
    const from = entryOf(plan, 'room')!;
    for (const month of plan.months) {
      const r = regionOf(plan, monthSpace(month))!;
      const path = findPath(from, entryOf(plan, r.id)!, plan.w, plan.h, blocked, step);
      if (monthState(month, MON) === 'open') assert.ok(path, `${m.id} ${month} yolu`);
      else assert.equal(path, null, `${m.id} ${month} kilitli`);
    }
    assert.ok(findPath(from, entryOf(plan, 'library')!, plan.w, plan.h, blocked, step), `${m.id} kütüphane`);
  }
  const plan = worldPlan(ctx0);
  assert.deepEqual([plan.months.length, plan.months[0]], [10, '2026-09']);
  const room = regionOf(plan, 'room')!;
  const lib = regionOf(plan, 'library')!;
  // Ön kapı (3, 9) → bahçe; yanındaki karodan geçilmez
  assert.equal(canStep(plan, { x: room.x + 3, y: 9 }, { x: room.x + 3, y: 10 }), true);
  assert.equal(canStep(plan, { x: room.x + 4, y: 9 }, { x: room.x + 4, y: 10 }), false);
  // Kütüphane kapısı (oda 0,5 ↔ kütüphane 8,5); duvarın başka yerinden geçilmez
  assert.equal(canStep(plan, { x: room.x, y: 5 }, { x: lib.x + 8, y: 5 }), true);
  assert.equal(canStep(plan, { x: room.x, y: 4 }, { x: lib.x + 8, y: 4 }), false);
  // Gezintide de duvardan geçilmez: kapının yanından bahçeye yürünemez
  const blocked = worldBlocked(plan, {});
  const step = (a: { x: number; y: number }, b: { x: number; y: number }) => canStep(plan, a, b);
  const at = resolveMove([room.x + 5.5, 9.5], [room.x + 5.5, 10.6], blocked, plan.w, plan.h, step);
  assert.ok(at[1] < 10, 'ön duvar');
  const door = resolveMove([room.x + 3.5, 9.5], [room.x + 3.5, 10.6], blocked, plan.w, plan.h, step);
  assert.ok(door[1] > 10, 'kapıdan çıkılır');
});

test('odalar: kilitsiz, şablon şekilli; odanın doğusunda sırayla, kapıdan girilir', () => {
  // Her şablon ve boyut kurala uyar: arka sıra ve sol sütun dolu (duvarlar düz), kapılar zeminde, derinlik en
  // küçük haritanın odasını geçmez (bahçe ve yolla çakışmasın), zemin tek parça ve parçalar zemini tam kaplar
  const minH = Math.min(...MAPS.map((m) => m.room.h));
  for (const sh of ROOM_SHAPES) {
    let last = 0;
    for (const z of ROOM_SIZES) {
      const c = sh.sizes[z.id];
      const tag = `${sh.id} ${z.id}`;
      assert.ok(c.h >= 6 && c.h <= minH, `${tag} derinlik`);
      for (let x = 0; x < c.w; x++) assert.ok(inCells(c, x, 0), `${tag} arka sıra`);
      for (let y = 0; y < c.h; y++) assert.ok(inCells(c, 0, y), `${tag} sol sütun`);
      assert.ok(inCells(c, c.w - 1, 5), `${tag} doğu kapısı`);
      const floor: string[] = [];
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (inCells(c, x, y)) floor.push(`${x},${y}`);
      assert.ok(floor.length > last, `${tag} büyür`);
      last = floor.length;
      const covered = cellRects(c).flatMap(([x0, y0, w, h]) => Array.from({ length: w * h }, (_, i) => `${x0 + (i % w)},${y0 + Math.floor(i / w)}`));
      assert.deepEqual(covered.sort(), [...floor].sort(), `${tag} zemin parçaları`);
      const seen = new Set(['0,0']);
      const todo = ['0,0'];
      while (todo.length) {
        const [x, y] = todo.pop()!.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y + dy}`;
          if (!inCells(c, x + dx, y + dy) || seen.has(k)) continue;
          seen.add(k);
          todo.push(k);
        }
      }
      assert.equal(seen.size, floor.length, `${tag} tek parça`);
    }
  }
  for (const k of ROOM_KINDS) assert.ok(itemById(k.floor)?.category === 'zemin' && itemById(k.wall)?.category === 'duvar', `${k.id} kaplaması`);
  // 0, 1 ve en çok odayla: sırayla doğuda, çakışmaz, hepsine kapıdan yürünür, ay bahçeleri evden sonra
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `o${i}`,
      kind: ROOM_KINDS[i % ROOM_KINDS.length].id,
      shape: ROOM_SHAPES[i % ROOM_SHAPES.length].id,
      size: ROOM_SIZES[i % 3].id,
      name: `Oda ${i}`,
      pos: i,
    }));
  for (const m of MAPS) {
    for (const n of [0, 1, CFG.world.maxRooms]) {
      const ctx = { ...ctx0, map: m.id, rooms: mk(n) };
      const plan = worldPlan(ctx);
      const tag = `${m.id} ${n}`;
      const rooms = plan.regions.filter((r) => isRoom(r.id));
      assert.deepEqual(rooms.map((r) => r.id), ctx.rooms.map((r) => roomSpace(r.id)), tag);
      const cells = (r: (typeof plan.regions)[number]) => (r.cells ? cellRects(r.cells).reduce((a, [, , w, h]) => a + w * h, 0) : r.w * r.h);
      const area = plan.regions.filter((r) => r.id !== 'trail').reduce((a, r) => a + cells(r), 0);
      assert.equal(plan.grid.filter((i) => i && plan.regions[i - 1].id !== 'trail').length, area, `${tag} çakışma yok`);
      const houseEnd = Math.max(...rooms.map((r) => r.x + r.w), 0);
      for (const r of plan.regions.filter((x) => isMonthSpace(x.id))) assert.ok(r.x > houseEnd, `${tag} ${r.id}`);
      const blocked = worldBlocked(plan, {});
      const step = (a: { x: number; y: number }, b: { x: number; y: number }) => canStep(plan, a, b);
      const from = entryOf(plan, 'room')!;
      for (const r of rooms) assert.ok(findPath(from, entryOf(plan, r.id)!, plan.w, plan.h, blocked, step), `${tag} ${r.id} yolu`);
      assert.ok(findPath(from, entryOf(plan, 'garden')!, plan.w, plan.h, blocked, step), `${tag} bahçe`);
    }
  }
  // Kesik karo dışarısıdır: eşya konmaz, kimsenin bölgesi değil
  const L = { id: 'l1', kind: 'kitchen', shape: 'l', size: 'm' as const, name: 'L mutfak', pos: 0 };
  const lctx = { ...ctx0, rooms: [L] };
  const plan = worldPlan(lctx);
  const lr = regionOf(plan, 'r:l1')!;
  assert.equal(regionAt(plan, { x: lr.x + 7, y: 7 }), null, 'kesik dünyada boş');
  assert.equal(canPlaceAt('r:l1', { items: [] }, lctx, { item: 'mob:sandalye', x: 7, y: 7, rot: 0 }), false, 'kesik');
  assert.equal(canPlaceAt('r:l1', { items: [] }, lctx, { item: 'mob:sandalye', x: 2, y: 7, rot: 0 }), true);
  assert.equal(canPlaceAt('r:l1', { items: [] }, lctx, { item: 'mob:sandalye', x: 0, y: 5, rot: 0 }), false, 'kapı karosu');
  assert.equal(canPlaceAt('room', { items: [] }, lctx, { item: 'mob:sandalye', x: 11, y: 5, rot: 0 }), false, 'odanın doğu kapısı');
  assert.equal(layoutProblem('r:l1', { floor: 'zemin:ahsap', items: [{ item: 'duvar:saat', x: 3, y: -1, rot: 0 }] }, lctx, owned1), null, 'duvar süsü');
  assert.match(layoutProblem('r:yok', { items: [] }, lctx, owned1)!.message, /oda yok/);
  assert.equal(defaultCover('r:l1', 'floor', lctx), 'zemin:dama');
  // Oda küçülünce sığmayan eşyalar envantere döner
  const lay = { items: [{ item: 'mob:sandalye', x: 2, y: 2, rot: 0 }, { item: 'mob:kitaplik', x: 9, y: 2, rot: 0 }] };
  assert.equal(sanitizeLayout('r:l1', lay, { ...ctx0, rooms: [{ ...L, shape: 'kare', size: 's' as const }] }, owned1).dropped, 1);
  assert.equal(roomInputProblem({ kind: 'kitchen', shape: 'l', size: 'm', name: 'Mutfak' }), null);
  assert.match(roomInputProblem({ kind: 'kitchen', shape: 'l', size: 'm', name: '  ' })!, /adı/);
  assert.match(roomInputProblem({ kind: 'uzay', shape: 'l', size: 'm', name: 'x' })!, /türü/);
  assert.match(roomInputProblem({ kind: 'kitchen', shape: 'l', size: 'xl', name: 'x' })!, /boyu/);
  // En iyi seri yine hesaplanır (rozetler): 10 günlük seri, sonra bir kaçırma → en iyi 10
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
  assert.equal(bestStreakOf(days.map((d) => log(d, 30)), [], '2026-10-09'), 10);
});

test('demo API: oda ekle, değiştir, sil; en çok maxRooms', async () => {
  const api = localApi(() => ({ courses: [], logs: [], tasks: [], reflections: [] }));
  const a = await api.addRoom({ kind: 'kitchen', shape: 'l', size: 'm', name: ' Mutfak ' });
  assert.match(a.id, /^[a-z0-9]{1,12}$/);
  assert.equal(a.name, 'Mutfak');
  await api.saveSpace(roomSpace(a.id), { items: [{ item: 'mob:sandalye', x: 2, y: 2, rot: 0 }] });
  await assert.rejects(api.saveSpace(roomSpace(a.id), { items: [{ item: 'mob:sandalye', x: 7, y: 7, rot: 0 }] }), /boş değil/);
  await assert.rejects(api.saveSpace('r:yok', { items: [] }), /oda yok/);
  await api.updateRoom(a.id, { kind: 'bath', shape: 'kare', size: 's', name: 'Banyo' });
  assert.deepEqual((await api.listRooms()).map((r) => [r.kind, r.shape, r.size, r.name]), [['bath', 'kare', 's', 'Banyo']]);
  await assert.rejects(api.addRoom({ kind: 'kitchen', shape: 'yok', size: 'm', name: 'x' }), /şekli/);
  for (let i = 1; i < CFG.world.maxRooms; i++) await api.addRoom({ kind: 'free', shape: 'kare', size: 's', name: `Oda ${i}` });
  await assert.rejects(api.addRoom({ kind: 'free', shape: 'kare', size: 's', name: 'Fazla' }), /En çok/);
  assert.deepEqual((await api.listRooms()).map((r) => r.pos), Array.from({ length: CFG.world.maxRooms }, (_, i) => i));
  await api.deleteRoom(a.id);
  assert.equal((await api.listRooms()).length, CFG.world.maxRooms - 1);
  assert.ok(!(await api.listSpaces()).some((x) => x.space === roomSpace(a.id)), 'yerleşimi de silinir');
});

test('eşyalar: otur/yat/sallan noktası, yaklaşılan karo ve aç-kapa', () => {
  const chair = itemById('mob:sandalye')!;
  const sofa = itemById('mob:koltuk-mavi')!;
  const bed = itemById('mob:yatak')!;
  const s0 = seatOf(sofa, { item: sofa.id, x: 4, y: 7, rot: 0 })!;
  assert.deepEqual([s0.kind, s0.x, s0.face], ['sit', 5, 0]);
  assert.ok(s0.z < 7.5 && s0.z > 7.4, 'oturak biraz arkada');
  assert.equal(seatOf(sofa, { item: sofa.id, x: 4, y: 7, rot: 180 })!.face, -Math.PI);
  assert.equal(seatOf(bed, { item: bed.id, x: 0, y: 0, rot: 0 })!.kind, 'lie');
  assert.equal(seatOf(itemById('isik:ayakli')!, { item: 'isik:ayakli', x: 0, y: 0, rot: 0 }), null);
  // Sandalyeye önünden yaklaşılır (0° güney, 90° batı, 180° kuzey, 270° doğu); önü doluysa yanından
  const at = (rot: number, blocked = new Set<string>()) => approachTile(chair, { item: chair.id, x: 2, y: 2, rot }, 6, 6, blocked);
  assert.deepEqual([0, 90, 180, 270].map((r) => at(r)), [{ x: 2, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 2 }]);
  assert.deepEqual(at(0, new Set(['2,3'])), { x: 3, y: 2 });
  assert.equal(at(0, new Set(['2,3', '1,2', '3,2', '2,1'])), null);
  // Yatağa yandan
  const b = approachTile(bed, { item: bed.id, x: 2, y: 1, rot: 0 }, 6, 6, new Set())!;
  assert.ok((b.x === 1 || b.x === 3) && (b.y === 1 || b.y === 2), 'yatağın yanı');
  // Işık varsayılan açık, TV ve ateş kapalı; eşyanın kendi durumu baskın; eşya taşınınca anahtar değişir
  const lamp = itemById('isik:ayakli')!;
  const tv = itemById('mob:tv')!;
  const at0 = (it: typeof lamp, extra: Partial<PlacedItem> = {}): PlacedItem => ({ item: it.id, x: 1, y: 1, rot: 0, ...extra });
  assert.deepEqual([isOn(lamp, at0(lamp)), isOn(tv, at0(tv)), isOn(lamp, at0(lamp, { on: false })), isOn(tv, at0(tv, { on: true })), isOn(chair, at0(chair, { on: true }))], [true, false, false, true, false]);
  const k = powerKey('room', at0(lamp));
  assert.notEqual(k, powerKey('room', { item: lamp.id, x: 2, y: 1, rot: 0 }));
  // Katalog: kullanılan eşyalar yerleştirilebilir; poz eşyalarının oturağı, TV'lerin ekranı var
  for (const it of ITEMS.filter((i) => i.behaviors.length)) {
    assert.ok(it.placement && it.w && it.h, it.id);
    if (poseOf(it)) assert.ok(it.placement !== 'wall' && it.seat, it.id);
    if (it.fx === 'tv') assert.equal(it.screen?.length, 3, it.id);
  }
  for (const id of ['dis:salincak', 'mob:somine']) assert.equal(layoutProblem(id === 'mob:somine' ? 'room' : 'garden', { items: [{ item: id, x: 9, y: 2, rot: 0 }] }, ctx0, () => 1), null, id);
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
  // Odada eşyaların çevresinden kapıya
  const room = blockedTiles('room', DEFAULT_ROOM, ctx0);
  assert.ok(findPath({ x: 6, y: 6 }, { x: 3, y: 9 }, 12, 10, room));
  // Kenar kuralı: x = 2 ile 3 arası duvar, yalnızca y = 3'ten geçilir
  const wall = (a: { x: number; y: number }, b: { x: number; y: number }) => !((a.x === 2 && b.x === 3) || (a.x === 3 && b.x === 2)) || a.y === 3;
  const around = findPath({ x: 0, y: 0 }, { x: 5, y: 0 }, 6, 6, new Set(), wall)!;
  assert.ok(around.some((t) => t.x === 3 && t.y === 3));
  assert.equal(findPath({ x: 0, y: 0 }, { x: 5, y: 0 }, 6, 6, new Set(), (a, b) => wall(a, b) && a.y !== 3), null);
});

test('ağaçlar: günde bir ağaç, türü tarihten (mevsimine göre), büyüklüğü günün toplamından', () => {
  assert.deepEqual([0, 19, 20, 44, 45, 89, 90, 149, 150, 400].map((m) => stageOf(m).stage.id), ['fidan', 'fidan', 'kucuk', 'kucuk', 'orta', 'orta', 'buyuk', 'buyuk', 'dev', 'dev']);
  assert.equal(speciesOf(MON).id, speciesOf(MON).id, 'aynı gün hep aynı tür');
  const days = Array.from({ length: 120 }, (_, i) => addDays('2026-09-01', i));
  assert.ok(new Set(days.map((d) => speciesOf(d).id)).size >= 10, 'çeşitli türler');
  const fall = new Set(['akcaagac', 'ginkgo', 'elma']);
  const share = (month: string) => {
    const ds = Array.from({ length: 10 }, (_, y) => Array.from({ length: 28 }, (_, d) => `${2026 + y}-${month}-${String(d + 1).padStart(2, '0')}`)).flat();
    return ds.filter((d) => fall.has(speciesOf(d).id)).length / ds.length;
  };
  assert.ok(share('10') > share('04') * 2, 'sonbaharda turuncu türler daha sık');
  const logs = [log(MON, 20), { ...log(MON, 40, 'tr'), source: 'manual' as const }, log(addDays(MON, -1), 200), log(addDays(MON, -2), 10)];
  const abandoned: Abandoned[] = [
    { id: 'k1', date: addDays(MON, -3), minutes: 12, created_at: '' },
    { id: 'k2', date: addDays(MON, -4), minutes: 3, created_at: '' },
    { id: 'k3', date: MON, minutes: 30, created_at: '' },
  ];
  const trees = dayTrees(logs, abandoned, new Set([addDays(MON, -1)]));
  assert.deepEqual(trees.map((t) => [t.date, t.stage.id, t.dry]), [
    [addDays(MON, -3), 'orta', true],
    [addDays(MON, -2), 'fidan', false],
    [addDays(MON, -1), 'dev', false],
    [MON, 'orta', false],
  ]);
  assert.equal(trees[3].minutes, 60);
  assert.equal(trees[3].manual, 40);
  assert.ok(trees[2].glow && trees[2].flowers && !trees[3].glow && !trees[3].flowers);
  assert.match(trees[1].name, /fidanı$/);
  assert.deepEqual(creaturesOf(0), []);
  assert.deepEqual(creaturesOf(7).map((c) => c.id), ['kelebek', 'kus', 'tavsan']);
});

test('aylık bahçeler: Eylül 2026 – Haziran 2027; gelecek ay kilitli; her günün sabit bir yeri var', () => {
  const months = seasonMonths();
  assert.deepEqual([months.length, months[0], months.at(-1)], [10, '2026-09', '2027-06']);
  assert.deepEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2027-06', '2027-07'].map((m) => monthState(m, MON)), ['out', 'open', 'open', 'locked', 'locked', 'out']);
  assert.equal(monthState('2027-06', '2027-06-01'), 'open');
  assert.deepEqual(plotOf('2026-10', 1), { x: 7, y: 2 }, '1 Ekim perşembe');
  assert.deepEqual(plotOf('2026-10', 12), { x: 1, y: 6 }, '12 Ekim pazartesi');
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number);
    const n = new Date(y, mo, 0).getDate();
    const spots = Array.from({ length: n }, (_, i) => plotOf(m, i + 1));
    const size = spaceSize(monthSpace(m), ctx0);
    assert.equal(new Set(spots.map((t) => `${t.x},${t.y}`)).size, n, m);
    assert.ok(spots.every((t) => t.x > 0 && t.y > 0 && t.x < size.w - 1 && t.y < size.h - 1), m);
  }
  const oct = monthSpace('2026-10');
  const f = fixedTiles(oct, ctx0);
  assert.equal([...f.values()].filter((x) => x.kind === 'plot').length, 31);
  assert.equal(f.get('7,2')?.day, 1);
  const own = () => 5;
  assert.equal(layoutProblem(oct, { items: [{ item: 'dis:cicek-sari', x: 0, y: 0, rot: 0 }] }, ctx0, own), null);
  assert.match(layoutProblem(oct, { items: [{ item: 'dis:cicek-sari', x: 7, y: 2, rot: 0 }] }, ctx0, own)!.message, /boş değil/, 'ekim yeri');
  assert.match(layoutProblem(oct, { items: [{ item: 'mob:sandalye', x: 0, y: 0, rot: 0 }] }, ctx0, own)!.message, /içeride/);
  assert.match(layoutProblem(monthSpace('2026-11'), { items: [] }, ctx0, own)!.message, /açılmadı/);
  assert.match(layoutProblem(monthSpace('2026-08'), { items: [] }, ctx0, own)!.message, /yok/);
  // Ekim yerleri yürünmez, aralarından kapıya yürünür
  const blocked = blockedTiles(oct, { items: [] }, ctx0);
  assert.ok(blocked.has('7,2'));
  assert.ok(findPath(CFG.world.monthGarden.gate, { x: 0, y: 0 }, 15, 15, blocked));
  const stars = dailyStars(MON, oct, { w: 15, h: 15 }, blocked);
  assert.equal(stars.length, STAR_COUNT);
  assert.deepEqual(stars, dailyStars(MON, oct, { w: 15, h: 15 }, blocked));
  assert.notDeepEqual(stars, dailyStars(addDays(MON, 1), oct, { w: 15, h: 15 }, blocked));
  assert.ok(stars.every((s) => !blocked.has(`${Math.floor(s.x)},${Math.floor(s.z)}`)));
});

test('avatar: parça parça görünüş; eski kayıt çevrilir, sahip olunmayan parça giyilemez', () => {
  assert.deepEqual(normalizeLook(undefined), DEFAULT_LOOK);
  assert.deepEqual(normalizeLook({ ...DEFAULT_LOOK, hair: 'k:ust-tisort', skin: 'kırmızı', hat: 'yok' }), DEFAULT_LOOK, 'yanlış parça ve renk varsayılana döner');
  const old = normalizeEquipped({ character: 'char:male-a', accessory: 'acc:glasses', pets: ['pet:cat', 'mob:masa'] });
  assert.equal(old.look.hair, 'k:sac-kisa');
  assert.deepEqual(old.pets, ['pet:cat']);
  const p = { bestStreak: 0, planDays: 0, gold: 0, level: 0, hours: 0, trees: 0 };
  const has = (i: Parameters<typeof owns>[0]) => owns(i, [], p);
  assert.equal(lookProblem(DEFAULT_LOOK, has), null, 'başlangıç parçaları ücretsiz');
  const kep = wear(DEFAULT_LOOK, itemById('k:sap-kep')!);
  assert.equal(kep.hat, 'k:sap-kep');
  assert.match(lookProblem(kep, has)!, /Kep sende yok/);
  assert.equal(lookProblem(kep, (i) => owns(i, [{ id: 'o', item_id: 'k:sap-kep', via: 'buy', ref: null, created_at: '' }], p)), null);
  assert.match(lookProblem(wear(DEFAULT_LOOK, itemById('k:sap-tac')!), has)!, /tacı sende yok/);
  for (let i = 0; i < 20; i++) assert.equal(lookProblem(randomLook(has, String(i)), has), null);
  for (const slot of ['hair', 'top', 'bottom', 'shoes', 'hat', 'glasses', 'back'] as const) assert.ok(slotItems(slot).length >= 3, slot);
  // Ücretsiz parçalar var; bazıları yalnızca Elmasla
  assert.ok(ITEMS.some((i) => i.category === 'kiyafet' && i.acquire.kind === 'free'));
  assert.ok(ITEMS.filter((i) => i.category === 'kiyafet' && i.acquire.kind === 'buy').length >= 20);
  // Kıyafet kilitleri sunucunun doğrulayabildiği türden (saat, seviye, ağaç)
  for (const i of ITEMS.filter((x) => x.category === 'kiyafet' && x.acquire.kind === 'unlock')) assert.ok(['hours', 'level', 'trees'].includes((i.acquire as { by: string }).by), i.id);
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

test('rapor: ağaç büyüklükleri config ile aynı', () => {
  assert.deepEqual(
    TREE_STAGES.map((t) => [t.min, t.name]),
    CFG.world.stages.map((t) => [t.min, t.name]),
  );
});

// ---------- Oyun ekonomisi ----------
const entry = (e: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'ref' | 'amount'>): LedgerEntry => ({ id: `${e.kind}:${e.ref}`, currency: 'crystal', note: null, created_at: '', ...e });
const PREV = addDays(MON, -7); // geçen haftanın pazartesisi (5 Ekim)
const weekLogs = [0, 1, 2, 3, 4].map((i) => log(addDays(PREV, i), 40)).concat(log(addDays(PREV, 1), 10, 'tr'), log(addDays(PREV, 1), 10, 'fen'));
const plan1: PlanItem = { id: 'p1', date: PREV, course_id: 'mat', minutes: 30, note: null, approved: true };
const finished: Book = { ...({} as Book), id: 'kitap', title: 'K', finished_on: addDays(PREV, 2), status: 'done', created_at: '' };

test('Elmas: her dakikaya 1, günlük tavan; kademeli kural da çalışır', () => {
  assert.deepEqual([9, 45, 60, 90, 120, 150, 180, 600].map((m) => studyElmas(m)), [9, 45, 60, 90, 120, 150, 180, 300]);
  assert.deepEqual([9, 45, 90].map((m) => studyElmas(m, { tiers: [{ upTo: 60, minutesPer: 10 }, { upTo: 120, minutesPer: 20 }], dailyCap: 12 })), [0, 4, 7]);
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
  assert.equal(get('study', PREV), 40);
  assert.equal(get('study', addDays(PREV, 1)), 60); // 40 + 10 + 10
  assert.equal(get('study', addDays(PREV, 2)), 40, 'elle yazılan 100 dk sayılmaz');
  assert.deepEqual(earned.filter((e) => e.kind === 'streak').map((e) => e.ref), [2, 3, 4].map((i) => addDays(PREV, i)));
  assert.equal(get('plan', PREV), CFG.elmas.plan);
  assert.deepEqual(earned.filter((e) => e.kind === 'reflection').map((e) => e.ref), [PREV]);
  assert.deepEqual(earned.filter((e) => e.kind === 'book').map((e) => e.ref), ['k2', 'k3'], 'haftada en çok 2 kitap (aynı gün bitenlerde sıra: eklenme, id)');
  assert.equal(get('quest', `week5days:${PREV}`), 50);
  assert.equal(get('quest', `week3courses:${PREV}`), 30);
  assert.equal(get('quest', `weekBook:${PREV}`), 50);
  assert.equal(get('quest', `day30:${PREV}`), 20);
  assert.equal(get('quest', `week3plans:${PREV}`), undefined);
  assert.ok(earned.every((e) => e.currency === 'crystal'));
  // Yazılmış olan tekrar yazılmaz; gün ilerleyip artan yazılır, azalan yazılmaz
  const ledger = earned.map((e) => entry(e));
  assert.equal(pendingEarnings(ledger, earned).length, 0);
  const more = earnedEntries({ ...input, logs: [...input.logs, log(PREV, 30)] });
  assert.deepEqual(pendingEarnings(ledger, more).map((e) => [e.kind, e.ref, e.amount]), [['study', PREV, 70]]);
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
  assert.ok(owns(itemById('k:sac-kisa')!, [], p));
  assert.ok(owns(itemById('pet:pig')!, [], p), '15 ağaçta domuzcuk gelir');
  assert.ok(!owns(itemById('pet:beaver')!, [], p), '20 ağaçta kunduz');
  assert.ok(owns(itemById('pet:giraffe')!, [], p)); // 10 planlı gün
  assert.ok(!owns(itemById('pet:lion')!, [], p)); // 30 günlük seri
  assert.ok(!owns(itemById('isik:yildiz')!, [], p), '100 saatte yıldız lambası');
  assert.ok(owns(itemById('isik:yildiz')!, [], { ...p, hours: 100 }));
  assert.equal(buyCheck('pet:cat', 999, [], 0), 'Bu eşya satılmıyor.');
  assert.match(buyCheck('mob:koltuk-mavi', 100, [], 0)!, /300 💎 daha/);
  assert.equal(buyCheck('mob:koltuk-mavi', 400, [o('mob:koltuk-mavi')], 0), null, 'mobilyadan birden fazla alınır');
  assert.match(buyCheck('zemin:dama', 999, [o('zemin:dama')], 0)!, /zaten/);
  assert.match(buyCheck('k:sap-kep', 999, [o('k:sap-kep')], 0)!, /zaten/, 'kıyafet bir kez alınır');
  assert.match(buyCheck('freeze', 999, [], 2)!, /En fazla 2/);
  // Kategorili büyük katalog: her kategoride satın alınabilen eşya, ücretsiz başlangıç seti
  const placeables = ITEMS.filter((i) => i.placement);
  assert.ok(placeables.length >= 120, `${placeables.length} eşya`);
  for (const c of ['mobilya', 'isik', 'bitki', 'hali', 'duvarsus', 'zemin', 'duvar', 'dis', 'kiyafet']) assert.ok(ITEMS.some((i) => i.category === c && i.acquire.kind === 'buy'), c);
  for (const id of ['mob:yatak', 'mob:masa', 'mob:sandalye', 'mob:kitaplik', 'isik:ayakli', 'hali:dikdortgen', 'bitki:saksi']) assert.equal(itemById(id)!.acquire.kind, 'free', id);
  for (const i of placeables) {
    assert.ok((i.model || i.art || i.proc) && i.w && i.h && i.rotations?.length, i.id);
    if (i.sub) assert.ok(SUBS[i.sub], `${i.id} alt kategori`);
    if (has(i, 'ON_SURFACE')) assert.ok((i.w ?? 1) <= 2 && i.placement !== 'wall', i.id);
  }
});

test('davranışlar: katalog tutarlı, eski bayraklar yok, set parçaları ve duvar süsleri çizilir', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const pieces = new Set([...`${src('../components/world3d/Sets.tsx')}${src('../components/world3d/SetsMore.tsx')}`.matchAll(/^ {2}(?:'([a-z-]+)'|([a-zA-Z]+)): \{$/gm)].map((m) => m[1] ?? m[2]));
  const arts = src('../components/world3d/WallArts.tsx');
  for (const d of ITEM_DEFS) {
    for (const k of ['use', 'walk', 'surface', 'small', 'opens']) assert.ok(!(k in d), `${d.id}: eski alan ${k}`);
    for (const b of d.behaviors ?? []) assert.ok((BEHAVIORS as readonly string[]).includes(b), `${d.id}: ${b}`);
    const it = itemById(d.id)!;
    if (has(it, 'TOGGLE')) assert.ok(it.fx, `${d.id}: fx`);
    if (it.fx) assert.ok(has(it, 'TOGGLE'), `${d.id}: fx TOGGLE ister`);
    if (has(it, 'STORAGE')) assert.ok((it.capacity ?? 0) > 0, `${d.id}: capacity`);
    if (has(it, 'DISPENSE')) assert.ok((DISPENSE as readonly string[]).includes(it.dispense ?? ''), `${d.id}: dispense`);
    if (has(it, 'PLAY_SOUND')) assert.ok((SOUNDS as readonly string[]).includes(it.sound ?? ''), `${d.id}: sound`);
    if (has(it, 'PLAY_ANIMATION')) assert.ok(has(it, 'TOGGLE') && it.fx === 'anim' && it.anim, `${d.id}: hareket aç-kapa ile`);
    if (has(it, 'CHANGE_COLOR')) assert.ok((it.palette?.length ?? 0) > 1, `${d.id}: palette`);
    if (has(it, 'WALK_THROUGH')) assert.ok(!has(it, 'GATE') && !has(it, 'STACKABLE'), d.id);
    if (it.behaviors.length) assert.ok(it.placement, `${d.id}: davranışlı eşya yerleştirilir`);
    if (it.proc === 'set') assert.ok(pieces.has(it.piece ?? ''), `${d.id}: parça ${it.piece}`);
  }
  for (const id of ['ayna-yuvarlak', 'bayrak', 'vitray', 'pencere-yuvarlak', 'neon-kalp', 'neon-yildiz', 'asma', 'akvaryum']) assert.ok(arts.includes(`'${id}'`) || arts.includes(`${id}:`), id);
  // Katalog büyüdü: ~300 mobilya/süs (kıyafet, canlı ve dondurma hariç)
  assert.ok(ITEMS.filter((i) => !['kiyafet', 'evcil', 'diger'].includes(i.category)).length >= 300);
});

test('davranışlar: eşyanın durumu, eylemler, depo ve kapı', () => {
  const at = (item: string, extra: Partial<PlacedItem> = {}): PlacedItem => ({ item, x: 2, y: 3, rot: 0, ...extra });
  const it = (id: string) => itemById(id)!;
  // Durum alanı yalnızca davranışı olan eşyada
  assert.equal(stateProblem(it('isik:ayakli'), at('isik:ayakli', { on: false })), null);
  assert.match(stateProblem(it('mob:sandalye'), at('mob:sandalye', { on: true }))!, /açılıp kapanmaz/);
  assert.match(stateProblem(it('mob:sandalye'), { ...at('mob:sandalye'), foo: 1 } as PlacedItem)!, /geçersiz/);
  assert.equal(stateProblem(it('set:neon-lamba'), at('set:neon-lamba', { color: 4 })), null);
  assert.match(stateProblem(it('set:neon-lamba'), at('set:neon-lamba', { color: 5 }))!, /renk/);
  assert.match(stateProblem(it('set:sandik'), at('set:sandik', { stored: Array(7).fill('mob:sandalye') }))!, /doldu/);
  assert.match(stateProblem(it('set:sandik'), at('set:sandik', { stored: ['set:oyuncak-kutusu'] }))!, /konmaz/, 'depo depoya konmaz');
  assert.match(stateProblem(it('set:sandik'), at('set:sandik', { stored: ['zemin:ahsap'] }))!, /konmaz/, 'kaplama konmaz');
  assert.match(stateProblem(it('set:mama-kabi'), at('set:mama-kabi', { fed: 'dün' }))!, /geçersiz/);
  // Depodakiler envanterden sayılır; sahip olunandan fazlası olmaz, ayıklamada envantere döner
  const box = { items: [at('set:sandik', { stored: ['mob:radyo'] }), { item: 'mob:radyo', x: 8, y: 7, rot: 0 }] };
  assert.equal(itemCounts(box).get('mob:radyo'), 2);
  assert.match(layoutProblem('room', box, ctx0, () => 1)!.message, /Radyo envanterinde yok/);
  const clean = sanitizeLayout('room', { items: [at('set:sandik', { stored: ['mob:radyo', 'mob:radyo'], color: 3 })] }, ctx0, () => 1);
  assert.deepEqual(clean.layout.items, [at('set:sandik', { stored: ['mob:radyo'] })], 'uymayan durum atılır, fazlası envantere');
  // Koy / çıkar
  const one = storeAt({ items: [at('set:sandik')] }, 0, 'mob:radyo')!;
  assert.deepEqual(one.items[0].stored, ['mob:radyo']);
  assert.equal(storeAt(one, 0, 'set:sandik'), null);
  assert.equal(storeAt({ items: [at('mob:sandalye')] }, 0, 'mob:radyo'), null);
  assert.deepEqual(takeOutAt(one, 0, 0).items[0], at('set:sandik'));
  // Eylemler davranışlardan; durum değiştirenler
  const ids = (id: string, extra: Partial<PlacedItem> = {}, posed = false) => itemActions(it(id), at(id, extra), { posed, today: '2026-10-14' }).map((a) => a.id);
  assert.deepEqual(ids('mob:sandalye'), ['sit']);
  assert.deepEqual(ids('mob:sandalye', {}, true), ['stand']);
  assert.deepEqual(ids('set:neon-lamba'), ['toggle', 'color']);
  assert.deepEqual(ids('set:mutfak-buzdolabi'), ['open', 'dispense']);
  assert.deepEqual(ids('set:sandik'), ['open', 'storage']);
  assert.deepEqual(ids('set:mama-kabi'), ['feed']);
  assert.deepEqual(ids('set:mama-kabi', { fed: '2026-10-14' }), [], 'bugün mama kondu');
  assert.deepEqual(ids('mob:kitaplik'), ['books']);
  assert.equal(applyAction(it('isik:ayakli'), at('isik:ayakli'), 'toggle', '')!.on, false);
  assert.equal(applyAction(it('set:neon-lamba'), at('set:neon-lamba', { color: 4 }), 'color', '')!.color, 0);
  assert.equal(applyAction(it('set:mama-kabi'), at('set:mama-kabi'), 'feed', '2026-10-14')!.fed, '2026-10-14');
  assert.equal(applyAction(it('mob:sandalye'), at('mob:sandalye'), 'toggle', ''), null);
  // Taşıyınca durum onunla gider
  assert.deepEqual(moveItemTo('room', one, 0, { x: 5, y: 5 }, 0, ctx0)!.items[0], { item: 'set:sandik', x: 5, y: 5, rot: 0, stored: ['mob:radyo'] });
  // Bahçe kapısı: varsayılan açık (geçilir), kapatınca engeller
  const gate = (open?: boolean) => blockedTiles('garden', { items: [{ item: 'dis:bahce-kapisi', x: 3, y: 3, rot: 0, ...(open === undefined ? {} : { open }) }] }, ctx0).has('3,3');
  assert.deepEqual([gate(), gate(true), gate(false)], [false, false, true]);
  assert.equal(isOpen(it('set:sandik'), at('set:sandik')), false, 'kapak varsayılan kapalı');
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
  // çalışma 40+60+40+40+40 (dakika başı), seri 10+10+10, görevler: 5 gün, 3 ders, 5 × day30
  assert.equal(bal, 220 + 30 + 50 + 30 + 5 * 20);
  await assert.rejects(api.buyItem('mob:cift-yatak'), /Bakiye yetmiyor/);
  await assert.rejects(api.giftCrystals(CFG.elmas.giftMax + 1, 'x'), /Hediye/);
  await api.giftCrystals(300, 'test');
  await api.buyItem('zemin:dama');
  await assert.rejects(api.buyItem('zemin:dama'), /zaten sende/);
  assert.equal(balances(await api.listLedger()).crystal, bal + 300 - 350);
  await assert.rejects(api.buyItem('pet:cat'), /satılmıyor/);
  await assert.rejects(api.openChest(PREV, 'mob:masa'), /sandıktan çıkmaz/);
  await api.openChest(PREV, 'dis:halka');
  await assert.rejects(api.openChest(PREV, 'dis:halka'), /zaten açıldı/);
  await assert.rejects(api.openChest(MON, 'dis:halka'), /henüz açılmadı/);
});

test('demo API: yerleşim sunucu kurallarıyla kaydedilir; arazi saatle büyür', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...log(addDays(MON, -i), 40), id: `t${i}` }));
  const api = localApi(() => ({ courses: [], logs: many, tasks: [], reflections: [] }));
  await api.saveSpace('room', { ...DEFAULT_ROOM, floor: 'zemin:ahsap' });
  await assert.rejects(api.saveSpace('room', { items: [{ item: 'mob:koltuk-mavi', x: 3, y: 3, rot: 0 }] }), /envanterinde yok/);
  await api.syncEconomy();
  await api.buyItem('mob:koltuk-mavi');
  await api.buyItem('dis:cicek-sari');
  await api.saveSpace('room', { items: [{ item: 'mob:koltuk-mavi', x: 3, y: 3, rot: 0 }] });
  await assert.rejects(api.saveSpace('garden', { items: [{ item: 'mob:koltuk-mavi', x: 3, y: 3, rot: 0 }] }), /içeride/);
  await api.saveSpace('library', { items: [] });
  await assert.rejects(api.saveSpace('m:2099-01', { items: [] }), /yok/);
  const month = monthSpace(new Date().toISOString().slice(0, 7));
  const open = monthState(month.slice(2), new Date().toISOString().slice(0, 10)) === 'open';
  if (open) await api.saveSpace(month, { items: [{ item: 'dis:cicek-sari', x: 0, y: 0, rot: 0 }] });
  // 30 × 40 dk = 20 saat: arazi Dere Kenarı'na büyüdü; oda 14 × 11 (eski eşyalar yerinde, yeni karolara da konur)
  await api.saveSpace('room', { items: [{ item: 'mob:koltuk-mavi', x: 12, y: 9, rot: 0 }] });
  await assert.rejects(api.saveSpace('room', { items: [{ item: 'mob:koltuk-mavi', x: 14, y: 9, rot: 0 }] }), /dışına/);
  const spaces = await api.listSpaces();
  assert.deepEqual(spaces.map((x) => x.space).sort(), ['library', 'room', ...(open ? [month] : [])].sort());
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
