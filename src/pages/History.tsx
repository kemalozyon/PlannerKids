import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { MOODS, moodFace } from '../lib/mood';
import { addDays, formatDay, formatMinutes, formatShort, toLocalDate, weekStart } from '../lib/date';
import type { Course, Reflection, StudyLog } from '../lib/types';

const DAYS = 28;

export default function History({ courses }: { courses: Course[] }) {
  const api = useApi();
  const today = toLocalDate();
  const from = addDays(today, -(DAYS - 1));
  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [refs, setRefs] = useState<Reflection[]>([]);
  const [week, setWeek] = useState(weekStart(today));
  const [weekLogs, setWeekLogs] = useState<StudyLog[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listLogs(from, today), api.listReflections(from, today)]).then(([l, r]) => {
      setLogs(l);
      setRefs(r);
    });
  }, [api, from, today]);

  useEffect(() => {
    api.listLogs(week, addDays(week, 6)).then(setWeekLogs);
  }, [api, week]);

  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const days = useMemo(() => {
    const out: { date: string; total: number; logs: StudyLog[]; ref?: Reflection }[] = [];
    for (let i = 0; i < DAYS; i++) {
      const d = addDays(today, -i);
      const dl = logs.filter((l) => l.date === d);
      const ref = refs.find((r) => r.date === d);
      if (dl.length || ref) out.push({ date: d, total: dl.reduce((s, l) => s + l.duration_minutes, 0), logs: dl, ref });
    }
    return out;
  }, [logs, refs, today]);

  const slices = useMemo(() => {
    const m = new Map<string, number>();
    weekLogs.forEach((l) => m.set(l.course_id, (m.get(l.course_id) ?? 0) + l.duration_minutes));
    return [...m.entries()]
      .map(([id, min]) => ({ id, min, course: byId.get(id) }))
      .sort((a, b) => b.min - a.min);
  }, [weekLogs, byId]);
  const weekTotal = slices.reduce((s, x) => s + x.min, 0);
  const isThisWeek = week === weekStart(today);

  return (
    <div className="stack">
      <h1>Geçmiş</h1>

      <section className="card">
        <div className="card-head">
          <button className="icon-btn" aria-label="Önceki hafta" onClick={() => setWeek(addDays(week, -7))}>
            ‹
          </button>
          <div className="center">
            <h2>{isThisWeek ? 'Bu hafta' : 'Haftalık dağılım'}</h2>
            <div className="muted small">
              {formatShort(week)} – {formatShort(addDays(week, 6))}
            </div>
          </div>
          <button
            className="icon-btn"
            aria-label="Sonraki hafta"
            disabled={isThisWeek}
            onClick={() => setWeek(addDays(week, 7))}
          >
            ›
          </button>
        </div>
        {weekTotal === 0 ? (
          <p className="muted center">Bu hafta kayıt yok.</p>
        ) : (
          <div className="pie-wrap">
            <Pie slices={slices.map((s) => ({ value: s.min, color: s.course?.color ?? '#999' }))} total={weekTotal} />
            <ul className="legend">
              {slices.map((s) => (
                <li key={s.id}>
                  <span className="dot" style={{ background: s.course?.color ?? '#999' }} />
                  <span className="grow">{s.course?.name ?? 'Silinmiş ders'}</span>
                  <strong className="nowrap">{formatMinutes(s.min)}</strong>
                  <span className="muted small pct">{Math.round((s.min / weekTotal) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Son {DAYS} gün</h2>
        {days.length === 0 ? (
          <p className="muted">Henüz kayıt yok.</p>
        ) : (
          <ul className="list days">
            {days.map((d) => (
              <li key={d.date}>
                <button className="day-row" onClick={() => setOpen(open === d.date ? null : d.date)}>
                  <span className="grow">{d.date === today ? 'Bugün' : formatDay(d.date)}</span>
                  <strong className="nowrap">{formatMinutes(d.total)}</strong>
                  <span className="score-face" title={d.ref?.rating ? MOODS[d.ref.rating - 1].label : 'Değerlendirme yok'}>{moodFace(d.ref?.rating) ?? '·'}</span>
                </button>
                {open === d.date && (
                  <div className="day-detail">
                    {d.logs.map((l) => (
                      <div key={l.id} className="row small">
                        <span className="dot" style={{ background: byId.get(l.course_id)?.color ?? '#999' }} />
                        <span className="grow">
                          {byId.get(l.course_id)?.name ?? 'Silinmiş ders'}
                          {l.note && <span className="muted"> — {l.note}</span>}
                        </span>
                        <span className="nowrap">{formatMinutes(l.duration_minutes)}</span>
                      </div>
                    ))}
                    {d.ref?.note && <blockquote>{d.ref.note}</blockquote>}
                    {!d.logs.length && !d.ref?.note && <p className="muted small">Detay yok.</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Pie({ slices, total }: { slices: { value: number; color: string }[]; total: number }) {
  const r = 70;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 180 180" className="pie" role="img" aria-label="Haftalık ders dağılımı">
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--line)" strokeWidth="28" />
      {slices.map((s, i) => {
        const len = (s.value / total) * C;
        const el = (
          <circle
            key={i}
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="28"
            strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 2 : 0))} ${C}`}
            strokeDashoffset={-acc}
            transform="rotate(-90 90 90)"
          />
        );
        acc += len;
        return el;
      })}
      <text x="90" y="86" textAnchor="middle" className="pie-total">
        {formatMinutes(total)}
      </text>
      <text x="90" y="106" textAnchor="middle" className="pie-sub">
        toplam
      </text>
    </svg>
  );
}
