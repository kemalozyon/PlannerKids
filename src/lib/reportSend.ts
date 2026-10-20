// Günün raporu arka planda gönderilir: "Günü bitir"e basınca panel hemen kapanır, Edge Function
// (Gemini + e-posta, 2 dakikayı bulabilir) beklenirken çocuk uygulamayı kullanmaya devam eder.
// Durum modül düzeyinde tutulur; Bugün sekmesinden çıkılsa da sonuç kaybolmaz (EndDay + ReportToast).
import { useSyncExternalStore } from 'react';
import type { Api } from './types';

export interface ReportSendState {
  date: string;
  phase: 'sending' | 'done' | 'error';
  message?: string;
  /** Sonuç ekranda gösterildi (önizleme açıldı ya da bildirim kapatıldı) */
  seen?: boolean;
}

let state: ReportSendState | null = null;
/** Bildirimdeki "Raporu gör": Bugün açılınca önizleme bir kez açılır */
let previewWanted = false;
const listeners = new Set<() => void>();

function set(next: ReportSendState | null) {
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useReportSend = () => useSyncExternalStore(subscribe, () => state);

/** Raporu arka planda gönderir; o gün için zaten gönderiliyorsa bir şey yapmaz. */
export function startReportSend(api: Api, date: string) {
  if (state?.date === date && state.phase === 'sending') return;
  set({ date, phase: 'sending' });
  api
    .sendDailyReport(date)
    .then((r) => set(r.status === 'error' ? { date, phase: 'error', message: r.message } : { date, phase: 'done' }))
    .catch((e: Error) => set({ date, phase: 'error', message: e.message }));
}

/** Sonuç görüldü: bildirim bir daha çıkmaz. */
export function markReportSeen() {
  if (state && state.phase !== 'sending' && !state.seen) set({ ...state, seen: true });
}

export function wantReportPreview() {
  previewWanted = true;
}

/** Bekleyen "Raporu gör" isteğini al (bir kez) */
export function takeReportPreview(): boolean {
  const on = previewWanted;
  previewWanted = false;
  return on;
}
