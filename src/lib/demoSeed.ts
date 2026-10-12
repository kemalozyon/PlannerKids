import type { DemoDb } from './api';
import { addDays, parseLocalDate, toLocalDate, weekStart } from './date';
import { monthOf, pickFreeCell, SPECIES, stageIndex } from './forest';

/**
 * Demo modu için ~5 haftalık örnek geçmiş.
 * - Bu ayın günlerine birer ağaç dikilmiş; bazıları büyütülmeyi bekliyor, dünün ağacı hiç dikilmemiş.
 * - Geçen ayın ağaçları dikilmemiş bırakılır → açılışta otomatik dikim çalışır.
 * - En uzun seri 9 gün: Kaktüs'e kadar türler açık; bugün kayıt girince Söğüt açılır.
 */
export function demoSeed(): DemoDb {
  const today = toLocalDate();
  const t = new Date().toISOString();
  const courses = [
    { id: 'c-mat', name: 'Matematik', color: '#4f7cff', created_at: t },
    { id: 'c-tr', name: 'Türkçe', color: '#d1477a', created_at: t },
    { id: 'c-fen', name: 'Fen Bilimleri', color: '#16a37f', created_at: t },
    { id: 'c-ing', name: 'İngilizce', color: '#8b5cf6', created_at: t },
  ];
  const notes = ['Kesirler', 'Okuma kitabı', 'Maddenin halleri', 'Çarpım tablosu', 'Kelime ezberi', 'Deneme sınavı', null, null];
  const reflNotes = ['Kesirleri anladım!', 'Biraz sıkıldım.', 'Kitabın sonu çok güzeldi.', 'Yorgundum.', 'Denemede netim arttı!', ''];

  // Deterministik sözde rastgele: demo her sıfırlamada aynı görünsün
  let seed = 11;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  // Seriyi kısa tutmak için: aynı hafta içinde art arda iki hafta içi günü boş (dinlenme hakkı tek günü affeder)
  const skip = (d: string) => {
    const off = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 864e5);
    return [-10, -11, -18, -19, -26, -27].includes(off);
  };

  const logs: DemoDb['logs'] = [];
  const reflections: DemoDb['reflections'] = [];
  for (let off = -34; off <= -1; off++) {
    const date = addDays(today, off);
    if (skip(date)) continue;
    const sessions = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < sessions; i++) {
      logs.push({
        id: `l-${off}-${i}`,
        course_id: courses[Math.floor(rnd() * courses.length)].id,
        date,
        duration_minutes: 20 + Math.round(rnd() * 8) * 5,
        note: notes[Math.floor(rnd() * notes.length)],
        created_at: t,
      });
    }
    if (rnd() < 0.75) {
      reflections.push({
        date,
        rating: 2 + Math.floor(rnd() * 4),
        note: reflNotes[Math.floor(rnd() * reflNotes.length)],
        updated_at: t,
      });
    }
  }

  // Bu ayın her gününe (dün hariç) bir ağaç: çoğu paranın yettiği en büyük evrede, her üç günden
  // birinde bir evre küçük → o gün "büyütülmeyi bekleyen" olarak görünür.
  const month = monthOf(today);
  const yesterday = addDays(today, -1);
  const totals = new Map<string, number>();
  logs.forEach((l) => totals.set(l.date, (totals.get(l.date) ?? 0) + l.duration_minutes));
  const taken = new Set<number>();
  const trees: NonNullable<DemoDb['trees']> = [];
  const open = SPECIES.filter((s) => s.unlock <= 7);
  for (const [date, min] of [...totals].sort()) {
    const best = stageIndex(min);
    if (monthOf(date) !== month || date === yesterday || best < 0) continue;
    const stage = best > 0 && Number(date.slice(-2)) % 3 === 0 ? best - 1 : best;
    const cell = pickFreeCell(taken, `${date}#demo`);
    if (cell == null) continue;
    taken.add(cell);
    trees.push({ id: `t-${date}`, date, stage, species: open[Math.floor(rnd() * open.length)].id, month, cell });
  }

  const tasks = [
    { id: 'tk-1', course_id: 'c-mat', title: 'Sayfa 42 alıştırmaları', date: today, done: false, created_at: t },
    { id: 'tk-2', course_id: 'c-tr', title: 'Kitaptan 10 sayfa oku', date: today, done: true, created_at: t },
    { id: 'tk-3', course_id: 'c-ing', title: 'Renkleri tekrar et', date: today, done: false, created_at: t },
  ];
  return {
    courses, logs, tasks, reflections, trees, ...demoReading(today, t), ...demoFamily(today, logs),
    reportSettings: { parent_email: 'ebeveyn@ornek.com', child_name: 'Ece', send_hour: 21, timezone: 'Europe/Istanbul', enabled: true },
  };
}

