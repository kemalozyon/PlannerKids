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
  reportsPreviousDay,
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
  GEMINI_API_KEY?: string;
  REPORT_MODEL?: string;
  /** İlk model yanıt vermezse denenen ikinci model */
  REPORT_FALLBACK_MODEL?: string;
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

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_REPORT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash';
/** Gemini önce düşünür ve düşünme bu bütçeden yer; düşük tutulursa JSON yarım kalır. */
const LLM_MAX_TOKENS = 4000;
/** Yanıtın biçimi: model bu şemaya uygun JSON döndürür (parseNarrative yine de denetler). */
const NARRATIVE_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    parent_tip: { type: 'string' },
  },
  required: ['subject', 'summary', 'highlights', 'parent_tip'],
};
/**
 * Model başına bekleme: önce asıl model, yanıt vermezse yedek model. Gemini yoğunken 1–2 dakika
 * sürebiliyor; toplam (105 sn + e-posta) pg_net'in 120 sn'sine ve function'ın 150 sn'sine sığar.
 */
const LLM_TIMEOUT_MS = [60_000, 45_000];

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

/** Tek bir Gemini çağrısı; zaman aşımı, HTTP hatası ya da JSON olmayan yanıt hata fırlatır. */
async function askGemini(model: string, timeoutMs: number, facts: ReturnType<typeof buildFacts>, key: string, fetchFn: FetchFn): Promise<Narrative> {
  const res = await fetchFn(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: REPORT_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: reportUserPrompt(facts) }] }],
      generationConfig: { maxOutputTokens: LLM_MAX_TOKENS, responseMimeType: 'application/json', responseSchema: NARRATIVE_SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  // Düşünce parçaları (thought) metne katılmaz
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const n = parseNarrative(parts.filter((p) => !p.thought).map((p) => p.text ?? '').join(''));
  if (!n) throw new Error('LLM çıktısı JSON değil');
  return n;
}

export async function writeNarrative(input: ReportInput, env: Env, fetchFn: FetchFn): Promise<{ n: Narrative; by: 'llm' | 'fallback'; model?: string }> {
  const facts = buildFacts(input);
  if (!env.GEMINI_API_KEY) return { n: fallbackNarrative(facts), by: 'fallback' };
  const primary = env.REPORT_MODEL || DEFAULT_REPORT_MODEL;
  const backup = env.REPORT_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  const models = backup === primary ? [primary] : [primary, backup];
  for (const [i, model] of models.entries()) {
    try {
      return { n: await askGemini(model, LLM_TIMEOUT_MS[i], facts, env.GEMINI_API_KEY, fetchFn), by: 'llm', model };
    } catch (e) {
      console.error(`LLM (${model}) başarısız:`, (e as Error).message);
    }
  }
  console.error('LLM yanıt vermedi, yedek metin kullanılıyor');
  return { n: fallbackNarrative(facts), by: 'fallback' };
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

/** Gönderim saatinden sonra kaç saat daha denenir (başarısız çalışmayı yakalamak için). */
export const CATCHUP_HOURS = 6;

/**
 * Şu an hangi günün raporunun gönderilme vakti? Yoksa null.
 * Saat 12–23: o günün raporu o saatte; 00–11: önceki günün raporu ertesi sabah o saatte.
 * Gönderim saatinden sonraki CATCHUP_HOURS saat içinde tekrar denenir (gece yarısını geçse de doğru gün).
 */
export function dueReportDate(now: Date, timeZone: string, sendHour: number): string | null {
  const { date, hour } = localNow(now, timeZone);
  const elapsed = hour >= sendHour ? hour - sendHour : hour + 24 - sendHour;
  if (elapsed >= CATCHUP_HOURS) return null;
  const sendDay = hour >= sendHour ? date : addDaysISO(date, -1);
  return reportsPreviousDay(sendHour) ? addDaysISO(sendDay, -1) : sendDay;
}

/**
 * Zamanlanmış çalışma (saatte bir): gönderim saati gelmiş ve o günün raporu gitmemiş herkese gönder.
 * "Bugünü bitirdim"e basılmışsa claim zaten var → atlanır.
 */
export async function runSchedule(ds: DataSource, env: Env, fetchFn: FetchFn, now: Date) {
  const due = (await ds.enabledSettings()).flatMap((s) => {
    const date = s.parent_email ? dueReportDate(now, s.timezone || 'Europe/Istanbul', s.send_hour) : null;
    return date ? [{ s, date }] : [];
  });
  // Aynı anda: her biri LLM'i 90 sn'ye kadar bekleyebilir, sırayla gitse function süre sınırını aşar.
  const results = await Promise.all(
    due.map(async ({ s, date }) => ({ userId: s.user_id, date, status: (await sendReport(ds, env, fetchFn, s.user_id, date, 'schedule')).status })),
  );
  return results;
}
