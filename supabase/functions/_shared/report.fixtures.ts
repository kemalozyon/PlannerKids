// Testler için örnek rapor girdisi (Ece, 12 Ekim 2026).
import type { ReportInput } from './report.ts';

export function sampleInput(over: Partial<ReportInput> = {}): ReportInput {
  return {
    date: '2026-10-12',
    childName: 'Ece',
    studyLogs: [
      { course: 'Matematik', color: '#4f7cff', minutes: 40, note: 'kesirler' },
      { course: 'Türkçe', color: '#16a37f', minutes: 25 },
      { course: 'Matematik', color: '#4f7cff', minutes: 20 },
    ],
    week: [
      { date: '2026-10-06', minutes: 30 },
      { date: '2026-10-07', minutes: 0 },
      { date: '2026-10-08', minutes: 60 },
      { date: '2026-10-09', minutes: 45 },
      { date: '2026-10-10', minutes: 0 },
      { date: '2026-10-11', minutes: 45 },
      { date: '2026-10-12', minutes: 85 },
    ],
    reflection: { rating: 4, note: 'Kesirleri anladım' },
    tasks: [
      { title: 'Ödev', done: true },
      { title: 'Çanta', done: false },
    ],
    reading: [{ book: 'Küçük Prens', pages: 12, minutes: 15 }],
    finishedBooks: [],
    trees: [{ stage: 1, species: 'oak' }],
    ...over,
  };
}