/** Örnek kitaplar: 4 bitmiş (biri parsele dikili, biri bekliyor, ikisi geçen ay), 2 okunan, 3 okunacak. */
function demoReading(today: string, t: string): Pick<DemoDb, 'books' | 'readingLogs' | 'bookTrees' | 'readingGoals'> {
  const base = {
    current_page: 0, started_on: null, finished_on: null, rating: null, fav_character: null, review: null, created_at: t,
  } as const;
  const d = (off: number) => addDays(today, off);
  const books: NonNullable<DemoDb['books']> = [
    { ...base, id: 'b-prens', title: 'Küçük Prens', author: 'Antoine de Saint-Exupéry', pages: 96, genre: 'Fantastik', recommended_by: 'Öğretmenim', color: '#e0803a', status: 'done', current_page: 96, started_on: d(-14), finished_on: d(-7), rating: 5, fav_character: 'Tilki', review: 'Gezegenler arasında dolaşan bir çocuğun dostluğu öğrenmesi.' },
    { ...base, id: 'b-charlie', title: "Charlie'nin Çikolata Fabrikası", author: 'Roald Dahl', pages: 176, genre: 'Fantastik', recommended_by: 'Annem', color: '#7a4a2a', status: 'done', current_page: 176, started_on: d(-12), finished_on: d(-2), rating: 4, fav_character: 'Charlie', review: 'Altın bileti bulan çocuk fabrikayı geziyor.' },
    { ...base, id: 'b-pal', title: 'Pal Sokağı Çocukları', author: 'Ferenc Molnár', pages: 208, genre: 'Macera', recommended_by: 'Öğretmenim', color: '#2f6fd6', status: 'done', current_page: 208, started_on: d(-34), finished_on: d(-22), rating: 5, fav_character: 'Nemeçek', review: 'Grund için savaşan çocukların hikâyesi.' },
    { ...base, id: 'b-heidi', title: 'Heidi', author: 'Johanna Spyri', pages: 140, genre: 'Macera', recommended_by: 'Kütüphane', color: '#16a37f', status: 'done', current_page: 140, started_on: d(-40), finished_on: d(-30), rating: 3, fav_character: 'Dede', review: null },
    { ...base, id: 'b-seker', title: 'Şeker Portakalı', author: 'José Mauro de Vasconcelos', pages: 184, genre: 'Macera', recommended_by: 'Annem', color: '#f2a03d', status: 'reading', current_page: 150, started_on: d(-6) },
    { ...base, id: 'b-matilda', title: 'Matilda', author: 'Roald Dahl', pages: 240, genre: 'Mizah', recommended_by: 'Arkadaşım', color: '#8b5cf6', status: 'reading', current_page: 40, started_on: d(-3) },
    { ...base, id: 'b-momo', title: 'Momo', author: 'Michael Ende', pages: 304, genre: 'Fantastik', recommended_by: 'Öğretmenim', color: '#3d4a5c', status: 'want' },
    { ...base, id: 'b-define', title: 'Define Adası', author: 'Robert Louis Stevenson', pages: 220, genre: 'Macera', recommended_by: 'Babam', color: '#c0392b', status: 'want' },
    { ...base, id: 'b-ucan', title: 'Uçan Sınıf', author: 'Erich Kästner', pages: 160, genre: 'Mizah', recommended_by: 'Kendim', color: '#0e8aa0', status: 'want' },
  ];

  // Her kitabın sayfalarını okunduğu günlere dağıt
  const readingLogs: NonNullable<DemoDb['readingLogs']> = [];
  for (const b of books) {
    if (!b.started_on || !b.current_page) continue;
    const end = b.finished_on ?? d(-1);
    const days: string[] = [];
    for (let x = b.started_on; x <= end; x = addDays(x, 1)) days.push(x);
    let page = 0;
    days.forEach((date, i) => {
      const to = Math.round((b.current_page * (i + 1)) / days.length);
      const pages = to - page;
      if (pages <= 0) return;
      readingLogs.push({ id: `rl-${b.id}-${i}`, book_id: b.id, date, minutes: Math.round(pages * 1.3), pages, to_page: to, created_at: t });
      page = to;
    });
  }

  return {
    books,
    readingLogs,
    bookTrees: [{ id: 'bt-prens', book_id: 'b-prens', month: monthOf(d(-7)), cell: 1 }],
    readingGoals: { monthly_books: 3, daily_pages: 15 },
  };
}

