import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { addDays, formatDay, formatMinutes, formatShort, toLocalDate, weekStart } from '../lib/date';
import { useGame } from '../lib/GameContext';
import { applyTemplate, TEMPLATES, WEEKDAYS, weekDates } from '../lib/plan';
import type { Course, FamilySettings, NewPlanItem } from '../lib/types';

const STEP = 5;
const MAX = 120;

/**
 * Haftalık plan: gün seç, derslere dakika ayır, şablon uygula ya da geçen haftayı kopyala.
 * Geçmiş günler değiştirilemez. Aile onayı açıksa kaydedilen plan onay bekler.
 */
export default function WeekPlan({ courses, goToday, goCourses }: { courses: Course[]; goToday: () => void; goCourses: () => void }) {
  const api = useApi();
  const game = useGame();
  const today = toLocalDate();
  const [monday, setMonday] = useState(weekStart(today));
  const [items, setItems] = useState<NewPlanItem[] | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [pendingSaved, setPendingSaved] = useState(false);
  const [day, setDay] = useState(today);
  const [family, setFamily] = useState<FamilySettings | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');

  const days = weekDates(monday);
  const sunday = days[6];
  const isThisWeek = monday === weekStart(today);

  useEffect(() => {
    api.getFamily().then(setFamily).catch(() => setFamily(null));
  }, [api]);

  useEffect(() => {
    setItems(null);
    api
      .listPlans(monday, sunday)
      .then((rows) => {
        const list = rows.map(({ date, course_id, minutes, note }) => ({ date, course_id, minutes, note }));
        setItems(list);
        setSaved(JSON.stringify(list));
        setPendingSaved(rows.some((r) => !r.approved));
      })
      .catch((e) => {
        setError((e as Error).message);
        setItems([]);
      });
    setDay(days.includes(today) ? today : monday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, monday]);

  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  if (!items) return <div className="splash">Yükleniyor…</div>;

  const dirty = JSON.stringify(items) !== saved;
  const editable = (d: string) => d >= today;
  const dayItems = items.filter((i) => i.date === day);
  const dayTotal = (d: string) => items.filter((i) => i.date === d).reduce((s, i) => s + i.minutes, 0);
  const weekTotal = items.reduce((s, i) => s + i.minutes, 0);
  const missing = courses.filter((c) => !dayItems.some((i) => i.course_id === c.id));

  const change = (next: NewPlanItem[]) => {
    setItems(next);
    setStatus('idle');
  };
  const setMinutes = (courseId: string, minutes: number) =>
    change(
      minutes <= 0
        ? items.filter((i) => !(i.date === day && i.course_id === courseId))
        : items.map((i) => (i.date === day && i.course_id === courseId ? { ...i, minutes } : i)),
    );
  /** Geçmiş günlere dokunmadan haftayı değiştirir */
  const replaceFuture = (fresh: NewPlanItem[]) =>
    change([...items.filter((i) => !editable(i.date)), ...fresh.filter((i) => editable(i.date))]);

  const save = async () => {
    setStatus('saving');
    try {
      const approved = !family?.require_plan_approval;
      // Yalnızca bugün ve sonrası yeniden yazılır; geçmiş günlerin planı (ve onayı) olduğu gibi kalır
      const from = monday > today ? monday : today;
      if (from <= sunday) await api.savePlans(from, sunday, items.filter((i) => i.date >= from), approved);
      setSaved(JSON.stringify(items));
      setPendingSaved(!approved);
      setStatus('saved');
      game.refresh();
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  return (
    <div className="stack">
      <header className="forest-head">
        <button className="icon-btn" aria-label="Önceki hafta" onClick={() => setMonday(addDays(monday, -7))}>
          ‹
        </button>
        <div className="center grow">
          <h1>{isThisWeek ? 'Bu hafta' : monday > today ? 'Gelecek hafta' : 'Geçmiş hafta'}</h1>
          <div className="muted small">
            {formatShort(monday)} – {formatShort(sunday)} · toplam {formatMinutes(weekTotal)}
          </div>
        </div>
        <button className="icon-btn" aria-label="Sonraki hafta" disabled={monday > addDays(today, 21)} onClick={() => setMonday(addDays(monday, 7))}>
          ›
        </button>
      </header>

      {courses.length === 0 && (
        <div className="card">
          <p className="muted">Plan yapmak için önce ders eklemelisin.</p>
          <button className="btn" onClick={goCourses}>
            Derslere git
          </button>
        </div>
      )}

      <section className="card week-strip" data-tour="weekplan">
        <div className="week-days">
          {days.map((d, i) => {
            const tot = dayTotal(d);
            return (
              <button
                key={d}
                className={`wd${d === day ? ' on' : ''}${d < today ? ' past' : ''}`}
                aria-pressed={d === day}
                aria-label={`${formatDay(d)}: ${tot ? formatMinutes(tot) : 'plan yok'}`}
                onClick={() => setDay(d)}
              >
                <span className="wd-name">{WEEKDAYS[i]}</span>
                <strong>{tot || '—'}</strong>
                <span className={`wd-dot${d === today ? ' today' : ''}`} />
              </button>
            );
          })}
        </div>
        <p className="muted small center">Sayılar dakika · yeşil nokta bugün</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{d1(day, today)}</h2>
          <span className="muted small">
            {formatMinutes(dayTotal(day))} · {dayItems.length} ders
          </span>
        </div>
        {!editable(day) && <p className="muted small">Geçmiş bir gün; planı değiştirilemez.</p>}
        {dayItems.length === 0 && editable(day) && <p className="muted">Bu gün için plan yok. Aşağıdan ders ekle ya da dinlenme günü olsun.</p>}
        <ul className="list">
          {dayItems.map((i) => {
            const c = byId.get(i.course_id);
            return (
              <li key={i.course_id} className="row">
                <span className="dot lg" style={{ background: c?.color ?? '#999' }} />
                <div className="grow">
                  <div>{c?.name ?? 'Silinmiş ders'}</div>
                  {editable(day) ? (
                    <input
                      className="plan-note"
                      value={i.note ?? ''}
                      maxLength={120}
                      placeholder="Konu (istersen)"
                      aria-label={`${c?.name ?? 'Ders'} konusu`}
                      onChange={(e) =>
                        change(items.map((x) => (x.date === day && x.course_id === i.course_id ? { ...x, note: e.target.value || null } : x)))
                      }
                    />
                  ) : (
                    i.note && <div className="muted small">{i.note}</div>
                  )}
                </div>
                {editable(day) ? (
                  <div className="stepper">
                    <button aria-label={`${STEP} dakika azalt`} onClick={() => setMinutes(i.course_id, i.minutes - STEP)}>
                      −
                    </button>
                    <strong className="tabular">{i.minutes}</strong>
                    <button aria-label={`${STEP} dakika artır`} disabled={i.minutes >= MAX} onClick={() => setMinutes(i.course_id, i.minutes + STEP)}>
                      +
                    </button>
                  </div>
                ) : (
                  <strong className="nowrap">{formatMinutes(i.minutes)}</strong>
                )}
              </li>
            );
          })}
        </ul>
        {editable(day) && missing.length > 0 && (
          <div className="inline-form">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Eklenecek ders">
              <option value="">Ders seç…</option>
              {missing.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!adding}
              onClick={() => {
                change([...items, { date: day, course_id: adding, minutes: 20, note: null }]);
                setAdding('');
              }}
            >
              + Ekle
            </button>
          </div>
        )}
      </section>

      {days.some(editable) && (
        <section className="card">
          <h2>Hazır şablonlar</h2>
          <p className="muted small">Bugünden itibaren haftanın planını değiştirir. Ders sırası Dersler sekmesindeki sıradır.</p>
          <div className="chips">
            {TEMPLATES.map((tp) => (
              <button key={tp.id} className="chip-btn" title={tp.desc} onClick={() => replaceFuture(applyTemplate(tp, monday, courses))}>
                {tp.name}
              </button>
            ))}
          </div>
          <button
            className="btn full copy-btn"
            onClick={async () => {
              const prev = await api.listPlans(addDays(monday, -7), addDays(monday, -1));
              replaceFuture(prev.map((p) => ({ date: addDays(p.date, 7), course_id: p.course_id, minutes: p.minutes, note: p.note })));
            }}
          >
            Geçen haftayı kopyala
          </button>
        </section>
      )}

      {family?.require_plan_approval && (
        <div className="note-box">
          <strong>Aile onayı açık:</strong> kaydettiğin plan, annen ya da baban Aile panelinden onaylayana kadar "onay bekliyor" görünür.
        </div>
      )}
      {pendingSaved && !dirty && <div className="note-box">Bu haftanın planı aile onayı bekliyor.</div>}
      {status === 'error' && <div className="error">{error}</div>}

      {days.some(editable) && (
        <div className="actions">
          <span className="muted small">{status === 'saved' && !dirty ? 'Kaydedildi ✓' : dirty ? 'Kaydedilmemiş değişiklik var' : ''}</span>
          {status === 'saved' && !dirty && isThisWeek && (
            <button className="btn ghost" onClick={goToday}>
              Bugüne dön
            </button>
          )}
          <button className="btn primary big" disabled={!dirty || status === 'saving'} onClick={save}>
            Planı kaydet
          </button>
        </div>
      )}
    </div>
  );
}

function d1(day: string, today: string) {
  if (day === today) return 'Bugün';
  if (day === addDays(today, 1)) return 'Yarın';
  return formatDay(day);
}
