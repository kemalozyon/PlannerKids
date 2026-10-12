import { useEffect, useMemo, useState } from 'react';
import DaySheet from '../components/DaySheet';
import Tree from '../components/Tree';
import { useApi } from '../lib/ApiContext';
import { useGame } from '../lib/GameContext';
import { MOODS } from '../lib/mood';
import { addDays, formatDay, formatMinutes, formatShort, parseLocalDate, toLocalDate, weekStart } from '../lib/date';
import { formatMonth, monthOf, shiftMonth } from '../lib/forest';
import { WEEKDAYS, weekDates } from '../lib/plan';
import type { Course, ForestTree, Reflection, StudyLog } from '../lib/types';

/** Isı haritası seviyeleri (dakika alt sınırı) */
const LEVELS = [0, 1, 60, 110, 150];

const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

/**
 * Geçmiş: aylık takvim (renk = çalışılan dakika, küçük ağaç = o güne dikilen ağaç, yüz = ruh hali),
 * güne dokununca o günün ağacı ve ilerlemesi açılır pencerede,
 * haftalık çubuk grafik (derslere göre yığılmış) ve ayın ders dağılımı.
 */
export default function History({ courses }: { courses: Course[] }) {
  const api = useApi();
  const { stats } = useGame();
  const today = toLocalDate();
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [logs, setLogs] = useState<StudyLog[] | null>(null);
  const [refs, setRefs] = useState<Reflection[]>([]);
  const [week, setWeek] = useState(weekStart(today));
  const [open, setOpen] = useState<string | null>(null);

  // Ayı ve kıyas için önceki ayı, haftalık grafik için de seçili haftayı kapsayan aralık
  const prevMonth = shiftMonth(month, -1);
  const from = [`${prevMonth}-01`, week].sort()[0];
  const to = [`${month}-${String(daysInMonth(month)).padStart(2, '0')}`, addDays(week, 6)].sort()[1];

  useEffect(() => {
    Promise.all([api.listLogs(from, to), api.listReflections(from, to)]).then(([l, r]) => {
      setLogs(l);
      setRefs(r);
    });
  }, [api, from, to]);

  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    logs?.forEach((l) => m.set(l.date, (m.get(l.date) ?? 0) + l.duration_minutes));
    return m;
  }, [logs]);

  if (!logs) return <div className="splash">Yükleniyor…</div>;

  const inMonth = (mo: string) => [...totals.entries()].filter(([d]) => monthOf(d) === mo && d <= today);
  const monthDays = inMonth(month);
  const monthTotal = monthDays.reduce((s, [, m]) => s + m, 0);
  // Bu ay sürüyorsa önceki ayın aynı dönemiyle kıyasla (1'i–bugünün günü)
  const cutoff = month === thisMonth ? today.slice(-2) : '31';
  const prevTotal = inMonth(prevMonth)
    .filter(([d]) => d.slice(-2) <= cutoff)
    .reduce((s, [, m]) => s + m, 0);
  const studiedDays = monthDays.filter(([, m]) => m > 0).length;
  const elapsedDays = month === thisMonth ? Number(today.slice(-2)) : daysInMonth(month);
  const avg = studiedDays ? Math.round(monthTotal / studiedDays) : 0;
  const diff = monthTotal - prevTotal;

  // Takvim: pazartesiden başlar
  const first = `${month}-01`;
  const lead = (parseLocalDate(first).getDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth(month) }, (_, i) => addDays(first, i))];
  const refOf = (d: string) => refs.find((r) => r.date === d);
  const level = (min: number) => LEVELS.filter((x) => min >= x).length - 1;

  // Ayın ders dağılımı
  const subj = new Map<string, number>();
  logs.filter((l) => monthOf(l.date) === month).forEach((l) => subj.set(l.course_id, (subj.get(l.course_id) ?? 0) + l.duration_minutes));
  const subjects = [...subj.entries()].sort((a, b) => b[1] - a[1]);
  const maxSubj = subjects[0]?.[1] ?? 1;

  // Hafta grafiği
  const wdays = weekDates(week);
  const weekLogs = logs.filter((l) => l.date >= week && l.date <= wdays[6]);
  const weekTotal = weekLogs.reduce((s, l) => s + l.duration_minutes, 0);
  const maxDay = Math.max(60, ...wdays.map((d) => totals.get(d) ?? 0));
  const isThisWeek = week === weekStart(today);

  // Günde tek ağaç; eski verilerde birden çoksa en büyüğü
  const treeOf = (d: string) =>
    (stats?.trees ?? []).filter((t) => t.date === d).reduce<ForestTree | null>((b, t) => (!b || t.stage > b.stage ? t : b), null);

  return (
    <div className="stack">
      <h1>Geçmiş</h1>

      <div className="tiles">
        <div className="tile">
          <span className="muted small">{month === thisMonth ? 'Bu ay' : formatMonth(month)}</span>
          <strong>{formatMinutes(monthTotal)}</strong>
          <span className={`small ${diff >= 0 ? 'good-ink' : 'muted'}`}>
            {prevTotal ? `${diff >= 0 ? '+' : '−'}${formatMinutes(Math.abs(diff))} geçen aya göre` : 'geçen ay kayıt yok'}
          </span>
        </div>
        <div className="tile">
          <span className="muted small">Çalışılan gün</span>
          <strong>
            {studiedDays} / {elapsedDays}
          </strong>
          <span className="muted small">{formatMonth(month).split(' ')[0]}</span>
        </div>
        <div className="tile">
          <span className="muted small">Günlük ort.</span>
          <strong>{formatMinutes(avg)}</strong>
          <span className="muted small">çalıştığın günler</span>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <button className="icon-btn" aria-label="Önceki ay" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <h2>{formatMonth(month)}</h2>
          <button className="icon-btn" aria-label="Sonraki ay" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <div className="cal-grid cal-head" aria-hidden>
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (!d) return <span key={`x${i}`} />;
            const min = totals.get(d) ?? 0;
            const r = refOf(d);
            const tree = treeOf(d);
            const future = d > today;
            return (
              <button
                key={d}
                className={`cal-day lv${future ? 'f' : level(min)}${d === today ? ' today' : ''}${d === open ? ' sel' : ''}`}
                disabled={future}
                aria-pressed={d === open}
                aria-label={`${formatDay(d)}: ${formatMinutes(min)}${tree ? ', ağaç dikildi' : ''}${r?.rating ? `, ${MOODS[r.rating - 1].label}` : ''}`}
                onClick={() => setOpen(open === d ? null : d)}
              >
                <span>{Number(d.slice(-2))}</span>
                <span className="cal-mood" aria-hidden>
                  {tree && <Tree species={tree.species} stage={tree.stage} size={14} />}
                  {r?.rating ? MOODS[r.rating - 1].face : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="cal-legend">
          <span>Az</span>
          {[1, 2, 3, 4].map((l) => (
            <span key={l} className={`cal-swatch lv${l}`} />
          ))}
          <span>Çok</span>
        </div>
        <p className="muted small">Bir güne dokun: o günün ağacı, dersleri ve notu açılır.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <button className="icon-btn" aria-label="Önceki hafta" onClick={() => setWeek(addDays(week, -7))}>
            ‹
          </button>
          <div className="center">
            <h2>{isThisWeek ? 'Bu hafta' : 'Hafta'}</h2>
            <div className="muted small">
              {formatShort(week)} – {formatShort(wdays[6])} · {formatMinutes(weekTotal)}
            </div>
          </div>
          <button className="icon-btn" aria-label="Sonraki hafta" disabled={isThisWeek} onClick={() => setWeek(addDays(week, 7))}>
            ›
          </button>
        </div>
        <div className="bars" role="img" aria-label={`Haftalık çalışma: ${wdays.map((d, i) => `${WEEKDAYS[i]} ${totals.get(d) ?? 0} dk`).join(', ')}`}>
          {wdays.map((d, i) => {
            const dayLogs = weekLogs.filter((l) => l.date === d);
            const tot = totals.get(d) ?? 0;
            const parts = new Map<string, number>();
            dayLogs.forEach((l) => parts.set(l.course_id, (parts.get(l.course_id) ?? 0) + l.duration_minutes));
            return (
              <div key={d} className="bar-col">
                <span className="bar-val">{tot || ''}</span>
                <div className="bar-stack" style={{ height: `${(tot / maxDay) * 100}%` }}>
                  {[...parts.entries()].map(([cid, m]) => (
                    <span key={cid} style={{ flex: m, background: byId.get(cid)?.color ?? '#999' }} />
                  ))}
                </div>
                <span className={`bar-label${d === today ? ' today' : ''}`}>{WEEKDAYS[i]}</span>
              </div>
            );
          })}
        </div>
        {weekTotal === 0 && <p className="muted center small">Bu hafta kayıt yok.</p>}
      </section>

      <section className="card">
        <h2>{month === thisMonth ? 'Bu ay' : formatMonth(month)} ders dağılımı</h2>
        {subjects.length === 0 ? (
          <p className="muted small">Bu ay kayıt yok.</p>
        ) : (
          subjects.map(([cid, m]) => (
            <div key={cid} className="subj">
              <div className="subj-head">
                <span>
                  <span className="dot" style={{ background: byId.get(cid)?.color ?? '#999' }} /> {byId.get(cid)?.name ?? 'Silinmiş ders'}
                </span>
                <strong>
                  {formatMinutes(m)} <span className="muted small">%{Math.round((m / monthTotal) * 100)}</span>
                </strong>
              </div>
              <div className="pbar">
                <span style={{ width: `${(m / maxSubj) * 100}%`, background: byId.get(cid)?.color ?? '#999' }} />
              </div>
            </div>
          ))
        )}
      </section>

      {open && (
        <DaySheet
          date={open}
          tree={treeOf(open)}
          minutes={stats?.dayTotals.get(open) ?? totals.get(open) ?? 0}
          courses={courses}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
