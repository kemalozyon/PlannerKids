// Ay yardımcıları (orman bölgeleri ve geçmiş takvimi aylara göre). Ağaç kuralları world.ts'te.

export const monthOf = (date: string) => date.slice(0, 7); // YYYY-MM

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}
