// Gemini TTS kelime zamanı vermez: zamanları sesin kendisinden çıkarırız.
// 1) 10 ms'lik karelerin enerjisinden sessiz aralıkları (duraklamaları) bul,
// 2) her duraklamayı metindeki bir kelime arasına eşle (noktalama olan aralar ve harf oranına göre beklenen yer tercih edilir),
// 3) iki duraklama arasındaki sesli bölümü kelimelere harf sayısıyla paylaştır.
// Dönen kelimeler metindeki boşlukla ayrılmış kelimelerle aynı sırada: [{ w, s, e }] (saniye)

const FRAME = 0.01; // sn
const MIN_GAP = 0.14; // bundan kısa sessizlik kelime içi sayılır

/** WAV (RIFF, 16 bit PCM) ya da ham L16 → { samples: Int16Array, rate } */
export function readPcm(buf, mime = 'audio/wav') {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    return { samples: new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length & ~1))), rate };
  }
  let rate = 24000;
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(p + 12);
    if (id === 'data') {
      const end = Math.min(buf.length, p + 8 + size) & ~1;
      return { samples: new Int16Array(buf.buffer.slice(buf.byteOffset + p + 8, buf.byteOffset + end)), rate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('WAV içinde data bölümü yok');
}

/** Sesli kareler → konuşmanın başı/sonu ve aradaki duraklamalar (sn) */
export function speechGaps(samples, rate) {
  const n = Math.max(1, Math.round(rate * FRAME));
  const rms = [];
  for (let i = 0; i < samples.length; i += n) {
    let sum = 0;
    const end = Math.min(samples.length, i + n);
    for (let k = i; k < end; k++) sum += samples[k] * samples[k];
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const voiced = rms.map((r) => r > Math.max(loud * 0.06, 60));
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return { start: 0, end: 0, gaps: [] };
  const gaps = [];
  for (let i = first; i <= last; i++) {
    if (voiced[i]) continue;
    let j = i;
    while (j <= last && !voiced[j]) j++;
    if ((j - i) * FRAME >= MIN_GAP) gaps.push({ s: i * FRAME, e: j * FRAME });
    i = j;
  }
  return { start: first * FRAME, end: (last + 1) * FRAME, gaps };
}

const weight = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1;
const pauseAfter = (w) => (/[.!?…]["')]*$/.test(w) ? 1 : /[,;:—-]["')]*$/.test(w) ? 0.6 : 0.08);

export function wordsFromAudio(text, samples, rate) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const { start, end, gaps: all } = speechGaps(samples, rate);
  // En fazla kelime arası sayısı kadar duraklama kullanılabilir: fazlaysa en kısalar atılır
  const gaps = [...all].sort((a, b) => b.e - b.s - (a.e - a.s)).slice(0, words.length - 1).sort((a, b) => a.s - b.s);
  // Sesli zaman ekseni: duraklamalar çıkarılınca her duraklamanın konumu
  const voicedTotal = end - start - gaps.reduce((t, g) => t + g.e - g.s, 0);
  let acc = 0;
  let prev = start;
  const gapPos = gaps.map((g) => {
    acc += g.s - prev;
    prev = g.e;
    return acc / voicedTotal;
  });
  // Kelime araları (k: k. kelimeden sonra) ve harf oranına göre beklenen konumları
  const total = words.reduce((t, w) => t + weight(w), 0);
  let c = 0;
  const bPos = words.slice(0, -1).map((w) => (c += weight(w)) / total);
  const bCost = words.slice(0, -1).map((w) => -Math.log(pauseAfter(w)));
  // DP: duraklamaları sırayla, artan kelime aralarına eşle (her duraklama bir araya)
  const G = gaps.length;
  const K = bPos.length;
  const cost = (j, k) => Math.abs(gapPos[j] - bPos[k]) * 12 + bCost[k];
  let best = Array.from({ length: K }, (_, k) => cost(0, k));
  const from = [Array.from({ length: K }, () => -1)];
  for (let j = 1; j < G; j++) {
    const next = Array.from({ length: K }, () => Infinity);
    const arg = Array.from({ length: K }, () => -1);
    let m = Infinity;
    let mk = -1;
    for (let k = 0; k < K; k++) {
      if (k > 0 && best[k - 1] < m) [m, mk] = [best[k - 1], k - 1];
      if (mk >= 0) [next[k], arg[k]] = [m + cost(j, k), mk];
    }
    best = next;
    from.push(arg);
  }
  const at = [];
  if (G) {
    let k = best.indexOf(Math.min(...best));
    for (let j = G - 1; j >= 0; j--) {
      at[j] = k;
      k = from[j][k];
    }
  }
  // Duraklamalarla bölünen parçalarda kelimeleri sesli süreye harf oranıyla yay
  const out = [];
  let w0 = 0;
  let t0 = start;
  for (let j = 0; j <= G; j++) {
    const w1 = j < G ? at[j] + 1 : words.length;
    const t1 = j < G ? gaps[j].s : end;
    const part = words.slice(w0, w1);
    const sum = part.reduce((t, w) => t + weight(w), 0);
    let cum = 0;
    for (const w of part) {
      const s = t0 + ((t1 - t0) * cum) / sum;
      cum += weight(w);
      const e = t0 + ((t1 - t0) * cum) / sum;
      out.push({ w, s: Math.round(s * 1000) / 1000, e: Math.round(e * 1000) / 1000 });
    }
    w0 = w1;
    if (j < G) t0 = gaps[j].e;
  }
  return out;
}

const tokens = (s) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);

/** Sesin yazıya dökümü metinle tutuyor mu? Küçük farklara (yazım, kesme işareti) izin verir. */
export function transcriptDiff(text, transcript) {
  const a = tokens(text);
  const b = tokens(transcript);
  const left = [...b];
  const missing = a.filter((w) => {
    const i = left.indexOf(w);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  const extra = left;
  return { ok: missing.length + extra.length <= Math.max(2, Math.round(a.length * 0.12)), missing, extra };
}
