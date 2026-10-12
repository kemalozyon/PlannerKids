// Supabase Edge Function: daily-report
//
// İki şekilde çağrılır:
//  1) Uygulamadaki "Bugünü bitirdim" → kullanıcının JWT'siyle, gövde { date }.
//     Yalnızca o kullanıcının verisi okunur (RLS), rapor kayıtlı ebeveyn e-postasına gider.
//  2) pg_cron (saatte bir) → x-cron-secret başlığıyla. Yedek saati gelmiş herkese gönderir.
// Günde kullanıcı başına en fazla bir rapor (daily_reports tablosundaki unique kısıt).
//
// Gerekli secret'lar: ANTHROPIC_API_KEY, RESEND_API_KEY, REPORT_FROM, CRON_SECRET
// İsteğe bağlı: REPORT_MODEL (varsayılan claude-sonnet-5-5)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { addDaysISO, type ReportInput } from '../_shared/report.ts';
import { runSchedule, sendReport, validButtonDate, type DataSource, type ReportSettings, type Trigger } from './core.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

/** Supabase üzerinden veri kaynağı. Servis anahtarıyla kullanıldığında RLS yok → her sorgu user_id ile süzülür. */
function supabaseSource(db: SupabaseClient): DataSource {
  const must = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    async settings(userId) {
      return must(await db.from('report_settings').select('*').eq('user_id', userId).maybeSingle()) as ReportSettings | null;
    },
    async claim(userId, date, trigger: Trigger) {
      const { error } = await db.from('daily_reports').insert({ user_id: userId, date, trigger, status: 'sending' });
      if (!error) return true;
      if (error.code === '23505') return false; // unique ihlali: bugün zaten gönderildi/gönderiliyor
      throw new Error(error.message);
    },
    async finish(userId, date, r) {
      must(
        await db
          .from('daily_reports')
          .update({ status: 'sent', subject: r.subject, html: r.html, generated_by: r.generated_by, sent_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('date', date),
      );
    },
    async release(userId, date) {
      await db.from('daily_reports').delete().eq('user_id', userId).eq('date', date).eq('status', 'sending');
    },
    async enabledSettings() {
      return must(await db.from('report_settings').select('*').eq('enabled', true)) as ReportSettings[];
    },
    async gather(userId, date, childName): Promise<ReportInput> {
      const weekStart = addDaysISO(date, -6);
      const [logs, refl, tasks, rlogs, finished, trees] = await Promise.all([
        db.from('study_logs').select('date,duration_minutes,note,courses(name,color)').eq('user_id', userId).gte('date', weekStart).lte('date', date),
        db.from('daily_reflections').select('rating,note').eq('user_id', userId).eq('date', date).maybeSingle(),
        db.from('tasks').select('title,done').eq('user_id', userId).eq('date', date),
        db.from('reading_logs').select('pages,minutes,books(title)').eq('user_id', userId).eq('date', date),
        db.from('books').select('title,rating,review').eq('user_id', userId).eq('finished_on', date),
        db.from('forest_trees').select('stage,species').eq('user_id', userId).eq('date', date),
      ]);
      type LogRow = { date: string; duration_minutes: number; note: string | null; courses: { name: string; color: string } | null };
      const logRows = must(logs) as unknown as LogRow[];
      const week = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)).map((d) => ({
        date: d,
        minutes: logRows.filter((l) => l.date === d).reduce((s, l) => s + l.duration_minutes, 0),
      }));
      type RLog = { pages: number; minutes: number; books: { title: string } | null };
      return {
        date,
        childName,
        studyLogs: logRows
          .filter((l) => l.date === date)
          .map((l) => ({ course: l.courses?.name ?? 'Ders', color: l.courses?.color, minutes: l.duration_minutes, note: l.note })),
        week,
        reflection: must(refl) as ReportInput['reflection'],
        tasks: must(tasks) as ReportInput['tasks'],
        reading: (must(rlogs) as unknown as RLog[]).map((r) => ({ book: r.books?.title ?? 'Kitap', pages: r.pages, minutes: r.minutes })),
        finishedBooks: must(finished) as ReportInput['finishedBooks'],
        trees: must(trees) as ReportInput['trees'],
      };
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST bekleniyor' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const env = {
    ANTHROPIC_API_KEY: Deno.env.get('ANTHROPIC_API_KEY'),
    REPORT_MODEL: Deno.env.get('REPORT_MODEL'),
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
    REPORT_FROM: Deno.env.get('REPORT_FROM'),
  };

  // 2) Zamanlanmış mod
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const results = await runSchedule(supabaseSource(admin), env, fetch, new Date());
    return json({ results });
  }

  // 1) Buton modu: kullanıcının kendi JWT'si
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Giriş gerekli' }, 401);
  const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: u, error } = await userDb.auth.getUser();
  if (error || !u.user) return json({ error: 'Giriş gerekli' }, 401);

  const { date } = (await req.json().catch(() => ({}))) as { date?: string };
  const ds = supabaseSource(userDb);
  const settings = await ds.settings(u.user.id);
  if (!date || !validButtonDate(date, new Date(), settings?.timezone || 'Europe/Istanbul')) {
    return json({ error: 'Geçersiz tarih' }, 400);
  }
  const result = await sendReport(ds, env, fetch, u.user.id, date, 'button');
  return json(result, result.status === 'error' ? 502 : 200);
});
