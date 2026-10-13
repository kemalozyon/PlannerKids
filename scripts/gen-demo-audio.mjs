// Tanıtım turunun seslerini ElevenLabs ile üretir: her sahne için public/demo/<sahne>.mp3 ve kelime
// zamanları public/demo/<sahne>.json. Uygulama canlı TTS çağırmaz; yalnızca bu statik dosyaları çalar.
//
//   npm run demo:audio                 → bütün sahneler (var olanları atlar)
//   npm run demo:audio -- --force      → hepsini yeniden üret
//   npm run demo:audio -- --only 02-sayac
//
// .env: ELEVENLABS_API_KEY (zorunlu), ELEVENLABS_VOICE_ID (isteğe bağlı), ELEVENLABS_MODEL (varsayılan eleven_multilingual_v2).
// Anahtar yalnızca bu script'te kullanılır; VITE_ öneki olmadığı için ön yüze hiç girmez.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { wordsFromAlignment } from './demo-words.mjs';

const root = new URL('..', import.meta.url);
const out = new URL('public/demo/', root);
const { scenes } = JSON.parse(readFileSync(new URL('src/demo/script.json', root), 'utf8'));
const key = process.env.ELEVENLABS_API_KEY;
// Varsayılan: çok dilli, sıcak bir anlatıcı sesi (ElevenLabs kütüphanesinden değiştirilebilir)
const voice = process.env.ELEVENLABS_VOICE_ID || 'XrExE9yKIg1WjnnlVkGX';
const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

if (!key) {
  console.error('ELEVENLABS_API_KEY yok: .env dosyasına ekle (bkz. .env.example).');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

for (const s of scenes) {
  if (only && s.id !== only) continue;
  const mp3 = new URL(`${s.id}.mp3`, out);
  const json = new URL(`${s.id}.json`, out);
  if (!force && existsSync(mp3) && existsSync(json)) {
    console.log(`= ${s.id} (var, atlandı)`);
    continue;
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: s.text,
      model_id: model,
      language_code: 'tr',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, speed: 0.95 },
    }),
  });
  if (!res.ok) {
    console.error(`✗ ${s.id}: ElevenLabs ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const body = await res.json();
  const words = wordsFromAlignment(body.alignment ?? body.normalized_alignment);
  writeFileSync(mp3, Buffer.from(body.audio_base64, 'base64'));
  writeFileSync(json, JSON.stringify({ id: s.id, text: s.text, words }, null, 0) + '\n');
  console.log(`✓ ${s.id}: ${words.length} kelime, ${words.at(-1)?.e.toFixed(1)} sn`);
}
console.log('Bitti: public/demo/');
