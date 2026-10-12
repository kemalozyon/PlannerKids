// Solgun fidan: sayaç yarıda bırakılırsa adada solgun bir fidan kalır. Aynı gün, iptalden sonra
// REVIVE_MIN dakika çalışılırsa fidan yeniden yeşerir. Ceza değil, ikinci şans: çocuğu küstürmesin.
import type { Abandoned, StudyLog } from './types';

/** Bundan kısa süren iptaller iz bırakmaz (yanlışlıkla başlatılan sayaç) */
export const WILT_MIN = 5;
/** Canlandırmak için iptalden sonra aynı gün çalışılması gereken dakika */
export const REVIVE_MIN = 10;

export interface Wilt {
  item: Abandoned;
  /** İptalden sonra aynı gün çalışılan dakika */
  after: number;
  revived: boolean;
}

export function wiltsOf(abandoned: Abandoned[], logs: StudyLog[]): Wilt[] {
  return abandoned.map((item) => {
    const after = logs
      .filter((l) => l.date === item.date && l.created_at > item.created_at)
      .reduce((s, l) => s + l.duration_minutes, 0);
    return { item, after, revived: after >= REVIVE_MIN };
  });
}
