// Karakter gelişimi: toplam çalışma saatiyle seviye atlanır, her seviye gezintide bir yetenek açar.
// Dersler de "yetenek": bir derse çalıştıkça o dersin unvanı bronz → gümüş → altın olur.
// Hepsi kayıtlardan türetilir, veritabanında tutulmaz.
import { CFG } from './config';
import type { Course, StudyLog } from './types';

export interface Level {
  name: string;
  icon: string;
  /** Bu seviye için gereken toplam saat */
  hours: number;
  /** Açtığı yetenek */
  perk: string;
}

/** Saat eşikleri config'te (economy.json → levelHours) */
export const LEVELS: Level[] = [
  { name: 'Çırak', icon: '🌱', perk: 'Ormanda yürü, zıpla, yıldız topla' },
  { name: 'Kâşif', icon: '🧭', perk: 'Daha hızlı koşarsın' },
  { name: 'Orman Bekçisi', icon: '🛡️', perk: 'Havada bir kez daha zıplayabilirsin' },
  { name: 'Bahçıvan', icon: '🌻', perk: 'Yanına iki arkadaş hayvan alabilirsin' },
  { name: 'Orman Ustası', icon: '🪶', perk: 'Zıplamayı basılı tutunca süzülürsün' },
  { name: 'Orman Bilgesi', icon: '✨', perk: 'Yürürken altın parıltılar bırakırsın' },
  { name: 'Efsane', icon: '👑', perk: 'Efsane tacı ve fil' },
].map((l, i) => ({ ...l, hours: CFG.levelHours[i] }));

export interface LevelInfo {
  index: number;
  level: Level;
  next: Level | null;
  /** Sonraki seviyeye ilerleme 0–1 */
  progress: number;
  minutesLeft: number;
}

export function levelOf(totalMinutes: number): LevelInfo {
  let index = 0;
  LEVELS.forEach((l, i) => totalMinutes >= l.hours * 60 && (index = i));
  const level = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  const from = level.hours * 60;
  const to = next ? next.hours * 60 : from;
  return {
    index,
    level,
    next,
    progress: next ? (totalMinutes - from) / (to - from) : 1,
    minutesLeft: next ? to - totalMinutes : 0,
  };
}

/** Gezinti yetenekleri (seviye sırasına göre) */
export interface Perks {
  runBoost: number;
  doubleJump: boolean;
  glide: boolean;
  trail: boolean;
}

export function perksOf(levelIndex: number): Perks {
  return {
    runBoost: levelIndex >= 1 ? 1.15 : 1,
    doubleJump: levelIndex >= 2,
    glide: levelIndex >= 4,
    trail: levelIndex >= 5,
  };
}

export type Tier = 0 | 1 | 2 | 3;
/** Ders kademeleri; dakika eşikleri config'te (economy.json → skillTierMinutes) */
export const TIERS = [
  { name: '', icon: '', hours: 0 },
  { name: 'Bronz', icon: '🥉', hours: CFG.skillTierMinutes[0] / 60 },
  { name: 'Gümüş', icon: '🥈', hours: CFG.skillTierMinutes[1] / 60 },
  { name: 'Altın', icon: '🥇', hours: CFG.skillTierMinutes[2] / 60 },
] as const;

/** Ders adından unvan: matematik çalıştıkça "Bilge", Türkçe çalıştıkça "Hikâyeci"… */
export function skillTitle(courseName: string): { title: string; icon: string } {
  const n = courseName.toLocaleLowerCase('tr-TR');
  if (/mat|geometri|sayı/.test(n)) return { title: 'Bilge', icon: '🧮' };
  if (/türkçe|edebiyat|okuma|yazma|dil bilgisi/.test(n)) return { title: 'Hikâyeci', icon: '📖' };
  if (/fen|bilim|fizik|kimya|biyoloji/.test(n)) return { title: 'Mucit', icon: '🔬' };
  if (/ingilizce|almanca|fransızca|ispanyolca|yabancı|english/.test(n)) return { title: 'Gezgin', icon: '🌍' };
  if (/sosyal|tarih|coğrafya|hayat/.test(n)) return { title: 'Kâşif', icon: '🗺️' };
  if (/müzik|resim|sanat|beden|spor/.test(n)) return { title: 'Sanatçı', icon: '🎨' };
  return { title: 'Usta', icon: '⭐' };
}

export interface Skill {
  course: Course;
  title: string;
  icon: string;
  minutes: number;
  tier: Tier;
  /** Sonraki kademeye ilerleme 0–1 (altında 1) */
  progress: number;
  /** En az çalışılan ders: "bunu da büyüt" */
  weakest: boolean;
}

export function skillsOf(courses: Course[], logs: StudyLog[]): Skill[] {
  const min = new Map<string, number>();
  logs.forEach((l) => min.set(l.course_id, (min.get(l.course_id) ?? 0) + l.duration_minutes));
  const out: Skill[] = courses.map((course) => {
    const minutes = min.get(course.id) ?? 0;
    let tier: Tier = 0;
    for (let t = 1 as Tier; t <= 3; t = (t + 1) as Tier) if (minutes >= TIERS[t].hours * 60) tier = t;
    const next = TIERS[Math.min(3, tier + 1)];
    const from = TIERS[tier].hours * 60;
    const progress = tier === 3 ? 1 : (minutes - from) / (next.hours * 60 - from);
    return { course, ...skillTitle(course.name), minutes, tier, progress, weakest: false };
  });
  if (out.length > 1) {
    const low = out.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    if (low.tier < 3) low.weakest = true;
  }
  return out;
}
