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
}

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
