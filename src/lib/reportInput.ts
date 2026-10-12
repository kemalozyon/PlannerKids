// Demo modunda rapor girdisini uygulamanın kendi API'sinden toplar.
// (Gerçek modda aynı girdiyi Edge Function veritabanından toplar: supabase/functions/daily-report/index.ts)
import type { ReportInput } from '../../supabase/functions/_shared/report';
import { addDays } from './date';
import type { Api } from './types';

export async function gatherReportInput(api: Api, date: string, childName: string): Promise<ReportInput> {
  const from = addDays(date, -6);
  const [courses, logs, reflection, tasks, rlogs, books, trees] = await Promise.all([
    api.listCourses(),
    api.listLogs(from, date),
    api.getReflection(date),
    api.listTasks(date),
    api.listReadingLogs(),
    api.listBooks(),
    api.listTrees(),
  ]);
  const course = new Map(courses.map((c) => [c.id, c]));
  const book = new Map(books.map((b) => [b.id, b]));
  return {
    date,
    childName,
    studyLogs: logs
      .filter((l) => l.date === date)
      .map((l) => ({ course: course.get(l.course_id)?.name ?? 'Ders', color: course.get(l.course_id)?.color, minutes: l.duration_minutes, note: l.note })),
    week: Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => ({
      date: d,
      minutes: logs.filter((l) => l.date === d).reduce((s, l) => s + l.duration_minutes, 0),
    })),
    reflection: reflection ? { rating: reflection.rating, note: reflection.note } : null,
    tasks: tasks.map((t) => ({ title: t.title, done: t.done })),
    reading: rlogs.filter((r) => r.date === date).map((r) => ({ book: book.get(r.book_id)?.title ?? 'Kitap', pages: r.pages, minutes: r.minutes })),
    finishedBooks: books.filter((b) => b.finished_on === date).map((b) => ({ title: b.title, rating: b.rating, review: b.review })),
    trees: trees.filter((t) => t.date === date).map((t) => ({ stage: t.stage, species: t.species })),
  };
}
