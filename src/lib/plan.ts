// Planlama: günlük ders planı ile çalışma kayıtlarını karşılaştıran saf fonksiyonlar.
import { addDays, parseLocalDate } from './date';
import type { Course, NewPlanItem, PlanItem, StudyLog } from './types';

export interface PlanRow {
  item: PlanItem;
  done: number; // o gün o derse çalışılan dakika
  left: number; // plana kalan dakika (0 = tamam)
  complete: boolean;
}

export interface DayPlan {
  rows: PlanRow[];
  planned: number;
  /** Plana sayılan dakika (her ders kendi planıyla sınırlı) */
  done: number;
  complete: boolean;
  pending: boolean; // onay bekleyen satır var
}

/** Bir günün planı ve ilerlemesi. Plan yoksa null. */
export function dayPlan(date: string, plans: PlanItem[], logs: StudyLog[]): DayPlan | null {
  const items = plans.filter((p) => p.date === date);
  if (!items.length) return null;
  const byCourse = new Map<string, number>();
  logs.filter((l) => l.date === date).forEach((l) => byCourse.set(l.course_id, (byCourse.get(l.course_id) ?? 0) + l.duration_minutes));
  const rows = items.map((item) => {
    const done = byCourse.get(item.course_id) ?? 0;
    const left = Math.max(0, item.minutes - done);
    return { item, done, left, complete: left === 0 };
  });
  const planned = rows.reduce((s, r) => s + r.item.minutes, 0);
  return {
    // Bitmeyenler üstte, kendi sıralarında
    rows: [...rows].sort((a, b) => Number(a.complete) - Number(b.complete)),
    planned,
    done: rows.reduce((s, r) => s + Math.min(r.done, r.item.minutes), 0),
    complete: rows.every((r) => r.complete),
    pending: items.some((i) => !i.approved),
  };
}

/** Planı tamamen bitirilmiş günler (sıralı). */
export function completedPlanDays(plans: PlanItem[], logs: StudyLog[]): string[] {
  const dates = [...new Set(plans.map((p) => p.date))].sort();
  return dates.filter((d) => dayPlan(d, plans, logs)?.complete);
}

export const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** Haftanın 7 günü (pazartesiden başlar). */
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

export const isWeekendDate = (d: string) => [0, 6].includes(parseLocalDate(d).getDay());

export interface PlanTemplate {
  id: string;
  name: string;
  desc: string;
  /** Bir gün için ders başına dakika; 0 = o gün plan yok */
  minutes: (dayIndex: number, courseIndex: number) => number;
}

/** Hazır şablonlar. dayIndex 0 = pazartesi. */
export const TEMPLATES: PlanTemplate[] = [
  {
    id: 'okul',
    name: 'Okul haftası',
    desc: 'Hafta içi her derse 20 dk, cumartesi hafif, pazar dinlenme',
    minutes: (d, c) => (d < 5 ? (c < 4 ? 20 : 0) : d === 5 ? (c < 2 ? 15 : 0) : 0),
  },
  {
    id: 'sinav',
    name: 'Sınav haftası',
    desc: 'Hafta içi her derse 30 dk, cumartesi 20 dk',
    minutes: (d, c) => (d < 5 ? (c < 5 ? 30 : 0) : d === 5 ? (c < 4 ? 20 : 0) : 0),
  },
  {
    id: 'hafif',
    name: 'Hafif hafta',
    desc: 'Hafta içi her gün iki derse 15 dk',
    minutes: (d, c) => (d < 5 && (c === d % 4 || c === (d + 1) % 4) ? 15 : 0),
  },
  { id: 'tatil', name: 'Tatil', desc: 'Planı boşalt', minutes: () => 0 },
];

/** Şablonu bir haftaya uygular. Ders sırası Dersler sekmesindeki sıradır. */
export function applyTemplate(t: PlanTemplate, monday: string, courses: Course[]): NewPlanItem[] {
  const out: NewPlanItem[] = [];
  weekDates(monday).forEach((date, d) =>
    courses.forEach((c, ci) => {
      const minutes = t.minutes(d, ci);
      if (minutes > 0) out.push({ date, course_id: c.id, minutes, note: null });
    }),
  );
  return out;
}
