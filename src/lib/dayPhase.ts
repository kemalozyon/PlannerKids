/** Günün saatine göre ışık. 6–10 sabah, 10–17 gündüz, 17–20 akşam, 20–6 gece. */
export type DayPhase = 'sabah' | 'gunduz' | 'aksam' | 'gece';

export function dayPhase(hour: number): DayPhase {
  if (hour >= 6 && hour < 10) return 'sabah';
  if (hour >= 10 && hour < 17) return 'gunduz';
  if (hour >= 17 && hour < 20) return 'aksam';
  return 'gece';
}
