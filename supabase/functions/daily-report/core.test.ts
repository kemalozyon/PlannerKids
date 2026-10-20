// node --test ile çalışır (npm test). Supabase, Gemini (LLM) ve Resend sahte; ağa çıkılmaz.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleInput } from '../_shared/report.fixtures.ts';
import { hourAt } from '../_shared/report.ts';
import { dueReportDate, localNow, runSchedule, sendReport, validButtonDate, writeNarrative, type DataSource, type Env, type FetchFn, type ReportSettings } from './core.ts';

const ENV: Env = { GEMINI_API_KEY: 'test-gemini', RESEND_API_KEY: 'test-resend', REPORT_FROM: 'Rapor <r@ornek.com>' };

const settingsFor = (over: Partial<ReportSettings> = {}): ReportSettings => ({
  user_id: 'u1',
  parent_email: 'veli@ornek.com',
  child_name: 'Ece',
  send_hour: 21,
  timezone: 'Europe/Istanbul',
  enabled: true,
  ...over,
});

/** Bellekte DataSource: daily_reports unique kısıtını taklit eder. */
function fakeDs(settings: ReportSettings[]) {
  const reports = new Map<string, { status: 'sending' | 'sent'; subject?: string; generated_by?: string }>();
  const ds: DataSource = {
    async settings(userId) {
      return settings.find((s) => s.user_id === userId) ?? null;
    },
    async claim(userId, date) {
      const k = `${userId}|${date}`;
      if (reports.has(k)) return false;
      reports.set(k, { status: 'sending' });
      return true;
    },
    async finish(userId, date, r) {
      reports.set(`${userId}|${date}`, { status: 'sent', subject: r.subject, generated_by: r.generated_by });
    },
    async release(userId, date) {
      const k = `${userId}|${date}`;
      if (reports.get(k)?.status === 'sending') reports.delete(k);
    },
    async gather(_userId, date, childName) {
      return sampleInput({ date, childName });
    },
    async enabledSettings() {
      return settings.filter((s) => s.enabled);
    },
  };
  return { ds, reports };
}

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

/** Gemini ve Resend uç noktalarını taklit eden fetch. */
function fakeFetch(opts: { llm?: () => Response; resend?: () => Response } = {}) {
  const calls: Call[] = [];
  const llmOk = () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Önce verilere bakayım…', thought: true },
              { text: JSON.stringify({ subject: 'Ece bugün kesirleri çözdü', summary: 'Ece bugün 85 dakika çalıştı.', highlights: ['Matematik'], parent_tip: 'Kesirleri sorun.' }) },
            ],
          },
        },
      ],
    });
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    if (url.includes('generativelanguage.googleapis.com')) return (opts.llm ?? llmOk)();
    if (url.includes('resend.com')) return (opts.resend ?? (() => Response.json({ id: 'mail-1' })))();
    throw new Error(`beklenmeyen istek: ${url}`);
  };
  return { fetchFn, calls };
}

