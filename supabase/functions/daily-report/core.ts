// Günlük rapor gönderiminin asıl mantığı. Veri erişimi ve fetch dışarıdan verilir;
// böylece aynı kod hem Edge Function'da hem testlerde (sahte veriyle) çalışır.
import {
  REPORT_SYSTEM_PROMPT,
  addDaysISO,
  buildFacts,
  fallbackNarrative,
  parseNarrative,
  renderEmail,
  reportUserPrompt,
  type Narrative,
  type ReportInput,
} from '../_shared/report.ts';

export interface ReportSettings {
  user_id: string;
  parent_email: string | null;
  child_name: string | null;
  send_hour: number; // yedek gönderim saati (yerel)
  timezone: string; // IANA, ör. Europe/Istanbul
  enabled: boolean;
}

export interface DataSource {
  settings(userId: string): Promise<ReportSettings | null>;
  /** Raporu "gönderiliyor" diye işaretler. O gün için zaten varsa false (günde tek rapor). */
  claim(userId: string, date: string, trigger: Trigger): Promise<boolean>;
  finish(userId: string, date: string, r: { subject: string; html: string; generated_by: string }): Promise<void>;
  /** Gönderim başarısız olursa işareti kaldırır ki tekrar denenebilsin. */
  release(userId: string, date: string): Promise<void>;
  gather(userId: string, date: string, childName: string): Promise<ReportInput>;
  enabledSettings(): Promise<ReportSettings[]>;
}

export interface Env {
  ANTHROPIC_API_KEY?: string;
  REPORT_MODEL?: string;
  RESEND_API_KEY?: string;
  REPORT_FROM?: string;
}

export type Trigger = 'button' | 'schedule';
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type SendResult =
  | { status: 'sent'; subject: string; html: string; generatedBy: 'llm' | 'fallback' }
  | { status: 'already' }
  | { status: 'disabled' }
  | { status: 'error'; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Bir anın verilen saat dilimindeki yerel tarihi ve saati. */
export function localNow(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** Buton modunda istenen tarih geçerli mi? Yalnızca çocuğun yerel bugünü ya da dünü. */
export function validButtonDate(date: string, now: Date, timeZone: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const today = localNow(now, timeZone).date;
  return date === today || date === addDaysISO(today, -1);
}

export async function writeNarrative(input: ReportInput, env: Env, fetchFn: FetchFn): Promise<{ n: Narrative; by: 'llm' | 'fallback' }> {
  const facts = buildFacts(input);
  if (!env.ANTHROPIC_API_KEY) return { n: fallbackNarrative(facts), by: 'fallback' };
  try {
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.REPORT_MODEL || 'claude-sonnet-5-5',
        max_tokens: 800,
        system: REPORT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: reportUserPrompt(facts) }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const n = parseNarrative(text);
    if (!n) throw new Error('Claude çıktısı JSON değil');
    return { n, by: 'llm' };
  } catch (e) {
    console.error('LLM başarısız, yedek metin kullanılıyor:', (e as Error).message);
    return { n: fallbackNarrative(facts), by: 'fallback' };
  }
}

export async function sendEmail(
  to: string,
  mail: { subject: string; html: string; text: string },
  env: Env,
  fetchFn: FetchFn,
): Promise<void> {
  if (!env.RESEND_API_KEY || !env.REPORT_FROM) throw new Error('RESEND_API_KEY / REPORT_FROM ayarlanmamış');
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.REPORT_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

export async function sendReport(
  ds: DataSource,
  env: Env,
  fetchFn: FetchFn,
  userId: string,
  date: string,
  trigger: Trigger,
): Promise<SendResult> {
  const settings = await ds.settings(userId);
  if (!settings?.enabled || !settings.parent_email) return { status: 'disabled' };
  if (!(await ds.claim(userId, date, trigger))) return { status: 'already' };
  try {
    const input = await ds.gather(userId, date, settings.child_name?.trim() || 'Çocuğunuz');
    const { n, by } = await writeNarrative(input, env, fetchFn);
    const mail = renderEmail(buildFacts(input), n, { generatedBy: by });
    await sendEmail(settings.parent_email, mail, env, fetchFn);
    await ds.finish(userId, date, { subject: mail.subject, html: mail.html, generated_by: by });
    return { status: 'sent', subject: mail.subject, html: mail.html, generatedBy: by };
  } catch (e) {
    await ds.release(userId, date);
    return { status: 'error', message: (e as Error).message };
  }
}

/**
 * Zamanlanmış çalışma (saatte bir): yedek saati gelmiş ve o gün raporu gitmemiş herkese gönder.
 * "Bugünü bitirdim"e basılmışsa claim zaten var → atlanır.
 */
export async function runSchedule(ds: DataSource, env: Env, fetchFn: FetchFn, now: Date) {
  const results: { userId: string; date: string; status: SendResult['status'] }[] = [];
  for (const s of await ds.enabledSettings()) {
    if (!s.parent_email) continue;
    const { date, hour } = localNow(now, s.timezone || 'Europe/Istanbul');
    if (hour < s.send_hour) continue;
    const r = await sendReport(ds, env, fetchFn, s.user_id, date, 'schedule');
    results.push({ userId: s.user_id, date, status: r.status });
  }
  return results;
}
