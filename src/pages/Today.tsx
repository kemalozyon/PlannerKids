import ConfirmButton from '../components/ConfirmButton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { formatDay, formatMinutes, toLocalDate } from '../lib/date';
import type { Course, ParentNote, PlanItem, Reflection, Reward, StudyLog, Task } from '../lib/types';
import { formatClock, useBreak } from '../lib/useTimer';
import { useSession, type SessionApi } from '../lib/SessionContext';
import { noteProblem } from '../lib/session';
import FocusMode from '../components/FocusMode';
import { dayPlan } from '../lib/plan';
import { openRewards } from '../lib/rewards';
import { useReading } from '../lib/ReadingContext';
import { useGame } from '../lib/GameContext';
import GameStrip from '../components/GameStrip';
import Quests from '../components/Quests';
import ReadingStrip from '../components/ReadingStrip';
import EndDay from '../components/EndDay';
import { MOODS, dailyPrompt } from '../lib/mood';
import { CORE_SUBJECTS } from '../lib/presets';
import { CFG } from '../lib/config';
import { paidTasks } from '../lib/economy';
import { startTour, TOUR_KEY } from '../lib/tour';

interface Props {
  courses: Course[];
  goCourses: () => void;
  goProfile: () => void;
  goForest: () => void;
  goGarden: () => void;
  goPlan: () => void;
  goRewards: () => void;
  goShop: () => void;
  reloadCourses: () => void;
  goLibrary: () => void;
  demo: boolean;
}