test('sendReport: LLM metniyle rapor üretir ve ebeveyne e-posta atar', async () => {
  const { ds, reports } = fakeDs([settingsFor()]);
  const { fetchFn, calls } = fakeFetch();
  const r = await sendReport(ds, ENV, fetchFn, 'u1', '2026-10-12', 'button');

  assert.equal(r.status, 'sent');
  assert.ok(r.status === 'sent' && r.generatedBy === 'llm');
  assert.ok(r.status === 'sent' && r.subject === 'Ece bugün kesirleri çözdü');

  const [llm, resend] = calls;
  assert.equal(llm.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(llm.headers['x-goog-api-key'], 'test-gemini');
  const config = llm.body.generationConfig as { maxOutputTokens: number; responseMimeType: string };
  assert.ok(config.maxOutputTokens >= 4000, 'düşünen modeller için yeterli token bütçesi');
  assert.equal(config.responseMimeType, 'application/json');
  assert.equal(resend.url, 'https://api.resend.com/emails');
  assert.deepEqual(resend.body.to, ['veli@ornek.com']);
  assert.equal(resend.body.from, 'Rapor <r@ornek.com>');
  assert.match(String(resend.body.html), /Kesirleri sorun\./);
  assert.match(String(resend.body.text), /Ece bugün 85 dakika çalıştı\./);

  assert.deepEqual(reports.get('u1|2026-10-12'), { status: 'sent', subject: 'Ece bugün kesirleri çözdü', generated_by: 'llm' });
});

test('sendReport: REPORT_MODEL varsayılan modeli değiştirir', async () => {
  const { ds } = fakeDs([settingsFor()]);
  const { fetchFn, calls } = fakeFetch();
  await sendReport(ds, { ...ENV, REPORT_MODEL: 'gemini-3.8-flash-lite' }, fetchFn, 'u1', '2026-10-12', 'button');
  assert.match(calls[0].url, /\/models\/gemini-3\.8-flash-lite:generateContent$/);
});

test('sendReport: günde en fazla bir rapor', async () => {
  const { ds } = fakeDs([settingsFor()]);
  const { fetchFn, calls } = fakeFetch();
  assert.equal((await sendReport(ds, ENV, fetchFn, 'u1', '2026-10-12', 'button')).status, 'sent');
  assert.equal((await sendReport(ds, ENV, fetchFn, 'u1', '2026-10-12', 'schedule')).status, 'already');
  assert.equal(calls.filter((c) => c.url.includes('resend')).length, 1);
});

test('sendReport: ayar yoksa, kapalıysa ya da e-posta yoksa gönderilmez', async () => {
  const { fetchFn, calls } = fakeFetch();
  for (const s of [[], [settingsFor({ enabled: false })], [settingsFor({ parent_email: null })]]) {
    const { ds, reports } = fakeDs(s);
    assert.equal((await sendReport(ds, ENV, fetchFn, 'u1', '2026-10-12', 'button')).status, 'disabled');
    assert.equal(reports.size, 0);
  }
  assert.equal(calls.length, 0);
});

test('LLM hata verirse yedek metinle yine gönderilir', async () => {
  for (const llm of [() => new Response('overloaded', { status: 529 }), () => Response.json({ candidates: [{ content: { parts: [{ text: 'JSON değil' }] } }] })]) {
    const { ds, reports } = fakeDs([settingsFor()]);
    const { fetchFn } = fakeFetch({ llm });
    const r = await sendReport(ds, ENV, fetchFn, 'u1', '2026-10-12', 'button');
    assert.ok(r.status === 'sent' && r.generatedBy === 'fallback');
    assert.equal(reports.get('u1|2026-10-12')?.generated_by, 'fallback');
  }
});

test('GEMINI_API_KEY yoksa LLM çağrılmaz, yedek metin kullanılır', async () => {
  const { fetchFn, calls } = fakeFetch();
  const { by } = await writeNarrative(sampleInput(), {}, fetchFn);
  assert.equal(by, 'fallback');
  assert.equal(calls.length, 0);
});

test('e-posta gönderilemezse kayıt silinir, sonra tekrar denenebilir', async () => {
  const { ds, reports } = fakeDs([settingsFor()]);
  const failing = fakeFetch({ resend: () => new Response('domain not verified', { status: 403 }) });
  const r = await sendReport(ds, ENV, failing.fetchFn, 'u1', '2026-10-12', 'button');
  assert.equal(r.status, 'error');
  assert.match(r.status === 'error' ? r.message : '', /Resend 403: domain not verified/);
  assert.equal(reports.size, 0);

  const retry = await sendReport(ds, ENV, fakeFetch().fetchFn, 'u1', '2026-10-12', 'button');
  assert.equal(retry.status, 'sent');
});

test('Resend ayarı eksikse hata döner ve kayıt silinir', async () => {
  const { ds, reports } = fakeDs([settingsFor()]);
  const r = await sendReport(ds, { GEMINI_API_KEY: 'k' }, fakeFetch().fetchFn, 'u1', '2026-10-12', 'button');
  assert.equal(r.status, 'error');
  assert.equal(reports.size, 0);
});

test('localNow ve validButtonDate saat dilimine göre çalışır', () => {
  // 2026-10-12 21:30 UTC = İstanbul'da 13 Ekim 00:30
  const now = new Date('2026-10-12T21:30:00Z');
  assert.deepEqual(localNow(now, 'Europe/Istanbul'), { date: '2026-10-13', hour: 0 });
  assert.deepEqual(localNow(now, 'UTC'), { date: '2026-10-12', hour: 21 });
  assert.equal(validButtonDate('2026-10-13', now, 'Europe/Istanbul'), true);
  assert.equal(validButtonDate('2026-10-12', now, 'Europe/Istanbul'), true); // dün
  assert.equal(validButtonDate('2026-10-11', now, 'Europe/Istanbul'), false);
  assert.equal(validButtonDate('2026-10-14', now, 'Europe/Istanbul'), false);
  assert.equal(validButtonDate('13.10.2026', now, 'Europe/Istanbul'), false);
});

test('runSchedule: yalnızca yerel saati gelmiş kullanıcılara gönderir', async () => {
  const { ds } = fakeDs([
    settingsFor({ user_id: 'ist', send_hour: 21 }),
    settingsFor({ user_id: 'erken', send_hour: 22 }),
    settingsFor({ user_id: 'ny', timezone: 'America/New_York', send_hour: 21 }),
    settingsFor({ user_id: 'kapali', enabled: false }),
    settingsFor({ user_id: 'epostasiz', parent_email: null }),
  ]);
  const { fetchFn } = fakeFetch();
  const now = new Date('2026-10-12T18:05:00Z'); // İstanbul 21:05, New York 14:05
  const results = await runSchedule(ds, ENV, fetchFn, now);
  assert.deepEqual(results, [{ userId: 'ist', date: '2026-10-12', status: 'sent' }]);

  // Bir saat sonra: İstanbul zaten gönderildi, 22:00'yi seçen kullanıcıya gider
  const later = await runSchedule(ds, ENV, fetchFn, new Date('2026-10-12T19:05:00Z'));
  assert.deepEqual(later, [
    { userId: 'ist', date: '2026-10-12', status: 'already' },
    { userId: 'erken', date: '2026-10-12', status: 'sent' },
  ]);
});

test('dueReportDate: akşam saatleri o günü, gece/sabah saatleri önceki günü gönderir', () => {
  const ist = (iso: string, h: number) => dueReportDate(new Date(iso), 'Europe/Istanbul', h); // İstanbul = UTC+3
  assert.equal(ist('2026-10-12T19:05:00Z', 22), '2026-10-12'); // 22:05
  assert.equal(ist('2026-10-12T18:05:00Z', 22), null); // 21:05, saati gelmedi
  assert.equal(ist('2026-10-12T22:05:00Z', 22), '2026-10-12'); // ertesi 01:05: hâlâ dünün raporu denenir
  assert.equal(ist('2026-10-13T01:05:00Z', 22), null); // 04:05: 6 saat geçti, artık denenmez
  assert.equal(ist('2026-10-12T21:05:00Z', 0), '2026-10-12'); // 13 Ekim 00:05 → 12 Ekim'in raporu
  assert.equal(ist('2026-10-13T04:05:00Z', 7), '2026-10-12'); // 07:05 → dünün raporu
  assert.equal(ist('2026-10-13T03:05:00Z', 7), null); // 06:05, saati gelmedi
});

test('dueReportDate: saat dilimine göre ve 12:00 sınırı', () => {
  assert.equal(dueReportDate(new Date('2026-10-13T09:05:00Z'), 'Europe/Istanbul', 12), '2026-10-13'); // 12:05
  assert.equal(dueReportDate(new Date('2026-10-13T08:05:00Z'), 'Europe/Istanbul', 11), '2026-10-12'); // 11:05
  assert.equal(dueReportDate(new Date('2026-10-13T02:05:00Z'), 'America/New_York', 22), '2026-10-12'); // NY 22:05
  assert.equal(dueReportDate(new Date('2026-10-13T02:05:00Z'), 'Europe/Istanbul', 22), null); // İstanbul 05:05
});

test('runSchedule: sabah saati seçen kullanıcıya dünün raporu gider', async () => {
  const { ds, reports } = fakeDs([settingsFor({ user_id: 'sabah', send_hour: 7 })]);
  const { fetchFn } = fakeFetch();
  const r = await runSchedule(ds, ENV, fetchFn, new Date('2026-10-13T04:05:00Z')); // İstanbul 07:05
  assert.deepEqual(r, [{ userId: 'sabah', date: '2026-10-12', status: 'sent' }]);
  assert.equal(reports.get('sabah|2026-10-12')?.status, 'sent');
  // Akşam "Bugünü bitirdim"e basıldıysa ertesi sabah tekrar gitmez
  const again = await runSchedule(ds, ENV, fetchFn, new Date('2026-10-13T05:05:00Z'));
  assert.deepEqual(again, [{ userId: 'sabah', date: '2026-10-12', status: 'already' }]);
});

test('hourAt: saat bulunma ekiyle yazılır', () => {
  assert.deepEqual([0, 1, 3, 6, 7, 9, 10, 12, 13, 20, 21, 22, 23].map(hourAt), [
    "00:00'da", "01:00'de", "03:00'te", "06:00'da", "07:00'de", "09:00'da", "10:00'da",
    "12:00'de", "13:00'te", "20:00'de", "21:00'de", "22:00'de", "23:00'te",
  ]);
});
