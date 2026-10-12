import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFacts, fallbackNarrative, renderEmail } from '../../supabase/functions/_shared/report';
import { gatherReportInput } from './reportInput';
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
  type BookTree,
  type Course,
  type ForestTree,
  type DailyReport,
  type ReadingGoals,
  type ReportSettings,
  type SendReportResult,
  type ReadingLog,
  type Reflection,
  type StudyLog,
  type Task,
} from './types';

const ONE_PER_DAY = 'Bu güne zaten bir ağaç dikildi. Onu büyütebilirsin.';

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
    async listTrees() {
      return all<ForestTree>((a, b) => sb.from('forest_trees').select('id,date,stage,species,month,cell').order('id').range(a, b));
    },
    async plantTree(t) {
      const res = await sb.from('forest_trees').insert(t).select('id,date,stage,species,month,cell').single();
      // 0006: günde tek ağaç (forest_trees_user_date_key)
      if (res.error?.message.includes('forest_trees_user_date_key')) throw new Error(ONE_PER_DAY);
      return check(res) as ForestTree;
    },
    async moveTree(id, cell) {
      check(await sb.from('forest_trees').update({ cell }).eq('id', id));
    },
    async upgradeTree(id, stage) {
      check(await sb.from('forest_trees').update({ stage }).eq('id', id));
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
    async listBookTrees() {
      return all<BookTree>((a, b) => sb.from('book_trees').select('id,book_id,month,cell').order('id').range(a, b));
    },
    async plantBookTree(t) {
      return check(await sb.from('book_trees').insert(t).select('id,book_id,month,cell').single()) as BookTree;
    },
    async moveBookTree(id, cell) {
      check(await sb.from('book_trees').update({ cell }).eq('id', id));
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
  };
}

// ---------- Demo (localStorage) ----------
interface DemoDb {
  courses: Course[];
  logs: StudyLog[];
  tasks: Task[];
  reflections: Reflection[];
  trees?: ForestTree[];
  books?: Book[];
  readingLogs?: ReadingLog[];
  bookTrees?: BookTree[];
  readingGoals?: ReadingGoals;
  reportSettings?: ReportSettings;
  reports?: Record<string, DailyReport>;
  plans?: PlanItem[];
  family?: FamilySettings;
  notes?: ParentNote[];
  rewards?: Reward[];
  abandoned?: Abandoned[];
}

export const DEMO_KEY = 'ct-demo-db-v10';

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
      const l: StudyLog = { ...log, id: uid(), created_at: now() };
      load().logs.push(l);
      save();
      return l;
    },
    async deleteLog(id) {
      const db = load();
      db.logs = db.logs.filter((l) => l.id !== id);
      save();
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
    async listTrees() {
      // Kopya: upgradeTree/moveTree yerinde değiştirdiğinde ekrandaki eski durum bozulmasın
      return (load().trees ?? []).map((t) => ({ ...t }));
    },
    async plantTree(t) {
      const db = load();
      db.trees ??= [];
      if (db.trees.some((x) => x.month === t.month && x.cell === t.cell)) throw new Error('Bu yer dolu');
      if (db.trees.some((x) => x.date === t.date)) throw new Error(ONE_PER_DAY);
      const tree = { ...t, id: uid() };
      db.trees.push(tree);
      save();
      return tree;
    },
    async moveTree(id, cell) {
      const db = load();
      const tree = db.trees?.find((x) => x.id === id);
      if (!tree) return;
      if (db.trees!.some((x) => x.month === tree.month && x.cell === cell)) throw new Error('Bu yer dolu');
      tree.cell = cell;
      save();
    },
    async upgradeTree(id, stage) {
      const tree = load().trees?.find((x) => x.id === id);
      if (tree) tree.stage = stage;
      save();
    },
    async listBooks() {
      return [...(load().books ?? [])];
    },
    async addBook(b) {
      const db = load();
      db.books ??= [];
      const book: Book = {
        ...b,
        id: uid(), status: b.status ?? 'want', current_page: 0, started_on: null, finished_on: null,
        rating: null, fav_character: null, review: null, created_at: now(),
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
      db.bookTrees = (db.bookTrees ?? []).filter((t) => t.book_id !== id);
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
    async listBookTrees() {
      return (load().bookTrees ?? []).map((t) => ({ ...t }));
    },
    async plantBookTree(t) {
      const db = load();
      db.bookTrees ??= [];
      if (db.bookTrees.some((x) => x.month === t.month && x.cell === t.cell)) throw new Error('Bu yer dolu');
      if (db.bookTrees.some((x) => x.book_id === t.book_id)) throw new Error('Bu kitabın ağacı zaten dikili');
      const tree = { ...t, id: uid() };
      db.bookTrees.push(tree);
      save();
      return tree;
    },
    async moveBookTree(id, cell) {
      const db = load();
      const tree = db.bookTrees?.find((x) => x.id === id);
      if (!tree) return;
      if (db.bookTrees!.some((x) => x.month === tree.month && x.cell === cell)) throw new Error('Bu yer dolu');
      tree.cell = cell;
      save();
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
  };
  return self;
}

export type { DemoDb };
