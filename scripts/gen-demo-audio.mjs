// Tanıtım turunun seslerini Gemini TTS ile üretir: her sahne için src/demo/audio/<sahne>.mp3 ve kelime
// zamanları src/demo/audio/<sahne>.json. Uygulama canlı TTS çağırmaz; bu dosyalar bundle'a girer (src/demo/audio.ts),
// tek dosyalık demo derlemesinde sesler de HTML'in içine gömülür.
//
//   npm run demo:audio                 → yeni ve metni değişen sahneler (aynı metnin sesi varsa atlar)
//   npm run demo:audio -- --force      → hepsini yeniden üret
//   npm run demo:audio -- --only 04-sayac
//
// .env: GEMINI_API_KEY (zorunlu), GEMINI_TTS_MODEL (varsayılan gemini-3.8-flash-tts), GEMINI_VOICE (varsayılan Sulafat),
// GEMINI_CHECK_MODEL (varsayılan gemini-3.8-flash). MP3'e çevirmek için ffmpeg gerekir.
// Gemini kelime zamanı vermez; zamanlar sesin duraklamalarından çıkarılır (demo-words.mjs).
// TTS modele yalnızca metin gider: üslup notu eklenince model notu metnin yerine okuyabiliyor. Bu yüzden her ses ayrıca
// yazıya dökülüp metinle karşılaştırılır (--no-check kapatır); tutmayan ses kaydedilmez, tur o sahneyi yazılı oynar.
// Ücretsiz katman: model başına dakikada ~3, günde ~10 istek. Kota biterse ertesi gün yeniden çalıştır; kalanlar üretilir.
// Anahtar yalnızca bu script'te kullanılır; VITE_ öneki olmadığı için ön yüze hiç girmez.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPcm, transcriptDiff, wordsFromAudio } from './demo-words.mjs';

const root = new URL('..', import.meta.url);
const out = new URL('src/demo/audio/', root);
const { scenes } = JSON.parse(readFileSync(new URL('src/demo/script.json', root), 'utf8'));
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const checkModel = process.env.GEMINI_CHECK_MODEL || 'gemini-3.8-flash';
// Sıcak, sakin bir ses; diğerleri: Leda (genç), Aoede (ferah), Puck (neşeli), Achird (samimi)…
const voice = process.env.GEMINI_VOICE || 'Sulafat';
const args = process.argv.slice(2);
const force = args.includes('--force');
const check = !args.includes('--no-check');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const TAKES = 2;

if (!key) {
  console.error('GEMINI_API_KEY yok: .env dosyasına ekle (bkz. .env.example).');
  process.exit(1);
}
if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('ffmpeg bulunamadı (MP3 için gerekli): brew install ffmpeg');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

class DailyQuota extends Error {}

/** generateContent; 429'da sunucunun söylediği kadar bekler, günlük kota bitince DailyQuota fırlatır */
async function gemini(name, request, pick) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body = await res.json().catch(() => null);
    const got = res.ok ? pick(body?.candidates?.[0]?.content?.parts ?? []) : null;
    if (got) return got;
    const err = body?.error;
    const why = res.ok ? `boş yanıt (${body?.candidates?.[0]?.finishReason ?? '?'})` : `${res.status} ${(err?.message ?? '').split('\n')[0].slice(0, 160)}`;
    const quota = err?.details?.find((d) => d.violations)?.violations?.[0]?.quotaId ?? '';
    const retryIn = Number.parseFloat(err?.details?.find((d) => d.retryDelay)?.retryDelay ?? '');
    if (/PerDay/.test(quota)) throw new DailyQuota(`${name} günlük kotası doldu; yarın yeniden çalıştır, kalan sahneler üretilir`);
    if (attempt >= 6 || (!res.ok && res.status < 500 && res.status !== 429)) throw new Error(`${name}: ${why}`);
    const wait = res.status === 429 && retryIn ? retryIn + 1 : 2 * attempt ** 2;
    console.log(`  … ${why}; ${Math.round(wait)} sn sonra yeniden deneniyor`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

const speak = (text) =>
  gemini(
    model,
    {
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    },
    (parts) => {
      const d = parts.find((p) => p.inlineData)?.inlineData;
      return d && { buf: Buffer.from(d.data, 'base64'), mime: d.mimeType };
    },
  );

const transcribe = (wav) =>
  gemini(
    checkModel,
    { contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }, { text: 'Bu Türkçe konuşmayı aynen yazıya dök. Yalnızca duyduğun metni yaz.' }] }] },
    (parts) => parts.map((p) => p.text ?? '').join('').trim() || null,
  );

let failed = 0;
try {
  for (const s of scenes) {
    if (only && s.id !== only) continue;
    const mp3 = new URL(`${s.id}.mp3`, out);
    const json = new URL(`${s.id}.json`, out);
    if (!force && existsSync(mp3) && existsSync(json) && JSON.parse(readFileSync(json, 'utf8')).text === s.text) {
      console.log(`= ${s.id} (var, atlandı)`);
      continue;
    }
    let take = null;
    for (let t = 1; t <= TAKES && !take; t++) {
      const audio = await speak(s.text);
      const { samples, rate } = readPcm(audio.buf, audio.mime);
      // ffmpeg'e ve kontrole her zaman WAV ver (ham L16 gelirse başlık ekle)
      const wav = audio.buf.toString('ascii', 0, 4) === 'RIFF' ? audio.buf : wavOf(samples, rate);
      const diff = check ? transcriptDiff(s.text, await transcribe(wav)) : null;
      if (diff && !diff.ok) {
        console.log(`  ✗ ${s.id} ${t}. deneme metni tutmuyor — fazla: ${diff.extra.join(' ') || '-'} · eksik: ${diff.missing.join(' ') || '-'}`);
        continue;
      }
      take = { wav, samples, rate };
    }
    if (!take) {
      failed++;
      // Eski (başka metnin) sesi kalmasın: tur bu sahneyi yazılı oynar
      rmSync(json, { force: true });
      rmSync(mp3, { force: true });
      console.error(`✗ ${s.id}: ${TAKES} denemede de metin tutmadı, atlandı`);
      continue;
    }
    // loudnorm: farklı TTS modellerinden (kota bitince GEMINI_TTS_MODEL ile değişebilir) gelen sesler aynı yükseklikte çalsın
    const enc = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', fileURLToPath(mp3)], { input: take.wav });
    if (enc.status !== 0) throw new Error(`${s.id}: ffmpeg ${enc.stderr}`);
    const words = wordsFromAudio(s.text, take.samples, take.rate);
    writeFileSync(json, JSON.stringify({ id: s.id, text: s.text, words }, null, 0) + '\n');
    console.log(`✓ ${s.id}: ${words.length} kelime, ${(take.samples.length / take.rate).toFixed(1)} sn${check ? ', metin tuttu' : ''}`);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
if (failed) process.exit(1);
console.log('Bitti: src/demo/audio/');

function wavOf(samples, rate) {
  const h = Buffer.alloc(44);
  const size = samples.length * 2;
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + size, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(size, 40);
  return Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, size)]);
}
