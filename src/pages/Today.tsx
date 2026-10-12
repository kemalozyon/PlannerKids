import ConfirmButton from '../components/ConfirmButton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { formatDay, formatMinutes, toLocalDate } from '../lib/date';
import type { Course, Reflection, StudyLog, Task } from '../lib/types';
import { formatClock, useTimer } from '../lib/useTimer';
import { useGame } from '../lib/GameContext';
import GameStrip from '../components/GameStrip';
import ReadingStrip from '../components/ReadingStrip';
import EndDay from '../components/EndDay';
import { MOODS, dailyPrompt } from '../lib/mood';
import { CORE_SUBJECTS } from '../lib/presets';
import Tree from '../components/Tree';

interface Props {
  courses: Course[];
  goCourses: () => void;
  goProfile: () => void;
  goForest: () => void;
  onPlant: () => void;
  reloadCourses: () => void;
  goLibrary: () => void;
  onPlantBook: (id: string) => void;
  demo: boolean;
}

export default function Today({ courses, goCourses, goProfile, goForest, onPlant, reloadCourses, goLibrary, onPlantBook, demo }: Props) {
  const api = useApi();
  const game = useGame();
  const [date, setDate] = useState(toLocalDate);
  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Gece yarısı geçerse "bugün" güncellensin
  useEffect(() => {
    const id = setInterval(() => setDate((d) => (d === toLocalDate() ? d : toLocalDate())), 30_000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [l, t] = await Promise.all([api.listLogs(date, date), api.listTasks(date)]);
      setLogs(l);
      setTasks(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, date]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Veri değişince hem listeyi hem oyun durumunu yenile (kutlamalar buradan tetiklenir)
  const changed = useCallback(async () => {
    await reload();
    await game.refresh();
  }, [reload, game]);

  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const total = logs.reduce((s, l) => s + l.duration_minutes, 0);

  if (courses.length === 0) {
    return (
      <div className="card empty">
        <Tree species="elma" stage={0} size={90} />
        <h2>Hoş geldin! 🌱</h2>
        <p className="muted">Her gün çalıştıkça bir bitki büyütüp kendi ormanına dikeceksin. Önce derslerini ekleyelim.</p>
        <div className="empty-actions">
          <button
            className="btn primary big"
            onClick={async () => {
              for (const c of CORE_SUBJECTS) await api.addCourse(c.name, c.color);
              reloadCourses();
            }}
          >
            Okul derslerimi ekle
          </button>
          <button className="btn ghost" onClick={goCourses}>
            Kendim seçeceğim
          </button>
        </div>
        <p className="muted small">{CORE_SUBJECTS.map((c) => c.name).join(', ')}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="day-head">
        <div>
          <h1>Bugün</h1>
          <p className="muted">{formatDay(date)}</p>
        </div>
      </header>

      <GameStrip goForest={goForest} onPlant={onPlant} />

      {error && <div className="error">{error}</div>}

      <TimerCard courses={courses} date={date} onSaved={changed} onError={setError} />

      <section className="card">
        <div className="card-head">
          <h2>Bugün çalıştıklarım</h2>
          {total > 0 && <strong className="tabular">{formatMinutes(total)}</strong>}
        </div>
        {logs.length === 0 ? (
          <p className="muted">Henüz bir şey yok. Hadi başlayalım!</p>
        ) : (
          <ul className="list">
            {logs.map((l) => {
              const c = byId.get(l.course_id);
              return (
                <li key={l.id} className="row">
                  <span className="dot" style={{ background: c?.color ?? '#999' }} />
                  <div className="grow">
                    <div>{c?.name ?? 'Silinmiş ders'}</div>
                    {l.note && <div className="muted small">{l.note}</div>}
                  </div>
                  <strong className="nowrap">{formatMinutes(l.duration_minutes)}</strong>
                  <button
                    className="icon-btn"
                    aria-label="Sil"
                    onClick={async () => {
                      await api.deleteLog(l.id);
                      changed();
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ReadingStrip goLibrary={goLibrary} onPlantBook={onPlantBook} />

      <TasksCard courses={courses} byId={byId} date={date} tasks={tasks} reload={changed} />

      <ReflectionCard date={date} />

      <EndDay goForest={onPlant} goSettings={goProfile} demo={demo} />
    </div>
  );
}

function CourseSelect({
  courses,
  value,
  onChange,
  allowNone,
}: {
  courses: Course[];
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Ders seçme</option>}
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function TimerCard({
  courses,
  date,
  onSaved,
  onError,
}: {
  courses: Course[];
  date: string;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const api = useApi();
  const { timer, elapsedMs, start, stop, cancel } = useTimer();
  const [courseId, setCourseId] = useState(courses[0].id);
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<{ courseId: string; minutes: number; date: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Seçili ders silindiyse ilk derse dön
  useEffect(() => {
    if (!courses.some((c) => c.id === courseId)) setCourseId(courses[0].id);
  }, [courses, courseId]);

  const running = timer && courses.find((c) => c.id === timer.courseId);

  const save = async (cid: string, mins: number, logDate: string) => {
    setBusy(true);
    try {
      await api.addLog({ course_id: cid, date: logDate, duration_minutes: mins, note: note.trim() || null });
      setNote('');
      setMinutes('');
      setPending(null);
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    const c = courses.find((x) => x.id === pending.courseId);
    return (
      <section className="card">
        <h2>Aferin! Kaydedelim mi? 🎉</h2>
        <p>
          <strong>{c?.name}</strong> · {formatMinutes(pending.minutes)}
        </p>
        <label className="field">
          <span>Kaç dakika?</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={pending.minutes}
            onChange={(e) => setPending({ ...pending, minutes: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label className="field">
          <span>Ne çalıştın? (istersen)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Kesirler, 3. ünite" />
        </label>
        <div className="actions">
          <button className="btn ghost" onClick={() => setPending(null)}>
            Vazgeç
          </button>
          <button className="btn primary" disabled={busy} onClick={() => save(pending.courseId, pending.minutes, pending.date)}>
            Kaydet
          </button>
        </div>
      </section>
    );
  }

  if (timer) {
    return (
      <section className="card timer running" style={{ borderColor: running?.color }}>
        <div className="muted small">Çalışıyorsun, harika!</div>
        <div className="timer-course">
          <span className="dot" style={{ background: running?.color ?? '#999' }} />
          {running?.name ?? 'Ders'}
        </div>
        <div className="clock">{formatClock(elapsedMs)}</div>
        {elapsedMs >= 20 * 60_000 && (
          <div className="break-note">
            {Math.floor(elapsedMs / 60_000)} dakikadır çalışıyorsun. Bitirip kısa bir mola vermeye ne dersin? 🧃
          </div>
        )}
        <div className="actions center">
          <ConfirmButton className="btn ghost" confirmLabel="Kaydetmeden sil?" onConfirm={cancel}>
            İptal
          </ConfirmButton>
          <button
            className="btn primary big"
            onClick={() => {
              const r = stop();
              if (r) setPending({ courseId: r.courseId, minutes: r.minutes, date: toLocalDate(new Date(r.startedAt)) });
            }}
          >
            Bitirdim
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="tabs">
        <button className={mode === 'timer' ? 'on' : ''} onClick={() => setMode('timer')}>
          ⏱️ Süre tut
        </button>
        <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
          ✏️ Süre yaz
        </button>
      </div>
      <label className="field">
        <span>Ders</span>
        <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
      </label>
      {mode === 'timer' ? (
        <button className="btn primary big full" onClick={() => start(courseId)}>
          ▶ Başlat
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const m = Number(minutes);
            if (m > 0 && m <= 1440) save(courseId, Math.round(m), date);
          }}
        >
          <label className="field">
            <span>Kaç dakika?</span>
            <input
              type="number"
              min={1}
              max={1440}
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="45"
            />
          </label>
          <label className="field">
            <span>Ne çalıştın? (istersen)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Kesirler, 3. ünite" />
          </label>
          <button className="btn primary full" disabled={busy}>
            Kaydet
          </button>
        </form>
      )}
    </section>
  );
}

function TasksCard({
  courses,
  byId,
  date,
  tasks,
  reload,
}: {
  courses: Course[];
  byId: Map<string, Course>;
  date: string;
  tasks: Task[];
  reload: () => void;
}) {
  const api = useApi();
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Yapılacaklar</h2>
        {tasks.length > 0 && (
          <span className="muted small">
            {doneCount}/{tasks.length}
          </span>
        )}
      </div>
      <ul className="list">
        {tasks.map((t) => {
          const c = t.course_id ? byId.get(t.course_id) : undefined;
          return (
            <li key={t.id} className="row">
              <label className="check grow">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={async (e) => {
                    await api.setTaskDone(t.id, e.target.checked);
                    reload();
                  }}
                />
                <span className={t.done ? 'done' : ''}>{t.title}</span>
              </label>
              {c && (
                <span className="tag" style={{ color: c.color, borderColor: c.color }}>
                  {c.name}
                </span>
              )}
              <button
                className="icon-btn"
                aria-label="Görevi sil"
                onClick={async () => {
                  await api.deleteTask(t.id);
                  reload();
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await api.addTask({ title: title.trim(), date, course_id: courseId || null });
          setTitle('');
          reload();
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni bir iş ekle…" />
        <CourseSelect courses={courses} value={courseId} onChange={setCourseId} allowNone />
        <button className="btn">Ekle</button>
      </form>
    </section>
  );
}

function ReflectionCard({ date }: { date: string }) {
  const api = useApi();
  const game = useGame();
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<Reflection | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    api.getReflection(date).then((r) => {
      setSaved(r);
      setRating(r?.rating ?? null);
      setNote(r?.note ?? '');
    });
  }, [api, date]);

  const dirty = rating !== (saved?.rating ?? null) || note !== (saved?.note ?? '');

  return (
    <section className="card reflection">
      <h2>Bugün nasıl geçti?</h2>
      <div className="moods" role="radiogroup" aria-label="Bugün nasıl geçti">
        {MOODS.map((m) => (
          <button
            key={m.value}
            role="radio"
            aria-checked={rating === m.value}
            aria-label={m.label}
            className={rating === m.value ? 'on' : ''}
            onClick={() => setRating(rating === m.value ? null : m.value)}
          >
            <span className="mood-face" aria-hidden>
              {m.face}
            </span>
            <span className="mood-label">{m.label}</span>
          </button>
        ))}
      </div>
      <label className="field prompt">
        <span>{dailyPrompt(date)} (istersen yaz)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Birkaç kelime yeter…" />
      </label>
      <div className="actions">
        <span className="muted small">{status === 'saved' && !dirty ? 'Kaydedildi ✓' : ''}</span>
        <button
          className="btn primary"
          disabled={!dirty || status === 'saving'}
          onClick={async () => {
            setStatus('saving');
            await api.upsertReflection(date, rating, note);
            game.refresh();
            setSaved({ date, rating, note, updated_at: new Date().toISOString() });
            setStatus('saved');
          }}
        >
          {saved ? 'Güncelle' : 'Kaydet'}
        </button>
      </div>
    </section>
  );
}
