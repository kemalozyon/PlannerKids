// Çalışma seansının istemci tarafı. Süreyi sunucu tutar (session.ts, 0009_sessions.sql); burası yalnızca
// gösterir ve sunucuya haber verir:
// - Sayaç açıkken dakikada bir "buradayım" (beat). Haber gitmezse sunucu süreyi kendisi durdurur.
// - Sekme gizlenince (Page Visibility API) seans duraklar; geri gelince "Devam et" çıkar.
// - Uzun süre dokunulmazsa "Hâlâ çalışıyor musun?" sorulur; cevap gelmezse seans, son dokunuştan itibaren
//   sayılmadan duraklatılır.
// Sekmeler arasında gezerken seans sürsün diye Shell düzeyinde tek bir örnek vardır.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from './ApiContext';
import { CFG } from './config';
import { toLocalDate } from './date';
import { shownMs, type SessionState, type StudySession } from './session';
import type { StudyLog } from './types';

const GOAL_KEY = 'ct-goal-v1';
const C = CFG.session;

/** Neden duraklatıldı: el ile, sekme gizlendi, hareketsizlik, oyun açıldı, sunucu (haber gitmedi) */
export type PauseReason = 'manual' | 'hidden' | 'idle' | 'game' | 'lapsed';

export interface SessionApi {
  session: StudySession | null;
  running: boolean;
  paused: boolean;
  pausedBy: PauseReason | null;
  /** Ekrandaki süre (ms) */
  elapsedMs: number;
  /** Odak turu uzunluğu (dk); null = serbest */
  goalMin: number | null;
  setGoal: (g: number | null) => void;
  /** Hareketsizlik sorusunun bitiş anı (ms); soru yoksa null */
  idleAsk: number | null;
  stillHere: () => void;
  start: (courseId: string, goalMin?: number | null) => Promise<void>;
  pause: (reason?: PauseReason) => Promise<void>;
  resume: () => Promise<void>;
  finish: (courseId: string, note: string) => Promise<StudyLog>;
  abandon: () => Promise<StudySession | null>;
  /** Saniyede bir değişir: sayaç gösteren bileşenler bunu kullanır */
  now: number;
}

const Ctx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider yok');
  return c;
}

function readGoal(id: string | undefined): number | null {
  try {
    const g = JSON.parse(localStorage.getItem(GOAL_KEY) ?? 'null') as { id: string; goal: number | null } | null;
    return g && g.id === id ? g.goal : null;
  } catch {
    return null;
  }
}

function writeGoal(id: string, goal: number | null) {
  try {
    localStorage.setItem(GOAL_KEY, JSON.stringify({ id, goal }));
  } catch {
    /* yok say */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [session, setSession] = useState<StudySession | null>(null);
  /** sunucu saati - istemci saati */
  const offset = useRef(0);
  const [pausedBy, setPausedBy] = useState<PauseReason | null>(null);
  const [goalMin, setGoalMin] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [idleAsk, setIdleAsk] = useState<number | null>(null);
  const lastActive = useRef(Date.now());
  const busy = useRef(false);

  const apply = useCallback((st: SessionState | null, reason?: PauseReason | null) => {
    if (!st) {
      setSession(null);
      setPausedBy(null);
      return;
    }
    offset.current = Date.parse(st.serverNow) - Date.now();
    setSession((prev) => {
      // Sunucu kendiliğinden duraklattıysa (haber gitmedi) nedenini göster
      if (prev?.status === 'running' && st.session.status === 'paused' && reason === undefined) setPausedBy('lapsed');
      return st.session;
    });
    if (reason !== undefined) setPausedBy(reason);
    setGoalMin(readGoal(st.session.id));
  }, []);

  // Açılışta (ve sekmeye dönünce) açık seansı sunucudan al
  const reload = useCallback(() => {
    api
      .getOpenSession()
      .then((st) => apply(st, st?.session.status === 'paused' ? undefined : null))
      .catch(() => {
        /* 0009 çalıştırılmadıysa seanssız devam */
      });
  }, [api, apply]);
  useEffect(reload, [reload]);

  const running = session?.status === 'running';
  const id = session?.id;

  // Saniye sayacı
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // "Buradayım"
  useEffect(() => {
    if (!running || !id) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.beatSession(id).then((st) => apply(st), () => {});
    }, C.beatSeconds * 1000);
    return () => clearInterval(t);
  }, [api, apply, running, id]);

  const pause = useCallback(
    async (reason: PauseReason = 'manual', backSec = 0) => {
      if (!id || busy.current) return;
      busy.current = true;
      try {
        apply(await api.pauseSession(id, backSec), reason);
      } finally {
        busy.current = false;
      }
    },
    [api, apply, id],
  );

  // Sekme gizlenince duraklat, görünür olunca sunucudan yenile
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (running) pause('hidden').catch(() => {});
      } else reload();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [running, pause, reload]);

  // Hareketsizlik: dokunma, tuş, kaydırma, fare hareketi
  useEffect(() => {
    let last = 0;
    const mark = () => {
      const t = Date.now();
      if (t - last < 1000) return;
      last = t;
      lastActive.current = t;
    };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
  }, []);

  const askRef = useRef<number | null>(null);
  const ask = (v: number | null) => {
    askRef.current = v;
    setIdleAsk(v);
  };
  useEffect(() => {
    if (!running) {
      ask(null);
      return;
    }
    lastActive.current = Math.max(lastActive.current, Date.now() - 1000);
    const t = setInterval(() => {
      const idleMs = Date.now() - lastActive.current;
      if (idleMs < C.idleMinutes * 60_000) {
        if (askRef.current != null) ask(null);
      } else if (askRef.current == null) {
        ask(Date.now() + C.idleAnswerSeconds * 1000);
      } else if (Date.now() >= askRef.current) {
        ask(null);
        // Cevap yok: son dokunuştan beri geçen süre sayılmaz
        pause('idle', idleMs / 1000).catch(() => {});
      }
    }, 1000);
    return () => clearInterval(t);
  }, [running, pause]);

  const stillHere = useCallback(() => {
    lastActive.current = Date.now();
    askRef.current = null;
    setIdleAsk(null);
  }, []);

  const start = useCallback(
    async (courseId: string, goal: number | null = null) => {
      const st = await api.startSession(courseId, toLocalDate());
      writeGoal(st.session.id, goal);
      lastActive.current = Date.now();
      apply(st, null);
      setNow(Date.now());
    },
    [api, apply],
  );

  const resume = useCallback(async () => {
    if (!id) return;
    lastActive.current = Date.now();
    apply(await api.resumeSession(id), null);
    setNow(Date.now());
  }, [api, apply, id]);

  const finish = useCallback(
    async (courseId: string, note: string) => {
      if (!id) throw new Error('Açık seans yok');
      const r = await api.finishSession(id, courseId, note);
      apply(null);
      return r.log;
    },
    [api, apply, id],
  );

  const abandon = useCallback(async () => {
    if (!id) return null;
    const s = await api.abandonSession(id);
    apply(null);
    return s;
  }, [api, apply, id]);

  const setGoal = useCallback(
    (g: number | null) => {
      if (!id) return;
      writeGoal(id, g);
      setGoalMin(g);
    },
    [id],
  );

  const value: SessionApi = {
    session,
    running,
    paused: session?.status === 'paused',
    pausedBy: session?.status === 'paused' ? (pausedBy ?? 'lapsed') : null,
    elapsedMs: session ? shownMs(session, now + offset.current) : 0,
    goalMin,
    setGoal,
    idleAsk,
    stillHere,
    start,
    pause: (r) => pause(r),
    resume,
    finish,
    abandon,
    now,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
