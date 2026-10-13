import type { SessionState, StudySession } from './session';

export interface Course {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

/** timer: sunucuda ölçülen seans · manual: elle yazılan (Elmas ve ağaç vermez) · legacy: 0009'dan önceki kayıt */
export type LogSource = 'timer' | 'manual' | 'legacy';

export interface StudyLog {
  id: string;
  course_id: string;
  date: string; // YYYY-MM-DD (yerel)
  duration_minutes: number;
  note: string | null;
  created_at: string;
  /** Yoksa legacy (eski demo verisi) */
  source?: LogSource;
  session_id?: string | null;
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
  /** Elle yazılan süre: kayda geçer ama Elmas ve ağaç vermez (source = 'manual') */
  addLog(log: Pick<StudyLog, 'course_id' | 'date' | 'duration_minutes' | 'note'>): Promise<StudyLog>;
  deleteLog(id: string): Promise<void>;

  // Çalışma seansı: süre sunucunun saatiyle tutulur (0009_sessions.sql)
  /** Açık (çalışan ya da duraklatılmış) seans */
  getOpenSession(): Promise<SessionState | null>;
  startSession(courseId: string, date: string): Promise<SessionState>;
  /** "Buradayım"; tolerans aşıldıysa seans duraklatılmış döner */
  beatSession(id: string): Promise<SessionState>;
  /** backSec: hareketsizlikte sondan bu kadar saniye sayılmaz */
  pauseSession(id: string, backSec?: number): Promise<SessionState>;
  resumeSession(id: string): Promise<SessionState>;
  /** Not zorunlu; dakikayı sunucu hesaplar, kaydı yazar ve Elmas'ı günceller */
  finishSession(id: string, courseId: string, note: string): Promise<{ session: StudySession; log: StudyLog }>;
  /** Yarıda bırakılır (uzun sürdüyse kuru ağaç) */
  abandonSession(id: string): Promise<StudySession>;

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

  /** Yarıda bırakılan sayaç oturumları (adada solgun fidan) */
  listAbandoned(): Promise<Abandoned[]>;
  addAbandoned(a: Pick<Abandoned, 'date' | 'minutes'>): Promise<Abandoned>;

  listRewards(): Promise<Reward[]>;
  addReward(r: NewReward): Promise<Reward>;
  updateReward(id: string, patch: Partial<Pick<Reward, 'claimed_on' | 'title' | 'target'>>): Promise<void>;
  deleteReward(id: string): Promise<void>;

  /** Elmas ve yıldız defteri (eskiden yeniye) */
  listLedger(): Promise<LedgerEntry[]>;
  /** Kazançları sunucu kayıtlardan hesaplayıp deftere yazar (istemci deftere yazamaz) */
  syncEconomy(): Promise<void>;
  /** Gezintide günün i. yıldızı toplandı (yıldız para değildir, koleksiyon sayacıdır) */
  collectStar(date: string, index: number): Promise<void>;
  /** Ebeveyn hediyesi (1–giftMax 💎) */
  giftCrystals(amount: number, note: string): Promise<void>;
  listOwned(): Promise<OwnedItem[]>;
  /** Eşyayı fiyatıyla satın alır; bakiye yetmezse hata */
  buyItem(itemId: string): Promise<OwnedItem>;
  /** Haftalık sandık: hafta hedefi tuttuysa eşya bir kez verilir */
  openChest(week: string, itemId: string): Promise<OwnedItem>;
  listPlacements(): Promise<Placement[]>;
  placeItem(p: Omit<Placement, 'id'>): Promise<Placement>;
  movePlacement(id: string, x: number, z: number, rot: number): Promise<void>;
  removePlacement(id: string): Promise<void>;
  getEquipped(): Promise<Equipped | null>;
  saveEquipped(e: Equipped): Promise<void>;
}

/** Yarıda bırakılan sayaç oturumu: adada solgun bir fidan bırakır, aynı gün çalışılırsa canlanır. */
export interface Abandoned {
  id: string;
  /** Sayacın başladığı gün */
  date: string;
  /** İptal edilene kadar geçen dakika */
  minutes: number;
  created_at: string;
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

// ---------- Oyun ekonomisi (0008_economy.sql, 0010_economy_v2.sql) ----------
/** 'crystal' = 💎 Elmas (yalnızca çalışarak kazanılır, tek para) · 'star' = gezintide toplanan ⭐ (sayaç, harcanmaz) */
export type Currency = 'crystal' | 'star';
/** study: günün dakikaları · streak: seri kademesi · plan: tamamlanan planlı gün · reflection: öz değerlendirme ·
 *  book: biten kitap · quest: görev · star: toplanan yıldız · gift: ebeveyn hediyesi · buy: harcama */
export type LedgerKind = 'study' | 'streak' | 'plan' | 'reflection' | 'book' | 'quest' | 'star' | 'gift' | 'buy';

/** Elmas/yıldız defterinin bir satırı. Kazanç artı, harcama eksi. (currency, kind, ref) tektir. */
export interface LedgerEntry {
  id: string;
  currency: Currency;
  kind: LedgerKind;
  ref: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export type NewLedgerEntry = Pick<LedgerEntry, 'currency' | 'kind' | 'ref' | 'amount'> & { note?: string | null };

/** Satın alınan ya da sandıktan çıkan eşya. Yapı ve süslerden birden fazla olabilir. */
export interface OwnedItem {
  id: string;
  item_id: string;
  via: 'buy' | 'chest';
  /** Sandıkta haftanın pazartesisi */
  ref: string | null;
  created_at: string;
}

/** Bir eşyanın bir ayın adasındaki yeri */
export interface Placement {
  id: string;
  month: string;
  owned_id: string;
  x: number;
  z: number;
  rot: number;
}

/** Görünüş: gezinti karakteri, aksesuar ve yanındaki hayvanlar */
export interface Equipped {
  character: string;
  accessory: string | null;
  pets: string[];
}

export const DEFAULT_EQUIPPED: Equipped = { character: 'char:female-b', accessory: null, pets: [] };
