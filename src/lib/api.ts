import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFacts, fallbackNarrative, renderEmail } from '../../supabase/functions/_shared/report';
import { gatherReportInput } from './reportInput';
import { itemById } from './catalog';
import { CFG } from './config';
import { toLocalDate } from './date';
import { balances, chestOf, dayTotalsOf, earnedEntries, inChestPool, ownedCount, pendingEarnings, trusted } from './economy';
import { levelOf } from './level';
import { layoutProblem, type SpaceId, type SpaceLayout } from './world';
import { beat, newSession, noteProblem, pause, resume, sessionMinutes, type SessionState, type StudySession } from './session';
import {
  DEFAULT_FAMILY,
  DEFAULT_READING_GOALS,
  type FamilySettings,
  type ParentNote,
  type PlanItem,
  type Reward,
  type Abandoned,
  type Api,
  type Book,
  type Course,
  type DailyReport,
  type ReadingGoals,
  type ReportSettings,
  type SendReportResult,
  type ReadingLog,
  type Reflection,
  type StudyLog,
  type Task,
  type Equipped,
  type LedgerEntry,
  type OwnedItem,
} from './types';

// ---------- Supabase ----------
function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** PostgREST tek istekte en fazla 1000 satır döner; tüm geçmişi okuyan sorgular sayfa sayfa çekilir. */
const PAGE = 1000;
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await page(from, from + PAGE - 1)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export function supabaseApi(sb: SupabaseClient): Api {
  return {
    async listCourses() {
      return check(await sb.from('courses').select('*').order('created_at')) as Course[];
    },
    async addCourse(name, color) {
      return check(await sb.from('courses').insert({ name, color }).select().single()) as Course;
    },
    async updateCourse(id, patch) {
      check(await sb.from('courses').update(patch).eq('id', id));
    },
    async deleteCourse(id) {
      check(await sb.from('courses').delete().eq('id', id));
    },

    async listLogs(from, to) {
      return all<StudyLog>((a, b) =>
        sb.from('study_logs').select('*').gte('date', from).lte('date', to).order('created_at').order('id').range(a, b),
      );
    },
    async addLog(log) {
      return check(await sb.from('study_logs').insert(log).select().single()) as StudyLog;
    },
    async deleteLog(id) {
      check(await sb.from('study_logs').delete().eq('id', id));
    },
    async getOpenSession() {
      return check(await sb.rpc('session_open')) as SessionState | null;
    },
    async startSession(courseId, date) {
      return check(await sb.rpc('session_start', { p_course: courseId, p_date: date })) as SessionState;
    },
    async beatSession(id) {
      return check(await sb.rpc('session_beat', { p_id: id })) as SessionState;
    },
    async pauseSession(id, backSec = 0) {
      return check(await sb.rpc('session_pause', { p_id: id, p_back: Math.round(backSec) })) as SessionState;
    },
    async resumeSession(id) {
      return check(await sb.rpc('session_resume', { p_id: id })) as SessionState;
    },
    async finishSession(id, courseId, note) {
      return check(await sb.rpc('session_finish', { p_id: id, p_course: courseId, p_note: note })) as { session: StudySession; log: StudyLog };
    },
    async abandonSession(id) {
      return check(await sb.rpc('session_abandon', { p_id: id })) as StudySession;
    },

    async listTasks(date) {
      return check(await sb.from('tasks').select('*').eq('date', date).order('created_at')) as Task[];
    },
    async addTask(task) {
      return check(await sb.from('tasks').insert(task).select().single()) as Task;
    },
    async setTaskDone(id, done) {
      check(await sb.from('tasks').update({ done }).eq('id', id));
    },
    async deleteTask(id) {
      check(await sb.from('tasks').delete().eq('id', id));
    },

    async getReflection(date) {
      return check(
        await sb.from('daily_reflections').select('date,rating,note,updated_at').eq('date', date).maybeSingle(),
      ) as Reflection | null;
    },
    async listReflections(from, to) {
      return all<Reflection>((a, b) =>
        sb.from('daily_reflections').select('date,rating,note,updated_at').gte('date', from).lte('date', to).order('date').range(a, b),
      );
    },
    async upsertReflection(date, rating, note) {
      const { data: u } = await sb.auth.getUser();
      check(
        await sb.from('daily_reflections').upsert(
          { user_id: u.user?.id, date, rating, note, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,date' },
        ),
      );
    },

    async countDoneTasks() {
      const res = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('done', true);
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async listBooks() {
      return check(await sb.from('books').select('*').order('created_at')) as Book[];
    },
    async addBook(b) {
      return check(await sb.from('books').insert(b).select().single()) as Book;
    },
    async updateBook(id, patch) {
      check(await sb.from('books').update(patch).eq('id', id));
    },
    async deleteBook(id) {
      check(await sb.from('books').delete().eq('id', id));
    },
    async listReadingLogs() {
      return all<ReadingLog>((a, b) => sb.from('reading_logs').select('*').order('created_at').order('id').range(a, b));
    },
    async addReadingLog(l) {
      return check(await sb.from('reading_logs').insert(l).select().single()) as ReadingLog;
    },
    async getReadingGoals() {
      const row = check(
        await sb.from('reading_goals').select('monthly_books,daily_pages').maybeSingle(),
      ) as ReadingGoals | null;
      return row ?? DEFAULT_READING_GOALS;
    },
    async setReadingGoals(g) {
      const { data: u } = await sb.auth.getUser();
      check(
        await sb
          .from('reading_goals')
          .upsert({ user_id: u.user?.id, ...g, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }),
      );
    },
    async getReportSettings() {
      return check(
        await sb.from('report_settings').select('parent_email,child_name,send_hour,timezone,enabled').maybeSingle(),
      ) as ReportSettings | null;
    },
    async setReportSettings(r) {
      const { data: u } = await sb.auth.getUser();
      check(
        await sb
          .from('report_settings')
          .upsert({ user_id: u.user?.id, ...r, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }),
      );
    },
    async getDailyReport(date) {
      return check(
        await sb.from('daily_reports').select('date,subject,html,sent_at,generated_by').eq('date', date).eq('status', 'sent').maybeSingle(),
      ) as DailyReport | null;
    },
    async sendDailyReport(date) {
      const { data, error } = await sb.functions.invoke('daily-report', { body: { date } });
      if (error) {
        // 502 gövdesinde { status: 'error', message } döner
        const ctx = (error as { context?: Response }).context;
        const body = ctx ? await ctx.json().catch(() => null) : null;
        return { status: 'error', message: body?.message ?? body?.error ?? error.message };
      }
      return data as SendReportResult;
    },

    async listPlans(from, to) {
      return all<PlanItem>((a, b) =>
        sb.from('study_plans').select('id,date,course_id,minutes,note,approved').gte('date', from).lte('date', to).order('created_at').order('id').range(a, b),
      );
    },
    async savePlans(from, to, items, approved) {
      check(await sb.from('study_plans').delete().gte('date', from).lte('date', to));
      if (items.length) check(await sb.from('study_plans').insert(items.map((i) => ({ ...i, approved }))));
    },
    async approvePlans(from, to) {
      check(await sb.from('study_plans').update({ approved: true }).gte('date', from).lte('date', to).eq('approved', false));
    },
    async getFamily() {
      const row = check(
        await sb.from('family_settings').select('pin_hash,require_plan_approval').maybeSingle(),
      ) as FamilySettings | null;
      return row ?? DEFAULT_FAMILY;
    },
    async setFamily(f) {
      const { data: u } = await sb.auth.getUser();
      check(
        await sb
          .from('family_settings')
          .upsert({ user_id: u.user?.id, ...f, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }),
      );
    },
    async listNotes(limit) {
      return check(
        await sb.from('parent_notes').select('id,text,reaction,created_at').order('created_at', { ascending: false }).limit(limit),
      ) as ParentNote[];
    },
    async addNote(text) {
      return check(await sb.from('parent_notes').insert({ text }).select('id,text,reaction,created_at').single()) as ParentNote;
    },
    async reactNote(id, reaction) {
      check(await sb.from('parent_notes').update({ reaction }).eq('id', id));
    },
    async deleteNote(id) {
      check(await sb.from('parent_notes').delete().eq('id', id));
    },
    async listAbandoned() {
      return all<Abandoned>((a, b) => sb.from('abandoned_sessions').select('id,date,minutes,created_at').order('created_at').order('id').range(a, b));
    },
    async addAbandoned(a) {
      return check(await sb.from('abandoned_sessions').insert(a).select('id,date,minutes,created_at').single()) as Abandoned;
    },
    async listRewards() {
      return check(
        await sb.from('rewards').select('id,title,kind,target,given_by,start_date,claimed_on,created_at').order('created_at'),
      ) as Reward[];
    },
    async addReward(r) {
      return check(
        await sb.from('rewards').insert(r).select('id,title,kind,target,given_by,start_date,claimed_on,created_at').single(),
      ) as Reward;
    },
    async updateReward(id, patch) {
      check(await sb.from('rewards').update(patch).eq('id', id));
    },
    async deleteReward(id) {
      check(await sb.from('rewards').delete().eq('id', id));
    },
    async listLedger() {
      return all<LedgerEntry>((a, b) =>
        sb.from('crystal_ledger').select('id,currency,kind,ref,amount,note,created_at').order('created_at').order('id').range(a, b),
      );
    },
    async syncEconomy() {
      check(await sb.rpc('economy_sync'));
    },
    async collectStar(date, index) {
      check(await sb.rpc('collect_star', { p_date: date, p_index: index }));
    },
    async giftCrystals(amount, note) {
      check(await sb.rpc('gift_elmas', { p_amount: amount, p_note: note }));
    },
    async listOwned() {
      return all<OwnedItem>((a, b) => sb.from('owned_items').select('id,item_id,via,ref,created_at').order('created_at').order('id').range(a, b));
    },
    async buyItem(itemId) {
      return check(await sb.from('owned_items').insert({ item_id: itemId, via: 'buy' }).select('id,item_id,via,ref,created_at').single()) as OwnedItem;
    },
    async openChest(week, itemId) {
      return check(
        await sb.from('owned_items').insert({ item_id: itemId, via: 'chest', ref: week }).select('id,item_id,via,ref,created_at').single(),
      ) as OwnedItem;
    },
    async getEquipped() {
      const row = check(await sb.from('family_settings').select('equipped').maybeSingle()) as { equipped: Equipped | null } | null;
      return row?.equipped ?? null;
    },
    async saveEquipped(equipped) {
      const { data: u } = await sb.auth.getUser();
      check(await sb.from('family_settings').upsert({ user_id: u.user?.id, equipped, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
    },
    async listSpaces() {
      return check(await sb.from('user_spaces').select('space,layout')) as { space: SpaceId; layout: SpaceLayout }[];
    },
    async saveSpace(space, layout) {
      check(await sb.rpc('save_space', { p_space: space, p_layout: layout }));
    },
  };
}

// ---------- Demo (localStorage) ----------
interface DemoDb {
  courses: Course[];
  logs: StudyLog[];
  tasks: Task[];
  reflections: Reflection[];
  books?: Book[];
  readingLogs?: ReadingLog[];
  readingGoals?: ReadingGoals;
  reportSettings?: ReportSettings;
  reports?: Record<string, DailyReport>;
  plans?: PlanItem[];
  family?: FamilySettings;
  notes?: ParentNote[];
  rewards?: Reward[];
  abandoned?: Abandoned[];
  ledger?: LedgerEntry[];
  owned?: OwnedItem[];
  equipped?: Equipped;
  sessions?: StudySession[];
  spaces?: Partial<Record<SpaceId, SpaceLayout>>;
}

export const DEMO_KEY = 'ct-demo-db-v13';

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function localApi(seed: () => DemoDb): Api {
  let mem: DemoDb | null = null;
  const load = (): DemoDb => {
    if (mem) return mem;
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return (mem = JSON.parse(raw) as DemoDb);
    } catch {
      /* depolama yoksa bellekte devam */
    }
    mem = seed();
    save();
    return mem;
  };
  const save = () => {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(mem));
    } catch {
      /* yok say */
    }
  };
  const now = () => new Date().toISOString();
  const state = (s: StudySession): SessionState => ({ session: { ...s }, serverNow: now() });
  const openSession = (id: string) => {
    const s = load().sessions?.find((x) => x.id === id);
    if (!s) throw new Error('Seans bulunamadı');
    if (s.status !== 'running' && s.status !== 'paused') throw new Error('Bu seans kapanmış');
    return s;
  };
  const replace = (s: StudySession) => {
    const db = load();
    db.sessions = (db.sessions ?? []).map((x) => (x.id === s.id ? s : x));
    save();
  };
  const update = (id: string, f: (s: StudySession) => StudySession) => {
    const s = load().sessions?.find((x) => x.id === id);
    if (!s) throw new Error('Seans bulunamadı');
    const next = f(s);
    replace(next);
    return next;
  };

  const self: Api = {
    async listCourses() {
      return [...load().courses];
    },
    async addCourse(name, color) {
      const c: Course = { id: uid(), name, color, created_at: now() };
      load().courses.push(c);
      save();
      return c;
    },
    async updateCourse(id, patch) {
      const c = load().courses.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
      save();
    },
    async deleteCourse(id) {
      const db = load();
      db.courses = db.courses.filter((c) => c.id !== id);
      db.logs = db.logs.filter((l) => l.course_id !== id); // cascade
      db.tasks.forEach((t) => t.course_id === id && (t.course_id = null)); // set null
      db.plans = (db.plans ?? []).filter((p) => p.course_id !== id); // cascade
      save();
    },

    async listLogs(from, to) {
      return load().logs.filter((l) => l.date >= from && l.date <= to);
    },
    async addLog(log) {
      const l: StudyLog = { ...log, id: uid(), created_at: now(), source: 'manual', session_id: null };
      load().logs.push(l);
      save();
      return l;
    },
    async deleteLog(id) {
      const db = load();
      db.logs = db.logs.filter((l) => l.id !== id);
      save();
    },
    // Seanslar: sunucudaki session_* fonksiyonlarının aynısı (session.ts), saat Date.now()
    async getOpenSession() {
      const s = (load().sessions ?? []).find((x) => x.status === 'running' || x.status === 'paused');
      return s ? state(s) : null;
    },
    async startSession(courseId, date) {
      const db = load();
      db.sessions ??= [];
      if (!db.courses.some((c) => c.id === courseId)) throw new Error('Ders bulunamadı');
      if (db.sessions.some((x) => x.status === 'running' || x.status === 'paused')) throw new Error('Zaten açık bir seansın var');
      const s = newSession(uid(), courseId, date, Date.now());
      db.sessions.push(s);
      save();
      return state(s);
    },
    async beatSession(id) {
      return state(update(id, (s) => beat(s, Date.now())));
    },
    async pauseSession(id, backSec = 0) {
      return state(update(id, (s) => pause(s, Date.now(), backSec)));
    },
    async resumeSession(id) {
      return state(update(id, (s) => resume(s, Date.now())));
    },
    async finishSession(id, courseId, note) {
      const db = load();
      const s = openSession(id);
      const bad = noteProblem(note);
      if (bad) throw new Error(bad);
      if (!db.courses.some((c) => c.id === courseId)) throw new Error('Ders bulunamadı');
      const closed = pause(s, Date.now());
      const minutes = sessionMinutes(closed, Date.now());
      if (minutes < 1) throw new Error('En az 1 dakika çalışınca kaydedebilirsin');
      const log: StudyLog = {
        id: uid(), course_id: courseId, date: s.date, duration_minutes: minutes, note: note.trim(), created_at: now(), source: 'timer', session_id: s.id,
      };
      db.logs.push(log);
      const done: StudySession = { ...closed, course_id: courseId, status: 'finished', ended_at: now(), minutes, note: note.trim(), log_id: log.id };
      replace(done);
      await self.syncEconomy();
      return { session: { ...done }, log: { ...log } };
    },
    async abandonSession(id) {
      const db = load();
      const closed = pause(openSession(id), Date.now());
      const minutes = sessionMinutes(closed, Date.now());
      const done: StudySession = { ...closed, status: 'abandoned', ended_at: now(), minutes };
      replace(done);
      if (minutes >= CFG.session.wiltMinutes) {
        db.abandoned ??= [];
        db.abandoned.push({ id: uid(), date: done.date, minutes, created_at: now() });
      }
      save();
      return { ...done };
    },

    async listTasks(date) {
      return load().tasks.filter((t) => t.date === date);
    },
    async addTask(task) {
      const t: Task = { ...task, id: uid(), done: false, created_at: now() };
      load().tasks.push(t);
      save();
      return t;
    },
    async setTaskDone(id, done) {
      const t = load().tasks.find((x) => x.id === id);
      if (t) t.done = done;
      save();
    },
    async deleteTask(id) {
      const db = load();
      db.tasks = db.tasks.filter((t) => t.id !== id);
      save();
    },

    async getReflection(date) {
      return load().reflections.find((r) => r.date === date) ?? null;
    },
    async listReflections(from, to) {
      return load().reflections.filter((r) => r.date >= from && r.date <= to);
    },
    async upsertReflection(date, rating, note) {
      const db = load();
      const r = db.reflections.find((x) => x.date === date);
      if (r) Object.assign(r, { rating, note, updated_at: now() });
      else db.reflections.push({ date, rating, note, updated_at: now() });
      save();
    },

    async countDoneTasks() {
      return load().tasks.filter((t) => t.done).length;
    },
    async listBooks() {
      return [...(load().books ?? [])];
    },
    async addBook(b) {
      const db = load();
      db.books ??= [];
      const book: Book = {
        current_page: 0, started_on: null, finished_on: null, isbn: null, ol_key: null, cover_url: null, favorite_part: null,
        ...b,
        id: uid(), status: b.status ?? 'want', rating: null, fav_character: null, review: null, created_at: now(),
      };
      db.books.push(book);
      save();
      return book;
    },
    async updateBook(id, patch) {
      const b = load().books?.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
      save();
    },
    async deleteBook(id) {
      const db = load();
      db.books = (db.books ?? []).filter((b) => b.id !== id);
      db.readingLogs = (db.readingLogs ?? []).filter((l) => l.book_id !== id);
      save();
    },
    async listReadingLogs() {
      return [...(load().readingLogs ?? [])];
    },
    async addReadingLog(l) {
      const db = load();
      db.readingLogs ??= [];
      const log = { ...l, id: uid(), created_at: now() };
      db.readingLogs.push(log);
      save();
      return log;
    },
    async getReadingGoals() {
      return load().readingGoals ?? DEFAULT_READING_GOALS;
    },
    async setReadingGoals(g) {
      load().readingGoals = g;
      save();
    },
    async getReportSettings() {
      return load().reportSettings ?? null;
    },
    async setReportSettings(r) {
      load().reportSettings = r;
      save();
    },
    async getDailyReport(date) {
      return load().reports?.[date] ?? null;
    },
    async sendDailyReport(date) {
      const db = load();
      const settings = db.reportSettings;
      if (!settings?.enabled || !settings.parent_email) return { status: 'disabled' };
      // Demo: LLM ve e-posta yok; aynı şablonla, kurallarla yazılmış metinle önizleme üret.
      const input = await gatherReportInput(self, date, settings.child_name?.trim() || 'Çocuğunuz');
      const facts = buildFacts(input);
      const mail = renderEmail(facts, fallbackNarrative(facts), { generatedBy: 'fallback' });
      db.reports ??= {};
      db.reports[date] = { date, subject: mail.subject, html: mail.html, sent_at: new Date().toISOString(), generated_by: 'fallback' };
      save();
      return { status: 'demo', subject: mail.subject, html: mail.html, generatedBy: 'fallback' };
    },

    async listPlans(from, to) {
      return (load().plans ?? []).filter((p) => p.date >= from && p.date <= to);
    },
    async savePlans(from, to, items, approved) {
      const db = load();
      db.plans = (db.plans ?? []).filter((p) => p.date < from || p.date > to);
      db.plans.push(...items.map((i) => ({ ...i, id: uid(), approved })));
      save();
    },
    async approvePlans(from, to) {
      (load().plans ?? []).forEach((p) => p.date >= from && p.date <= to && (p.approved = true));
      save();
    },
    async getFamily() {
      return load().family ?? DEFAULT_FAMILY;
    },
    async setFamily(f) {
      load().family = f;
      save();
    },
    async listNotes(limit) {
      return [...(load().notes ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    },
    async addNote(text) {
      const db = load();
      db.notes ??= [];
      const n: ParentNote = { id: uid(), text, reaction: null, created_at: now() };
      db.notes.push(n);
      save();
      return n;
    },
    async reactNote(id, reaction) {
      const n = load().notes?.find((x) => x.id === id);
      if (n) n.reaction = reaction;
      save();
    },
    async deleteNote(id) {
      const db = load();
      db.notes = (db.notes ?? []).filter((n) => n.id !== id);
      save();
    },
    async listAbandoned() {
      return [...(load().abandoned ?? [])];
    },
    async addAbandoned(a) {
      const db = load();
      db.abandoned ??= [];
      const row: Abandoned = { ...a, id: uid(), created_at: now() };
      db.abandoned.push(row);
      save();
      return row;
    },
    async listRewards() {
      return [...(load().rewards ?? [])];
    },
    async addReward(r) {
      const db = load();
      db.rewards ??= [];
      const reward: Reward = { ...r, id: uid(), claimed_on: null, created_at: now() };
      db.rewards.push(reward);
      save();
      return reward;
    },
    async updateReward(id, patch) {
      const r = load().rewards?.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      save();
    },
    async deleteReward(id) {
      const db = load();
      db.rewards = (db.rewards ?? []).filter((r) => r.id !== id);
      save();
    },
    // Ekonomi: sunucudaki fonksiyonların (0010_economy_v2.sql) aynısı economy.ts kurallarıyla
    async listLedger() {
      return (load().ledger ?? []).map((e) => ({ ...e }));
    },
    async syncEconomy() {
      const db = load();
      db.ledger ??= [];
      const earned = earnedEntries({
        logs: db.logs, plans: db.plans ?? [], books: db.books ?? [], reflections: db.reflections, owned: db.owned ?? [], today: toLocalDate(),
      });
      for (const e of pendingEarnings(db.ledger, earned)) {
        const old = db.ledger.find((x) => x.currency === e.currency && x.kind === e.kind && x.ref === e.ref);
        if (old) old.amount = e.amount;
        else db.ledger.push({ id: uid(), currency: e.currency, kind: e.kind, ref: e.ref, amount: e.amount, note: null, created_at: now() });
      }
      save();
    },
    async collectStar(date, index) {
      const db = load();
      db.ledger ??= [];
      if (date !== toLocalDate() || !Number.isInteger(index) || index < 0 || index >= CFG.stars.perDay) throw new Error('Bu yıldız toplanamaz');
      const ref = `${date}:${index}`;
      if (!db.ledger.some((e) => e.kind === 'star' && e.ref === ref)) {
        db.ledger.push({ id: uid(), currency: 'star', kind: 'star', ref, amount: 1, note: null, created_at: now() });
      }
      save();
    },
    async giftCrystals(amount, note) {
      if (!(amount >= 1 && amount <= CFG.elmas.giftMax)) throw new Error(`Hediye 1–${CFG.elmas.giftMax} Elmas olabilir`);
      const db = load();
      db.ledger ??= [];
      db.ledger.push({ id: uid(), currency: 'crystal', kind: 'gift', ref: uid(), amount, note: note || null, created_at: now() });
      save();
    },
    async listOwned() {
      return (load().owned ?? []).map((o) => ({ ...o }));
    },
    async buyItem(itemId) {
      const db = load();
      db.owned ??= [];
      db.ledger ??= [];
      const item = itemById(itemId);
      if (!item || item.acquire.kind !== 'buy') throw new Error('Bu eşya satılmıyor');
      if (!item.repeat && db.owned.some((o) => o.item_id === itemId)) throw new Error('Bu eşya zaten sende');
      const { price } = item.acquire;
      const bal = balances(db.ledger).crystal;
      if (bal < price) throw new Error(`Bakiye yetmiyor: ${price} lazım, ${bal} var`);
      const row: OwnedItem = { id: uid(), item_id: itemId, via: 'buy', ref: null, created_at: now() };
      db.owned.push(row);
      db.ledger.push({ id: uid(), currency: 'crystal', kind: 'buy', ref: row.id, amount: -price, note: itemId, created_at: now() });
      save();
      return { ...row };
    },
    async openChest(week, itemId) {
      const db = load();
      db.owned ??= [];
      const item = itemById(itemId);
      if (!item || !inChestPool(item)) throw new Error('Bu eşya sandıktan çıkmaz');
      const c = chestOf(week, dayTotalsOf(db.logs), db.owned);
      if (c.opened) throw new Error('Bu haftanın sandığı zaten açıldı');
      if (!c.ready) throw new Error(`Bu haftanın sandığı henüz açılmadı (${c.days} gün, ${c.minutes} dk)`);
      const row: OwnedItem = { id: uid(), item_id: itemId, via: 'chest', ref: week, created_at: now() };
      db.owned.push(row);
      save();
      return { ...row };
    },
    async getEquipped() {
      const e = load().equipped;
      return e ? { ...e, pets: [...e.pets] } : null;
    },
    async saveEquipped(e) {
      load().equipped = { ...e, pets: [...e.pets] };
      save();
    },
    async listSpaces() {
      return Object.entries(load().spaces ?? {}).map(([space, layout]) => ({ space: space as SpaceId, layout: structuredClone(layout!) }));
    },
    async saveSpace(space, layout) {
      const db = load();
      db.spaces ??= {};
      // Sunucudaki save_space ile aynı kurallar (world.ts)
      const ok = trusted(db.logs);
      const minutes = ok.reduce((s, l) => s + l.duration_minutes, 0);
      const ctx = { totalMinutes: minutes, booksDone: (db.books ?? []).filter((b) => b.status === 'done').length };
      const progress = { bestStreak: 0, planDays: 0, gold: 0, level: levelOf(minutes).index, hours: minutes / 60, trees: ok.length };
      const elsewhere = (id: string) =>
        Object.entries(db.spaces!)
          .filter(([s]) => s !== space)
          .reduce((n, [, l]) => n + (l?.items.filter((p) => p.item === id).length ?? 0), 0);
      if (!['room', 'library', 'garden'].includes(space)) throw new Error('Alan geçersiz');
      const bad = layoutProblem(space, layout, ctx, (it) => ownedCount(it, db.owned ?? [], progress), elsewhere);
      if (bad) throw new Error(bad.message);
      db.spaces[space] = structuredClone(layout);
      save();
    },
  };
  return self;
}

export type { DemoDb };
