// Ödül hedefleri: ilerleme kayıtlardan türetilir, orman parasını harcamaz.
import type { Book, Reward, RewardKind } from './types';

export const REWARD_KINDS: { id: RewardKind; label: string; unit: string; example: number }[] = [
  { id: 'minutes', label: 'Toplam dakika', unit: 'dk', example: 600 },
  { id: 'streak', label: 'Seri (gün)', unit: 'gün', example: 14 },
  { id: 'books', label: 'Biten kitap', unit: 'kitap', example: 3 },
  { id: 'plans', label: 'Tamamlanan planlı gün', unit: 'gün', example: 5 },
];

export const kindOf = (k: RewardKind) => REWARD_KINDS.find((x) => x.id === k) ?? REWARD_KINDS[0];

export interface RewardInput {
  dayTotals: Map<string, number>;
  streak: number;
  books: Book[];
  planDays: string[];
}

export interface RewardProgress {
  reward: Reward;
  value: number;
  pct: number; // 0–1
  reached: boolean;
  /** "180 dk kaldı" gibi */
  leftText: string;
}

export function rewardProgress(r: Reward, x: RewardInput): RewardProgress {
  let value = 0;
  if (r.kind === 'minutes') {
    for (const [d, m] of x.dayTotals) if (d >= r.start_date) value += m;
  } else if (r.kind === 'streak') {
    value = x.streak; // seri zaten kesintisiz bugüne kadar sayılır
  } else if (r.kind === 'books') {
    value = x.books.filter((b) => b.status === 'done' && b.finished_on && b.finished_on >= r.start_date).length;
  } else {
    value = x.planDays.filter((d) => d >= r.start_date).length;
  }
  const reached = value >= r.target;
  const left = Math.max(0, r.target - value);
  return {
    reward: r,
    value: Math.min(value, r.target),
    pct: Math.min(1, value / r.target),
    reached,
    leftText: reached ? 'Hedefe ulaştın!' : `${left} ${kindOf(r.kind).unit} kaldı`,
  };
}

/** Henüz verilmemiş ödüller; en çok ilerleyen önce. */
export function openRewards(rewards: Reward[], x: RewardInput): RewardProgress[] {
  return rewards
    .filter((r) => !r.claimed_on)
    .map((r) => rewardProgress(r, x))
    .sort((a, b) => b.pct - a.pct);
}