/**
 * Plan, aile notu ve ödül örnekleri.
 * - Geçen hafta ve bu haftanın geçen günleri: çalışılan derslerden plan (bazı günlerde
 *   fazladan bir ders eklenir → o gün plan yarım kalır).
 * - Bugün: Matematik 30, Türkçe 20, İngilizce 15. Haftanın kalanı "Okul haftası".
 */
function demoFamily(today: string, logs: DemoDb['logs']): Pick<DemoDb, 'plans' | 'notes' | 'rewards' | 'family'> {
  const plans: NonNullable<DemoDb['plans']> = [];
  const add = (date: string, course_id: string, minutes: number, note: string | null = null) =>
    plans.push({ id: `p-${date}-${course_id}`, date, course_id, minutes, note, approved: true });
  const monday = weekStart(today);
  for (let d = addDays(monday, -7); d < today; d = addDays(d, 1)) {
    const byCourse = new Map<string, number>();
    logs.filter((l) => l.date === d).forEach((l) => byCourse.set(l.course_id, (byCourse.get(l.course_id) ?? 0) + l.duration_minutes));
    if (!byCourse.size) continue;
    for (const [c, m] of byCourse) add(d, c, Math.max(5, Math.floor(m / 5) * 5));
    if (Number(d.slice(-2)) % 3 === 0 && !byCourse.has('c-fen')) add(d, 'c-fen', 20);
  }
  add(today, 'c-mat', 30, 'Kesirler');
  add(today, 'c-tr', 20, 'Okuma anlama');
  add(today, 'c-ing', 15, 'Renkleri tekrar et');
  for (let d = addDays(today, 1); d <= addDays(monday, 6); d = addDays(d, 1)) {
    const wd = (parseLocalDate(d).getDay() + 6) % 7;
    if (wd < 5) ['c-mat', 'c-tr', 'c-fen', 'c-ing'].forEach((c) => add(d, c, 20));
    else if (wd === 5) ['c-mat', 'c-tr'].forEach((c) => add(d, c, 15));
  }
  const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
  return {
    plans,
    notes: [
      { id: 'n-1', text: 'Dün kesirleri çok güzel çalışmışsın, seninle gurur duyuyorum! Bu akşam en sevdiğin yemek var.', reaction: null, created_at: ago(2) },
      { id: 'n-2', text: 'Kitabını bitirdiğin için tebrikler!', reaction: 'heart', created_at: ago(26) },
    ],
    rewards: [
      { id: 'r-sinema', title: 'Hafta sonu sinema', kind: 'minutes', target: 600, given_by: 'Babam', start_date: addDays(today, -3), claimed_on: null, created_at: ago(150) },
      { id: 'r-kitap', title: 'Yeni kitap seçme hakkı', kind: 'books', target: 5, given_by: 'Annem', start_date: addDays(today, -45), claimed_on: null, created_at: ago(1000) },
      { id: 'r-luna', title: 'Lunapark günü', kind: 'streak', target: 30, given_by: 'Babam', start_date: addDays(today, -20), claimed_on: null, created_at: ago(500) },
      { id: 'r-plan', title: 'Bahçeye gerçek fidan dik', kind: 'plans', target: 10, given_by: 'Dedem', start_date: addDays(today, -7), claimed_on: null, created_at: ago(170) },
      { id: 'r-pizza', title: 'Pizza akşamı', kind: 'minutes', target: 300, given_by: 'Annem', start_date: addDays(today, -20), claimed_on: addDays(today, -10), created_at: ago(500) },
    ],
    family: { pin_hash: null, require_plan_approval: false },
  };
}
