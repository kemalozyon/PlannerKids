export interface Course {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface StudyLog {
  id: string;
  course_id: string;
  date: string; // YYYY-MM-DD (yerel)
  duration_minutes: number;
  note: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  course_id: string | null;
  title: string;
  date: string;
  done: boolean;
  created_at: string;
}

export interface Reflection {
  date: string;
  rating: number | null;
  note: string | null;
  updated_at: string;
}

export interface Api {
  listCourses(): Promise<Course[]>;
  addCourse(name: string, color: string): Promise<Course>;
  updateCourse(id: string, patch: Partial<Pick<Course, 'name' | 'color'>>): Promise<void>;
  deleteCourse(id: string): Promise<void>;

  listLogs(from: string, to: string): Promise<StudyLog[]>;
  addLog(log: Pick<StudyLog, 'course_id' | 'date' | 'duration_minutes' | 'note'>): Promise<StudyLog>;
  deleteLog(id: string): Promise<void>;

  listTasks(date: string): Promise<Task[]>;
  addTask(task: Pick<Task, 'title' | 'date' | 'course_id'>): Promise<Task>;
  setTaskDone(id: string, done: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;

  getReflection(date: string): Promise<Reflection | null>;
  listReflections(from: string, to: string): Promise<Reflection[]>;
  upsertReflection(date: string, rating: number | null, note: string): Promise<void>;

  countDoneTasks(): Promise<number>;

  listTrees(): Promise<ForestTree[]>;
  plantTree(t: Omit<ForestTree, 'id'>): Promise<ForestTree>;
  moveTree(id: string, cell: number): Promise<void>;
  upgradeTree(id: string, stage: number): Promise<void>;

  listBooks(): Promise<Book[]>;
  addBook(b: NewBook): Promise<Book>;
  updateBook(id: string, patch: Partial<Omit<Book, 'id' | 'created_at'>>): Promise<void>;
  deleteBook(id: string): Promise<void>;
  listReadingLogs(): Promise<ReadingLog[]>;
  addReadingLog(l: Omit<ReadingLog, 'id' | 'created_at'>): Promise<ReadingLog>;
  listBookTrees(): Promise<BookTree[]>;
  plantBookTree(t: Omit<BookTree, 'id'>): Promise<BookTree>;
  moveBookTree(id: string, cell: number): Promise<void>;
  getReadingGoals(): Promise<ReadingGoals>;
  setReadingGoals(g: ReadingGoals): Promise<void>;

  getReportSettings(): Promise<ReportSettings | null>;
  setReportSettings(s: ReportSettings): Promise<void>;
  getDailyReport(date: string): Promise<DailyReport | null>;
  /** Günün raporunu hazırlayıp ebeveyne gönderir (demo modunda yalnızca önizleme üretir). */
  sendDailyReport(date: string): Promise<SendReportResult>;

  /** [from, to] aralığındaki plan satırları */
  listPlans(from: string, to: string): Promise<PlanItem[]>;
  /** [from, to] aralığındaki planı verilen satırlarla tamamen değiştirir */
  savePlans(from: string, to: string, items: NewPlanItem[], approved: boolean): Promise<void>;
  /** [from, to] aralığındaki bekleyen plan satırlarını onaylar */
  approvePlans(from: string, to: string): Promise<void>;

  getFamily(): Promise<FamilySettings>;
  setFamily(s: FamilySettings): Promise<void>;

  /** En yeni önce */
  listNotes(limit: number): Promise<ParentNote[]>;
  addNote(text: string): Promise<ParentNote>;
  reactNote(id: string, reaction: NoteReaction): Promise<void>;
  deleteNote(id: string): Promise<void>;

  listRewards(): Promise<Reward[]>;
  addReward(r: NewReward): Promise<Reward>;
  updateReward(id: string, patch: Partial<Pick<Reward, 'claimed_on' | 'title' | 'target'>>): Promise<void>;
  deleteReward(id: string): Promise<void>;
}

/** Bir günün planında bir ders: kaç dakika ayrıldı. */
export interface PlanItem {
  id: string;
  date: string;
  course_id: string;
  minutes: number;
  note: string | null;
  /** Aile onayı açıksa çocuğun değişikliği onaylanana kadar false */
  approved: boolean;
}

export type NewPlanItem = Pick<PlanItem, 'date' | 'course_id' | 'minutes' | 'note'>;

export interface FamilySettings {
  /** Aile paneli PIN'inin SHA-256 özeti; null = PIN yok */
  pin_hash: string | null;
  require_plan_approval: boolean;
}

export const DEFAULT_FAMILY: FamilySettings = { pin_hash: null, require_plan_approval: false };

export type NoteReaction = 'thanks' | 'heart';

export interface ParentNote {
  id: string;
  text: string;
  reaction: NoteReaction | null;
  created_at: string;
}

/** minutes: toplam dakika · streak: seri (gün) · books: biten kitap · plans: tamamlanan planlı gün */
export type RewardKind = 'minutes' | 'streak' | 'books' | 'plans';

export interface Reward {
  id: string;
  title: string;
  kind: RewardKind;
  target: number;
  given_by: string | null;
  /** İlerleme bu günden itibaren sayılır */
  start_date: string;
  /** Ebeveyn ödülü verdiğinde dolar */
  claimed_on: string | null;
  created_at: string;
}

export type NewReward = Pick<Reward, 'title' | 'kind' | 'target' | 'given_by' | 'start_date'>;

export interface ReportSettings {
  parent_email: string | null;
  child_name: string | null;
  send_hour: number;
  timezone: string;
  enabled: boolean;
}

export interface DailyReport {
  date: string;
  subject: string | null;
  html: string | null;
  sent_at: string | null;
  generated_by: 'llm' | 'fallback' | null;
}

export type SendReportResult =
  | { status: 'sent' | 'demo'; subject: string; html: string; generatedBy: 'llm' | 'fallback' }
  | { status: 'already' | 'disabled' }
  | { status: 'error'; message: string };

export type BookStatus = 'want' | 'reading' | 'done';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  pages: number | null;
  genre: string | null;
  recommended_by: string | null;
  color: string;
  status: BookStatus;
  current_page: number;
  started_on: string | null;
  finished_on: string | null;
  rating: number | null;
  fav_character: string | null;
  review: string | null;
  created_at: string;
}

export type NewBook = Pick<Book, 'title' | 'author' | 'pages' | 'genre' | 'recommended_by' | 'color'> & {
  status?: BookStatus;
};

export interface ReadingLog {
  id: string;
  book_id: string;
  date: string;
  minutes: number;
  pages: number;
  to_page: number | null;
  created_at: string;
}

/** Kitap parselindeki ağaç. Ay = kitabın bittiği ay. */
export interface BookTree {
  id: string;
  book_id: string;
  month: string;
  cell: number;
}

export interface ReadingGoals {
  monthly_books: number;
  daily_pages: number;
}

export const DEFAULT_READING_GOALS: ReadingGoals = { monthly_books: 2, daily_pages: 15 };

/** Ormana dikilmiş bir bitki; `date` gününün parasıyla satın alındı. */
export interface ForestTree {
  id: string;
  date: string; // hangi günün parasıyla alındı
  stage: number; // 0 Tohum … 4 Dev ağaç (fiyatı STAGES'te)
  species: string;
  month: string; // YYYY-MM — hangi ayın ormanı
  cell: number; // 0..CELLS-1
}
