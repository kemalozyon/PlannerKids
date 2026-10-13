// Çalışma seansı: süre sunucuda, sunucunun saatiyle tutulur (0009_sessions.sql). Buradaki saf fonksiyonlar
// SQL'deki session_* fonksiyonlarının aynısıdır; demo API ve testler bunları kullanır.
//
// Sayaç açıkken istemci dakikada bir "buradayım" (beat) gönderir. Son beat'ten sonra en fazla
// graceSeconds sayılır: sekme kapanır, telefon kilitlenir ya da internet giderse süre kendiliğinden durur.
import { CFG } from './config';

export type SessionStatus = 'running' | 'paused' | 'finished' | 'abandoned';

export interface StudySession {
  id: string;
  course_id: string;
  /** Seansın başladığı yerel gün (kayıt bu güne yazılır) */
  date: string;
  status: SessionStatus;
  started_at: string;
  /** Kapanmış dilimlerin toplamı (ms) */
  active_ms: number;
  /** Açık dilimin başı; duraklatılmışsa null */
  segment_start: string | null;
  last_beat: string | null;
  ended_at: string | null;
  minutes: number | null;
  note: string | null;
  log_id: string | null;
}

/** Sunucudan gelen seans + sunucunun o anki saati (istemci saatiyle farkı hesaplamak için) */
export interface SessionState {
  session: StudySession;
  serverNow: string;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : 0);
const iso = (t: number) => new Date(t).toISOString();

/** Açık dilimin sayılacağı son an: şimdi ya da son beat + tolerans (hangisi önceyse) */
export function creditEnd(s: StudySession, at: number, cfg = CFG.session): number {
  return Math.min(at, ms(s.last_beat) + cfg.graceSeconds * 1000);
}

/** Şu ana kadar sayılan süre (ms) */
export function activeMs(s: StudySession, at: number, cfg = CFG.session): number {
  if (s.status !== 'running' || !s.segment_start) return s.active_ms;
  return s.active_ms + Math.max(0, creditEnd(s, at, cfg) - ms(s.segment_start));
}

/** Ekranda gösterilen süre: açık dilim tolerans beklemeden akar (beat gelince sunucu düzeltir) */
export function shownMs(s: StudySession, at: number): number {
  if (s.status !== 'running' || !s.segment_start) return s.active_ms;
  return s.active_ms + Math.max(0, at - ms(s.segment_start));
}

/** Açık dilimi kapatır; back: sondan bu kadar saniye sayılmaz (hareketsizlik) */
function closeSegment(s: StudySession, at: number, backSec: number, cfg = CFG.session): StudySession {
  if (s.status !== 'running' || !s.segment_start) return s;
  const maxBack = cfg.idleMinutes * 60 + cfg.idleAnswerSeconds;
  const end = Math.min(at - Math.min(Math.max(0, backSec), maxBack) * 1000, ms(s.last_beat) + cfg.graceSeconds * 1000);
  return { ...s, status: 'paused', active_ms: s.active_ms + Math.max(0, end - ms(s.segment_start)), segment_start: null };
}

/** "Buradayım": tolerans aşıldıysa seans o anda durmuş sayılır ve duraklatılır */
export function beat(s: StudySession, at: number, cfg = CFG.session): StudySession {
  if (s.status !== 'running') return s;
  if (at > ms(s.last_beat) + cfg.graceSeconds * 1000) return closeSegment(s, at, 0, cfg);
  return { ...s, last_beat: iso(at) };
}

export function pause(s: StudySession, at: number, backSec = 0, cfg = CFG.session): StudySession {
  return closeSegment(s, at, backSec, cfg);
}

export function resume(s: StudySession, at: number): StudySession {
  if (s.status !== 'paused') return s;
  return { ...s, status: 'running', segment_start: iso(at), last_beat: iso(at) };
}

/** Kayda yazılacak dakika (en fazla maxMinutes) */
export function sessionMinutes(s: StudySession, at: number, cfg = CFG.session): number {
  return Math.min(cfg.maxMinutes, Math.floor(activeMs(s, at, cfg) / 60_000));
}

/** "Ne çalıştın?" notu geçerli mi; değilse nedeni */
export function noteProblem(note: string, cfg = CFG.session): string | null {
  const n = note.trim().length;
  if (n < cfg.noteMin) return `Ne çalıştığını kısaca yaz (en az ${cfg.noteMin} harf).`;
  if (n > cfg.noteMax) return `Not en fazla ${cfg.noteMax} harf olabilir.`;
  return null;
}

export function newSession(id: string, courseId: string, date: string, at: number): StudySession {
  return {
    id,
    course_id: courseId,
    date,
    status: 'running',
    started_at: iso(at),
    active_ms: 0,
    segment_start: iso(at),
    last_beat: iso(at),
    ended_at: null,
    minutes: null,
    note: null,
    log_id: null,
  };
}
