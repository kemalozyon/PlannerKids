// Tüm tarihler kullanıcının yerel saatine göre YYYY-MM-DD.
export function toLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}

/** Haftanın pazartesi günü (TR haftası pazartesi başlar). */
export function weekStart(s: string): string {
  const d = parseLocalDate(s);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toLocalDate(d);
}

export function formatDay(s: string): string {
  return parseLocalDate(s).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatShort(s: string): string {
  return parseLocalDate(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function formatMinutes(min: number): string {
  if (min <= 0) return '0 dk';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

/** İki yerel tarih arasındaki gün farkı (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 864e5);
}
