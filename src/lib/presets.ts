// İlkokul/ortaokul dersleri — tek dokunuşla eklenebilsin diye.
export const SCHOOL_SUBJECTS = [
  { name: 'Türkçe', color: '#d1477a' },
  { name: 'Matematik', color: '#4f7cff' },
  { name: 'Fen Bilimleri', color: '#16a37f' },
  { name: 'Sosyal Bilgiler', color: '#e0803a' },
  { name: 'İngilizce', color: '#8b5cf6' },
  { name: 'Din Kültürü', color: '#0ea5c6' },
  { name: 'Okuma', color: '#c9a227' },
];

/** İlk kurulumda önerilen 5 ana ders */
export const CORE_SUBJECTS = SCHOOL_SUBJECTS.slice(0, 5);

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');
export const hasCourse = (names: string[], name: string) => names.some((n) => norm(n) === norm(name));
