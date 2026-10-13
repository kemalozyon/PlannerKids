// Kademeli seri: kaçırılan gün seriyi sıfırlamaz, bir alt kademenin eşiğine düşürür (ör. 10 → 3).
// Hafta sonu ve bugün seriyi bozmaz. Seri dondurma bir düşüşü engeller.
// Seri kademesindeki her çalışılan gün (en az minMinutes) kademe bonusu kadar 💎 verir.
// Aynı kural SQL'de: 0010_economy_v2.sql → economy_streak().
import { CFG } from './config';
import { addDays, parseLocalDate } from './date';

export interface StreakResult {
  /** Şu anki seri (gün) */
  streak: number;
  best: number;
  /** 0: kademe yok, 1…: CFG.elmas.streak.tiers sırası */
  tier: number;
  /** Seri bonusu alan günler → 💎 */
  bonus: Map<string, number>;
  freezesUsed: number;
  freezesLeft: number;
}

const isWeekend = (d: string) => [0, 6].includes(parseLocalDate(d).getDay());

/** Kaç kademe eşiği geçildi */
export function tierOf(run: number, tiers = CFG.elmas.streak.tiers): number {
  return tiers.filter((t) => run >= t.days).length;
}

/** Bir gün kaçırılınca seri bir alt kademenin eşiğine iner */
export function dropTier(run: number, tiers = CFG.elmas.streak.tiers): number {
  const k = tierOf(run, tiers);
  return k >= 2 ? tiers[k - 2].days : 0;
}

/**
 * @param minutesOf günün (güvenilir) çalışma dakikası
 * @param first ilk çalışılan gün
 * @param freezes satın alınan seri dondurmaların tarihleri; bir dondurma, alındığı günden en çok
 *   coverDays gün önceki bir kaçırmayı kapatır (eskisi önce kullanılır)
 */
export function computeStreak(
  minutesOf: (d: string) => number,
  first: string | null,
  today: string,
  freezes: string[] = [],
  cfg = CFG.elmas.streak,
  coverDays = CFG.freeze.coverDays,
): StreakResult {
  let run = 0;
  let best = 0;
  const bonus = new Map<string, number>();
  const left = [...freezes].sort();
  let freezesUsed = 0;
  if (first) {
    for (let d = first; d <= today; d = addDays(d, 1)) {
      const m = minutesOf(d);
      if (m > 0) {
        run++;
        const k = tierOf(run, cfg.tiers);
        if (k > 0 && m >= cfg.minMinutes) bonus.set(d, cfg.tiers[k - 1].bonus);
      } else if (d === today || isWeekend(d) || run === 0) {
        /* seriyi bozmaz */
      } else {
        const i = left.findIndex((p) => p <= addDays(d, coverDays));
        if (i >= 0) {
          left.splice(i, 1);
          freezesUsed++;
        } else run = dropTier(run, cfg.tiers);
      }
      best = Math.max(best, run);
    }
  }
  return { streak: run, best, tier: tierOf(run, cfg.tiers), bonus, freezesUsed, freezesLeft: left.length };
}
