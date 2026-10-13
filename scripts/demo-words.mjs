// ElevenLabs "with-timestamps" yanıtındaki karakter hizalamasını kelime zamanlarına çevirir.
// alignment: { characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[] }
// Dönen kelimeler metindeki boşlukla ayrılmış kelimelerle aynı sırada: [{ w, s, e }]

export function wordsFromAlignment(alignment) {
  const { characters: ch, character_start_times_seconds: st, character_end_times_seconds: en } = alignment;
  const out = [];
  let cur = null;
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { w: '', s: st[i], e: en[i] };
    cur.w += ch[i];
    cur.e = en[i];
  }
  if (cur) out.push(cur);
  return out.map((x) => ({ w: x.w, s: Math.round(x.s * 1000) / 1000, e: Math.round(x.e * 1000) / 1000 }));
}
