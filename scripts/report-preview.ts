// Günlük raporu Supabase'e deploy etmeden yerelde dener: Edge Function'ın kodunu örnek veriyle çalıştırır.
//
//   npm run report:preview                     → EVREN metni yazar, report-preview.html'e kaydeder
//   npm run report:preview -- --send a@b.com    → ayrıca Resend ile o adrese gönderir
//
// Anahtarlar .env'den okunur: EVREN_API_KEY (yoksa yedek metin), REPORT_MODEL, EVREN_BASE_URL,
// gönderim için RESEND_API_KEY ve REPORT_FROM.
import { writeFileSync } from 'node:fs';
import { buildFacts, renderEmail } from '../supabase/functions/_shared/report.ts';
import { sampleInput } from '../supabase/functions/_shared/report.fixtures.ts';
import { DEFAULT_REPORT_MODEL, sendEmail, writeNarrative, type Env } from '../supabase/functions/daily-report/core.ts';

const env: Env = {
  EVREN_API_KEY: process.env.EVREN_API_KEY,
  EVREN_BASE_URL: process.env.EVREN_BASE_URL,
  REPORT_MODEL: process.env.REPORT_MODEL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  REPORT_FROM: process.env.REPORT_FROM,
};
const sendTo = process.argv[process.argv.indexOf('--send') + 1];
const send = process.argv.includes('--send');
if (send && !sendTo) {
  console.error('Kullanım: npm run report:preview -- --send ornek@eposta.com');
  process.exit(1);
}

const input = sampleInput();
if (!env.EVREN_API_KEY) console.warn('EVREN_API_KEY yok → LLM çağrılmadan yedek metin kullanılacak.');
const { n, by } = await writeNarrative(input, env, fetch);
const mail = renderEmail(buildFacts(input), n, { generatedBy: by });

const out = 'report-preview.html';
writeFileSync(out, mail.html);
console.log(`Metni yazan: ${by === 'llm' ? `EVREN (${env.REPORT_MODEL || DEFAULT_REPORT_MODEL})` : 'yedek kurallar'}`);
console.log(`Konu: ${mail.subject}\n\n${mail.text}\n\nHTML → ${out}`);

if (send) {
  await sendEmail(sendTo, mail, env, fetch);
  console.log(`E-posta gönderildi → ${sendTo}`);
}
