// Canlı Supabase'de şema / RLS / orman bütçe tetikleyicisi / kısıt testi.
// İki geçici kullanıcı (ct-test-…@example.com) açar, sonunda siler. E-posta göndermez.
// Çalıştırma: node --env-file=.env scripts/db-smoke.mjs   (Supabase CLI'ye giriş yapılmış ve proje bağlı olmalı)
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const keys = JSON.parse(execSync('supabase projects api-keys --project-ref nvchshjxvwgktsqhtuax -o json', { stdio: ['ignore', 'pipe', 'ignore'] }));
const service = keys.find((k) => k.name === 'service_role').api_key;
const admin = createClient(url, service, { auth: { persistSession: false } });

const res = [];
const ok = (name, cond, extra = '') => res.push([cond ? 'PASS' : 'FAIL', name, extra]);
const tag = Date.now();
const users = [];

async function mkUser(i) {
  const email = `ct-test-${tag}-${i}@example.com`;
  const password = `Test-${tag}-pw!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return c;
}

try {
  const a = await mkUser(1);
  const b = await mkUser(2);
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // Tüm tablolar
  for (const t of ['courses', 'study_logs', 'tasks', 'daily_reflections', 'forest_trees', 'books', 'reading_logs', 'book_trees', 'reading_goals', 'report_settings', 'daily_reports', 'study_plans', 'family_settings', 'parent_notes', 'rewards']) {
    const { error } = await a.from(t).select('*').limit(1);
    ok(`tablo ${t}`, !error, error?.message);
  }

  const { data: course, error: ce } = await a.from('courses').insert({ name: 'Matematik', color: '#4f7cff' }).select().single();
  ok('ders ekle', !ce, ce?.message);
  const log = await a.from('study_logs').insert({ course_id: course.id, date: today, duration_minutes: 40 }).select().single();
  ok('kayıt ekle (40 dk)', !log.error, log.error?.message);
  const bad = await a.from('study_logs').insert({ course_id: course.id, date: today, duration_minutes: 1500 });
  ok('1440 dk üstü reddedilir', !!bad.error);

  // Orman bütçesi
  const t1 = await a.from('forest_trees').insert({ date: today, stage: 0, species: 'elma', month, cell: 0 }).select().single();
  ok('tohum (30) dik — 40 dk ile', !t1.error, t1.error?.message);
  const t2 = await a.from('forest_trees').insert({ date: today, stage: 0, species: 'elma', month, cell: 1 });
  ok('ikinci tohum reddedilir (kalan 10)', !!t2.error, t2.error?.message);
  const up = await a.from('forest_trees').update({ stage: 1 }).eq('id', t1.data.id);
  ok('çiçeğe (60) büyütme reddedilir', !!up.error, up.error?.message);
  await a.from('study_logs').insert({ course_id: course.id, date: today, duration_minutes: 30 });
  const up2 = await a.from('forest_trees').update({ stage: 1 }).eq('id', t1.data.id);
  ok('70 dk ile çiçeğe büyütme olur', !up2.error, up2.error?.message);
  const dup = await a.from('forest_trees').insert({ date: today, stage: 0, species: 'elma', month, cell: 0 });
  ok('aynı hücreye ikinci bitki reddedilir', !!dup.error);

  // Upsert akışları (uygulamanın kullandığı onConflict)
  const ua = (await a.auth.getUser()).data.user.id;
  for (const [t, row, conflict] of [
    ['daily_reflections', { user_id: ua, date: today, rating: 4, note: 'iyi' }, 'user_id,date'],
    ['reading_goals', { user_id: ua, monthly_books: 3, daily_pages: 20 }, 'user_id'],
    ['report_settings', { user_id: ua, parent_email: null, child_name: 'Test', send_hour: 21, timezone: 'Europe/Istanbul', enabled: false }, 'user_id'],
    ['family_settings', { user_id: ua, pin_hash: 'x', require_plan_approval: true }, 'user_id'],
  ]) {
    const r1 = await a.from(t).upsert(row, { onConflict: conflict });
    const r2 = await a.from(t).upsert(row, { onConflict: conflict });
    ok(`upsert ${t} (iki kez)`, !r1.error && !r2.error, (r1.error || r2.error)?.message);
  }

  // Plan, not, ödül, kitap
  const pl = await a.from('study_plans').insert([{ date: today, course_id: course.id, minutes: 30, note: null, approved: false }]);
  ok('plan ekle', !pl.error, pl.error?.message);
  const ap = await a.from('study_plans').update({ approved: true }).gte('date', today).lte('date', today).eq('approved', false);
  ok('plan onayla', !ap.error, ap.error?.message);
  const pl5 = await a.from('study_plans').insert([{ date: today, course_id: course.id, minutes: 3 }]);
  ok('5 dk altı plan reddedilir', !!pl5.error);
  const n = await a.from('parent_notes').insert({ text: 'Aferin' }).select('id').single();
  ok('not ekle', !n.error, n.error?.message);
  const rw = await a.from('rewards').insert({ title: 'Sinema', kind: 'minutes', target: 600, given_by: null, start_date: today }).select().single();
  ok('ödül ekle', !rw.error, rw.error?.message);
  const bk = await a.from('books').insert({ title: 'Kitap', author: null, pages: 50, genre: null, recommended_by: null, color: '#c0392b', status: 'reading' }).select().single();
  ok('kitap ekle', !bk.error, bk.error?.message);
  const rl = await a.from('reading_logs').insert({ book_id: bk.data.id, date: today, minutes: 15, pages: 50, to_page: 50 });
  ok('okuma kaydı', !rl.error, rl.error?.message);
  const bt = await a.from('book_trees').insert({ book_id: bk.data.id, month, cell: 0 });
  ok('kitap ağacı dik', !bt.error, bt.error?.message);
  const bt2 = await a.from('book_trees').insert({ book_id: bk.data.id, month, cell: 1 });
  ok('aynı kitaba ikinci ağaç reddedilir', !!bt2.error);

  // RLS: B, A'nın hiçbir satırını göremez/değiştiremez
  for (const t of ['courses', 'study_logs', 'forest_trees', 'study_plans', 'parent_notes', 'rewards', 'books', 'family_settings', 'report_settings']) {
    const { data } = await b.from(t).select('*');
    ok(`RLS: B, A'nın ${t} satırını görmez`, (data ?? []).length === 0);
  }
  const hack = await b.from('courses').update({ name: 'hack' }).eq('id', course.id).select();
  ok('RLS: B, A’nın dersini değiştiremez', (hack.data ?? []).length === 0);
  const forge = await b.from('study_logs').insert({ course_id: course.id, date: today, duration_minutes: 10, user_id: ua });
  ok('RLS: B, A adına kayıt ekleyemez', !!forge.error);

  // Ders silme zinciri
  await a.from('courses').delete().eq('id', course.id);
  const left = await a.from('study_logs').select('id');
  const leftPlans = await a.from('study_plans').select('id');
  ok('ders silinince kayıtlar + planlar silinir', left.data.length === 0 && leftPlans.data.length === 0);

  // Sayfalama: 1000 satırdan fazla plan
  const { data: c2 } = await a.from('courses').insert({ name: 'Fen', color: '#16a37f' }).select().single();
  const { data: c3 } = await a.from('courses').insert({ name: 'Türkçe', color: '#d1477a' }).select().single();
  const rows = [];
  for (let i = 0; i < 520; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    rows.push({ date: d, course_id: c2.id, minutes: 20 }, { date: d, course_id: c3.id, minutes: 20 });
  }
  const ins = await a.from('study_plans').insert(rows);
  ok('1040 plan satırı ekle', !ins.error, ins.error?.message);
  const plain = await a.from('study_plans').select('id').gte('date', '2000-01-01');
  ok(`tek istek 1000'de kesiliyor (döndü: ${plain.data?.length})`, plain.data?.length === 1000);
} catch (e) {
  res.push(['FAIL', 'beklenmeyen hata', e.message]);
} finally {
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    res.push([error ? 'FAIL' : 'PASS', `geçici kullanıcı silindi`, error?.message ?? '']);
  }
}
for (const [s, n, x] of res) console.log(`${s}  ${n}${x && s === 'FAIL' ? ` → ${x}` : ''}`);
console.log(`\n${res.filter((r) => r[0] === 'PASS').length}/${res.length}`);
