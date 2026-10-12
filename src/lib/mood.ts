// Günlük değerlendirme: 1–5 puan veritabanında aynı kalır, arayüzde yüz ifadesi olarak görünür.
export const MOODS = [
  { value: 1, face: '😞', label: 'Çok zordu' },
  { value: 2, face: '🙁', label: 'Biraz zordu' },
  { value: 3, face: '😐', label: 'Fena değil' },
  { value: 4, face: '🙂', label: 'İyiydi' },
  { value: 5, face: '😄', label: 'Süperdi' },
] as const;

export const moodFace = (r: number | null | undefined) => (r ? MOODS[r - 1]?.face : undefined);

const PROMPTS = [
  'Bugün en çok neyi sevdin?',
  'Bugün yeni ne öğrendin?',
  'Seni en çok ne zorladı?',
  'Yarın neye çalışmak istersin?',
  'Bugün kendinle neden gurur duyuyorsun?',
  'Bir arkadaşına bugünü nasıl anlatırdın?',
  'Bugün en kolay hangi ders geldi?',
];

/** Her gün farklı, ama gün içinde sabit kalan soru. */
export function dailyPrompt(date: string): string {
  let h = 0;
  for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROMPTS[h % PROMPTS.length];
}