export default function Today({ courses, goCourses, goProfile, goForest, goGarden, goPlan, goRewards, goShop, reloadCourses, goLibrary, demo }: Props) {
  const api = useApi();
  const game = useGame();
  const [date, setDate] = useState(toLocalDate);
  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ses = useSession();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [focusOpen, setFocusOpen] = useState(false);
  /** "Bitirdim"e basıldı: seans duraklatıldı, not ve ders bekleniyor */
  const [finishing, setFinishing] = useState(false);

  // Gece yarısı geçerse "bugün" güncellensin
  useEffect(() => {
    const id = setInterval(() => setDate((d) => (d === toLocalDate() ? d : toLocalDate())), 30_000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [l, tk, p] = await Promise.all([
        api.listLogs(date, date),
        api.listTasks(date),
        api.listPlans(date, date).catch(() => [] as PlanItem[]),
      ]);
      setLogs(l);
      setTasks(tk);
      setPlans(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, date]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Veri değişince hem listeyi hem oyun durumunu yenile (kutlamalar buradan tetiklenir)
  const changed = useCallback(async () => {
    await Promise.all([reload(), game.refresh()]);
  }, [reload, game]);

  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const total = logs.reduce((s, l) => s + l.duration_minutes, 0);
  const plan = useMemo(() => dayPlan(date, plans, logs), [date, plans, logs]);

  // Seçili ders silindiyse ilk derse dön
  useEffect(() => {
    if (courses.length && !courses.some((c) => c.id === courseId)) setCourseId(courses[0].id);
  }, [courses, courseId]);

  const startTimer = async (cid: string, goalMin: number | null) => {
    setCourseId(cid);
    setError(null);
    try {
      await ses.start(cid, goalMin);
      setFocusOpen(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Seansı bırak: kaydedilmez */
  const abandon = async () => {
    setFocusOpen(false);
    setFinishing(false);
    try {
      await ses.abandon();
    } catch (e) {
      setError((e as Error).message);
    }
    game.refresh();
  };
  /** "Bitirdim": süre durur, not ve ders sorulur */
  const finish = async () => {
    setFocusOpen(false);
    if (ses.session) setCourseId(ses.session.course_id);
    setFinishing(true);
    if (ses.running) await ses.pause('manual').catch((e) => setError((e as Error).message));
  };

  if (courses.length === 0) {
    return (
      <div className="card empty">
        <div className="empty-tree" aria-hidden>
          🌱
        </div>
        <h2>Hoş geldin! 🌱</h2>
        <p className="muted">Çalıştığın her gün bahçene bir ağaç dikilir; dünyan çalıştıkça büyür. Önce derslerini ekleyelim.</p>
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
      <header className="day-head" data-tour="today">
        <div>
          <h1>Bugün</h1>
          <p className="muted">{formatDay(date)}</p>
        </div>
      </header>

      <TourCard />

      <ParentNoteCard />

      <GameStrip goForest={goForest} goGarden={goGarden} />

      {error && <div className="error">{error}</div>}

      <PlanCard
        plan={plan}
        byId={byId}
        running={!!ses.session}
        onStart={(cid, left) => startTimer(cid, Math.min(left, 40))}
        goPlan={goPlan}
      />

      <TimerCard
        courses={courses}
        date={date}
        ses={ses}
        courseId={courseId}
        setCourseId={setCourseId}
        fromPlan={!!plan?.rows.some((r) => r.item.course_id === courseId && !r.complete)}
        finishing={finishing}
        setFinishing={setFinishing}
        onStart={(cid) => startTimer(cid, 25)}
        onFinish={finish}
        onCancel={abandon}
        openFocus={() => setFocusOpen(true)}
        nextFromPlan={plan?.rows.find((r) => !r.complete)}
        onSaved={changed}
        onError={setError}
      />

      {focusOpen && ses.session && (
        <FocusMode
          ses={ses}
          course={byId.get(ses.session.course_id)}
          roundsToday={logs.length}
          onFinish={finish}
          onCancel={abandon}
          onClose={() => setFocusOpen(false)}
        />
      )}

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

      <Quests goShop={goShop} />

      <ReadingStrip goLibrary={goLibrary} />

      <RewardStrip goRewards={goRewards} />

      <TasksCard courses={courses} byId={byId} date={date} tasks={tasks} reload={changed} />

      <ReflectionCard date={date} />

      <EndDay goForest={goForest} goSettings={goProfile} demo={demo} />
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
  ses,
  courseId,
  setCourseId,
  fromPlan,
  finishing,
  setFinishing,
  onStart,
  onFinish,
  onCancel,
  openFocus,
  nextFromPlan,
  onSaved,
  onError,
}: {
  courses: Course[];
  date: string;
  ses: SessionApi;
  courseId: string;
  setCourseId: (id: string) => void;
  fromPlan: boolean;
  finishing: boolean;
  setFinishing: (v: boolean) => void;
  onStart: (courseId: string) => void;
  onFinish: () => void;
  onCancel: () => void;
  openFocus: () => void;
  nextFromPlan?: { item: PlanItem; left: number };
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const api = useApi();
  const { session, elapsedMs } = ses;
  const brk = useBreak();
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const current = session && courses.find((c) => c.id === session.course_id);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Seans sonu: süreyi sunucu hesapladı; ders ve "ne çalıştın?" notu zorunlu
  if (session && finishing) {
    const mins = Math.floor(elapsedMs / 60_000);
    const goal = ses.goalMin;
    const save = () =>
      run(async () => {
        const bad = noteProblem(note);
        if (bad) {
          setNoteError(bad);
          return;
        }
        await ses.finish(courseId, note.trim());
        setNote('');
        setNoteError(null);
        setFinishing(false);
        if (goal != null) brk.start(5);
        onSaved();
      });
    return (
      <section className="card finish-card" data-tour="timer">
        <h2>Aferin! Kaydedelim mi? 🎉</h2>
        <p className="finish-time">
          <span className="clock sm">{formatClock(elapsedMs)}</span>
          <span className="muted small">{mins >= 1 ? `${formatMinutes(mins)} kaydedilecek` : 'En az 1 dakika çalışınca kaydedebilirsin'}</span>
        </p>
        <label className="field">
          <span>Hangi derse çalıştın?</span>
          <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
        </label>
        <label className="field">
          <span>Ne çalıştın?</span>
          <input
            value={note}
            maxLength={CFG.session.noteMax}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(null);
            }}
            placeholder="ör. Kesirler, 3. ünite"
            aria-invalid={!!noteError}
            autoFocus
          />
        </label>
        {noteError && <p className="error-ink small">{noteError}</p>}
        <div className="actions">
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setFinishing(false);
                await ses.resume();
              })
            }
          >
            Devam et
          </button>
          <button className="btn primary" disabled={busy || mins < 1} onClick={save}>
            {goal != null ? 'Kaydet, molaya çık' : 'Kaydet'}
          </button>
        </div>
      </section>
    );
  }

  if (session) {
    const paused = ses.paused;
    return (
      <section className={`card timer running${paused ? ' paused' : ''}`} style={{ borderColor: current?.color }} data-tour="timer">
        <div className="muted small">{paused ? pauseText(ses.pausedBy) : 'Çalışıyorsun, harika!'}</div>
        <div className="timer-course">
          <span className="dot" style={{ background: current?.color ?? '#999' }} />
          {current?.name ?? 'Ders'}
        </div>
        <div className="clock">{formatClock(elapsedMs)}</div>
        {!paused && elapsedMs >= 20 * 60_000 && (
          <div className="break-note">
            {Math.floor(elapsedMs / 60_000)} dakikadır çalışıyorsun. Bitirip kısa bir mola vermeye ne dersin? 🧃
          </div>
        )}
        <div className="actions center">
          <ConfirmButton className="btn ghost" confirmLabel="Kaydetmeden sil?" onConfirm={onCancel}>
            İptal
          </ConfirmButton>
          {paused ? (
            <button className="btn" disabled={busy} onClick={() => run(ses.resume)}>
              ▶ Devam et
            </button>
          ) : (
            <>
              <button className="btn ghost" disabled={busy} onClick={() => run(() => ses.pause('manual'))}>
                ⏸ Ara ver
              </button>
              <button className="btn" onClick={openFocus}>
                Odak modu
              </button>
            </>
          )}
          <button className="btn primary big" onClick={onFinish}>
            Bitirdim
          </button>
        </div>
      </section>
    );
  }

  if (brk.active) {
    const over = brk.leftMs === 0;
    const next = nextFromPlan && courses.find((c) => c.id === nextFromPlan.item.course_id);
    return (
      <section className="card timer break-card" data-tour="timer">
        <div className="muted small">{over ? 'Mola bitti!' : 'Mola zamanı · su iç, biraz esne 🧃'}</div>
        <div className="clock">{formatClock(brk.leftMs)}</div>
        {over && next && (
          <p>
            Sıradaki: <strong>{next.name}</strong> <span className="muted">· {formatMinutes(nextFromPlan!.left)} kaldı</span>
          </p>
        )}
        <div className="actions center">
          <button className="btn ghost" onClick={brk.end}>
            {over ? 'Kapat' : 'Molayı bitir'}
          </button>
          {over && next && (
            <button
              className="btn primary big"
              onClick={() => {
                brk.end();
                onStart(next.id);
              }}
            >
              ▶ {next.name}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="card" data-tour="timer">
      <div className="tabs">
        <button className={mode === 'timer' ? 'on' : ''} onClick={() => setMode('timer')}>
          ⏱️ Süre tut
        </button>
        <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
          ✏️ Süre yaz
        </button>
      </div>
      <label className="field">
        <span>
          Ders{fromPlan && <span className="accent-ink"> · plandan</span>}
        </span>
        <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
      </label>
      {mode === 'timer' ? (
        <>
          <button className="btn primary big full" onClick={() => onStart(courseId)}>
            ▶ Başlat
          </button>
          <p className="muted small center">Sekmeden çıkınca ya da uzun süre dokunmayınca sayaç durur. Sayaçla çalışınca %{Math.round(CFG.elmas.live.bonus * 100)} canlı bonus 💎 ve seri kazanırsın.</p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const m = Number(minutes);
            const bad = noteProblem(note);
            if (bad) {
              setNoteError(bad);
              return;
            }
            if (m > 0 && m <= 1440)
              run(async () => {
                await api.addLog({ course_id: courseId, date, duration_minutes: Math.round(m), note: note.trim() });
                setNote('');
                setMinutes('');
                onSaved();
              });
          }}
        >
          <p className="manual-note small">
            ✏️ Elle yazılan süre kaydına, raporuna ve ağacına geçer; günde en çok {CFG.elmas.manual.capPerDay} 💎 verir. Seri, sandık ve canlı bonus yalnızca sayaçla.
          </p>
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
            <span>Ne çalıştın?</span>
            <input
              value={note}
              maxLength={CFG.session.noteMax}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              placeholder="ör. Kesirler, 3. ünite"
            />
          </label>
          {noteError && <p className="error-ink small">{noteError}</p>}
          <button className="btn primary full" disabled={busy}>
            Kaydet
          </button>
        </form>
      )}
    </section>
  );
}

/** Duraklatılmış seansın açıklaması */
function pauseText(r: SessionApi['pausedBy']): string {
  switch (r) {
    case 'hidden':
      return 'Sekmeden çıktın, sayaç durdu ⏸';
    case 'idle':
      return 'Uzun süre dokunulmadı, sayaç durdu ⏸';
    case 'game':
      return 'Oyuna geçtin, sayaç durdu ⏸';
    case 'lapsed':
      return 'Bağlantı koptu ya da ekran kapandı, sayaç durdu ⏸';
    default:
      return 'Ara verdin ⏸';
  }
}

/** Bugünün planı: ders başına planlanan / çalışılan dakika, sıradakini tek dokunuşla başlatma. */
function PlanCard({
  plan,
  byId,
  running,
  onStart,
  goPlan,
}: {
  plan: ReturnType<typeof dayPlan>;
  byId: Map<string, Course>;
  running: boolean;
  onStart: (courseId: string, left: number) => void;
  goPlan: () => void;
}) {
  if (!plan) {
    return (
      <section className="card plan-card empty-plan" data-tour="plan">
        <div className="grow">
          <h2>Bugünün planı</h2>
          <p className="muted small">Bugün için plan yok. Ne kadar çalışacağını önceden seçmek işini kolaylaştırır.</p>
        </div>
        <button className="btn" onClick={goPlan}>
          Plan yap
        </button>
      </section>
    );
  }
  const pct = plan.planned ? plan.done / plan.planned : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  const left = plan.rows.filter((r) => !r.complete).length;
  return (
    <section className="card plan-card" data-tour="plan">
      <div className="card-head">
        <h2>Bugünün planı</h2>
        {plan.pending && <span className="pill">Aile onayı bekliyor</span>}
      </div>
      <div className="plan-summary">
        <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Planın yüzde ${Math.round(pct * 100)}'i tamam`}>
          <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="var(--good)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, pct) * C} ${C}`}
            transform="rotate(-90 32 32)"
          />
          <text x="32" y="37" textAnchor="middle" className="plan-pct">
            %{Math.round(pct * 100)}
          </text>
        </svg>
        <div>
          <strong>
            {plan.done} / {plan.planned} dk tamam
          </strong>
          <div className="muted small">
            {plan.complete ? 'Bugünün planını bitirdin! 📋' : `${left} ders kaldı · bitirince "Planlı Gün" rozeti`}
          </div>
        </div>
      </div>
      <ul className="list">
        {plan.rows.map((r) => {
          const c = byId.get(r.item.course_id);
          const color = c?.color ?? '#999';
          return (
            <li key={r.item.id} className="row plan-row">
              <span className={`plan-check${r.complete ? ' done' : ''}`} style={r.complete ? undefined : { borderColor: color }} aria-hidden>
                {r.complete ? '✓' : ''}
              </span>
              <div className="grow">
                <div className={r.complete ? 'done' : ''}>{c?.name ?? 'Silinmiş ders'}</div>
                {!r.complete && r.done > 0 && (
                  <div className="pbar" aria-hidden>
                    <span style={{ width: `${(r.done / r.item.minutes) * 100}%`, background: color }} />
                  </div>
                )}
                <div className="muted small">
                  {Math.min(r.done, r.item.minutes)} / {r.item.minutes} dk{r.item.note ? ` · ${r.item.note}` : ''}
                </div>
              </div>
              {r.complete ? (
                <span className="good-ink small">Bitti</span>
              ) : (
                <button
                  className={`btn sm${r.done > 0 ? ' primary' : ''}`}
                  disabled={running}
                  onClick={() => onStart(r.item.course_id, r.left)}
                >
                  {r.done > 0 ? 'Devam et' : 'Başlat'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button className="link plan-link" onClick={goPlan}>
        Haftalık planı aç
      </button>
    </section>
  );
}

/** İlk girişte tanıtım turu daveti (bir kez; Profil'den yeniden açılır) */
function TourCard() {
  const [seen, setSeen] = useState(() => {
    try {
      return !!localStorage.getItem(TOUR_KEY);
    } catch {
      return true;
    }
  });
  if (seen) return null;
  const close = () => {
    try {
      localStorage.setItem(TOUR_KEY, 'seen');
    } catch {
      /* yok say */
    }
    setSeen(true);
  };
  return (
    <section className="card tour-card">
      <span className="tour-card-icon" aria-hidden>
        👋
      </span>
      <div className="grow">
        <strong>Hoş geldin! Dünyanı tanıyalım mı?</strong>
        <p className="muted small">5 dakikalık sesli bir tur: plan, sayaç, Elmas, görevler, odaların ve eşyaların, Bahçem, kitaplık, karakterin ve aile paneli.</p>
        <div className="note-actions">
          <button
            className="btn primary sm"
            onClick={() => {
              close();
              startTour('audio');
            }}
          >
            Demoyu başlat 🔊
          </button>
          <button
            className="btn sm"
            onClick={() => {
              close();
              startTour('text');
            }}
          >
            Sessiz izle
          </button>
          <button className="btn ghost sm" onClick={close}>
            Sonra
          </button>
        </div>
      </div>
    </section>
  );
}

/** Aileden gelen son not (son 3 gün). Çocuk "teşekkürler" ya da "kalp" ile yanıt verir. */
function ParentNoteCard() {
  const api = useApi();
  const [note, setNote] = useState<ParentNote | null>(null);
  useEffect(() => {
    api
      .listNotes(1)
      .then(([n]) => setNote(n && Date.now() - new Date(n.created_at).getTime() < 3 * 864e5 ? n : null))
      .catch(() => setNote(null));
  }, [api]);
  if (!note) return null;
  const react = async (reaction: 'thanks' | 'heart') => {
    await api.reactNote(note.id, reaction);
    setNote({ ...note, reaction });
  };
  return (
    <section className="card note-card">
      <span className="note-icon" aria-hidden>
        💌
      </span>
      <div className="grow">
        <strong>Ailenden bir not</strong>
        <p className="note-text">{note.text}</p>
        {note.reaction ? (
          <span className="muted small">{note.reaction === 'heart' ? 'Kalp gönderdin ❤️' : 'Teşekkür ettin 🙏'}</span>
        ) : (
          <div className="note-actions">
            <button className="btn sm" onClick={() => react('thanks')}>
              Teşekkürler! 🙏
            </button>
            <button className="btn sm" onClick={() => react('heart')}>
              Kalp gönder ❤️
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Sıradaki ödül hedefi (varsa) ince bir şerit olarak. */
function RewardStrip({ goRewards }: { goRewards: () => void }) {
  const api = useApi();
  const { stats } = useGame();
  const reading = useReading();
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  useEffect(() => {
    api.listRewards().then(setRewards).catch(() => setRewards([]));
  }, [api]);
  if (!stats || !rewards) return null;
  const [top] = openRewards(rewards, { dayTotals: stats.dayTotals, streak: stats.streak, books: reading.books, planDays: stats.planDays });
  if (!top) return null;
  return (
    <button className="card reward-strip" onClick={goRewards}>
      <span className="reward-icon" aria-hidden>
        🎁
      </span>
      <span className="grow">
        <span className="muted small">{top.reached ? 'Ödülünü kazandın!' : 'Sıradaki ödül'}</span>
        <strong>{top.reward.title}</strong>
        <span className="pbar gold" aria-hidden>
          <span style={{ width: `${top.pct * 100}%` }} />
        </span>
      </span>
      <span className="muted small nowrap">{top.reached ? 'Ailene göster' : `%${Math.round(top.pct * 100)}`}</span>
    </button>
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
  // Elmas veren aile görevleri: günün ilk perDay aile görevi (bitince); sıralama economy.ts → paidTasks ile aynı
  const paidIds = useMemo(
    () => new Set(paidTasks(tasks.map((t) => ({ ...t, done: true })), date).map((t) => t.id)),
    [tasks, date],
  );

  return (
    <section className="card" data-tour="tasks">
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
          const paid = t.from_parent && paidIds.has(t.id);
          return (
            <li key={t.id} className={`row${t.from_parent ? ' parent-task' : ''}`}>
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
              {t.from_parent && (
                <span className="tag parent" title="Ailenin verdiği görev">
                  🏠 {paid ? `Aileden · +${CFG.elmas.task.each} 💎` : 'Aileden'}
                </span>
              )}
              {c && (
                <span className="tag" style={{ color: c.color, borderColor: c.color }}>
                  {c.name}
                </span>
              )}
              {!t.from_parent && (
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
              )}
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
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    api.getReflection(date).then((r) => {
      setSaved(r);
      setRating(r?.rating ?? null);
      setNote(r?.note ?? '');
    });
  }, [api, date]);

  const dirty = rating !== (saved?.rating ?? null) || note !== (saved?.note ?? '');

  return (
    <section className="card reflection" data-tour="reflection">
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
        <span className={status === 'error' ? 'error-ink small' : 'muted small'}>
          {status === 'saved' && !dirty ? 'Kaydedildi ✓' : status === 'error' ? 'Kaydedilemedi, tekrar dene.' : ''}
        </span>
        <button
          className="btn primary"
          disabled={!dirty || status === 'saving'}
          onClick={async () => {
            setStatus('saving');
            try {
              await api.upsertReflection(date, rating, note);
              game.refresh();
              setSaved({ date, rating, note, updated_at: new Date().toISOString() });
              setStatus('saved');
            } catch {
              setStatus('error');
            }
          }}
        >
          {saved ? 'Güncelle' : 'Kaydet'}
        </button>
      </div>
    </section>
  );
}
