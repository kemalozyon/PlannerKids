import { useEffect, useRef } from 'react';
import { useApi } from '../lib/ApiContext';
import { useGame } from '../lib/GameContext';
import { markReportSeen, startReportSend, useReportSend, wantReportPreview } from '../lib/reportSend';

/** Ekranın altında kutlama kartları + bir kez konfeti. */
export default function Celebrations() {
  const { celebrations, dismiss } = useGame();
  const first = celebrations[0];

  useEffect(() => {
    if (!first) return;
    const id = setTimeout(() => dismiss(first.key), 4000);
    return () => clearTimeout(id);
  }, [first, dismiss]);

  return (
    <>
      {first && <Confetti key={first.key} />}
      <div className="toasts" aria-live="polite">
        <ReportToast />
        {first && (
          <button className={`toast toast-${first.kind}`} onClick={() => dismiss(first.key)}>
            <span className="toast-icon" aria-hidden>
              {first.icon}
            </span>
            <span className="grow">
              <strong>{first.title}</strong>
              <span className="muted small">{first.detail}</span>
            </span>
            {celebrations.length > 1 && <span className="muted small">+{celebrations.length - 1}</span>}
          </button>
        )}
      </div>
    </>
  );
}

/** Arka plandaki rapor gönderimi bitti, çocuk başka sekmedeyse: sonucu bildir. */
function ReportToast() {
  const api = useApi();
  const send = useReportSend();
  const show = send && send.phase !== 'sending' && !send.seen ? send : null;

  useEffect(() => {
    if (!show) return;
    const id = setTimeout(markReportSeen, 6000);
    return () => clearTimeout(id);
  }, [show]);
  if (!show) return null;

  const ok = show.phase === 'done';
  return (
    <button
      className={`toast toast-${ok ? 'report' : 'report-error'}`}
      onClick={() => {
        markReportSeen();
        if (ok) {
          wantReportPreview();
          location.hash = 'today';
        } else startReportSend(api, show.date);
      }}
    >
      <span className="toast-icon" aria-hidden>
        {ok ? '📨' : '⚠️'}
      </span>
      <span className="grow">
        <strong>{ok ? 'Rapor ebeveynine gönderildi' : 'Rapor gönderilemedi'}</strong>
        <span className="muted small">{ok ? 'Görmek için dokun' : `${show.message ?? 'Bir sorun oldu'} · Tekrar denemek için dokun`}</span>
      </span>
    </button>
  );
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = (cv.width = innerWidth * dpr);
    const H = (cv.height = innerHeight * dpr);
    const colors = ['#4f7cff', '#16a37f', '#e0803a', '#d1477a', '#8b5cf6', '#f2c230'];
    const parts = Array.from({ length: 90 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.85,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: -(10 + Math.random() * 12) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: (5 + Math.random() * 5) * dpr,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const age = (t - t0) / 1600;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - age);
      for (const p of parts) {
        p.vy += 0.45 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (age < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="confetti" aria-hidden />;
}
