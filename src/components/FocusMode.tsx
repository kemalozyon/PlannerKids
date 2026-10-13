import { useEffect, useState } from 'react';
import { formatMinutes } from '../lib/date';
import { nextStage, STAGES, stageIndex } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import type { Course } from '../lib/types';
import { formatClock } from '../lib/useTimer';
import type { SessionApi } from '../lib/SessionContext';
import ConfirmButton from './ConfirmButton';
import Tree from './Tree';
import { WILT_MIN } from '../lib/wilt';

const GOALS = [25, 40];
const SOUND_KEY = 'ct-focus-sound-v1';

/**
 * Tam ekran odak modu: halka sayaç, çalıştıkça büyüyen fidan, tur seçimi (25 / 40 / serbest),
 * tur bitince zil ve mola önerisi, isteğe bağlı yağmur sesi.
 * Fidan yalnızca gösterimdir: bugün çalışılan dakika + bu oturum hangi evreye yetiyorsa o (bugünün ağacı).
 * Açıkken ekranın kararmaması istenir (Wake Lock): kağıttan çalışırken ekran kapanıp sayaç durmasın.
 */
export default function FocusMode({
  ses,
  course,
  roundsToday,
  onFinish,
  onCancel,
  onClose,
}: {
  ses: SessionApi;
  course: Course | undefined;
  /** Bugün kaydedilmiş oturum sayısı (bu oturum hariç) */
  roundsToday: number;
  onFinish: () => void;
  /** İptal (uzun sürdüyse adada solgun fidan kalır) */
  onCancel: () => void;
  onClose: () => void;
}) {
  const { stats } = useGame();
  const goal = ses.goalMin;
  const elapsedMin = ses.elapsedMs / 60_000;
  const reached = goal != null && elapsedMin >= goal;
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) === '1';
    } catch {
      return false;
    }
  });

  useRain(sound && ses.running);
  useChime(reached, `${ses.session?.id}-${goal}`);
  useWakeLock(ses.running);

  // Esc ile küçült
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Serbestte halka her saat başı yeniden dolar
  const cycle = goal ?? 60;
  const pct = reached ? 1 : (elapsedMin % cycle) / cycle;
  const R = 112;
  const C = 2 * Math.PI * R;

  const wallet = (stats?.today.earned ?? 0) + Math.floor(elapsedMin);
  const stage = stageIndex(wallet);
  const nx = nextStage(wallet);
  const color = course?.color ?? 'var(--accent)';
  const rounds = Math.min(6, roundsToday + 1);

  return (
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label="Odak modu">
      <div className="focus-inner">
        <div className="focus-top">
          <button className="btn ghost sm" onClick={onClose}>
            Küçült
          </button>
          <div className="tabs focus-goals" role="radiogroup" aria-label="Tur uzunluğu">
            {goal != null && !GOALS.includes(goal) && (
              <button role="radio" aria-checked className="on">
                {goal} dk
              </button>
            )}
            {GOALS.map((g) => (
              <button key={g} role="radio" aria-checked={goal === g} className={goal === g ? 'on' : ''} onClick={() => ses.setGoal(g)}>
                {g} dk
              </button>
            ))}
            <button role="radio" aria-checked={goal == null} className={goal == null ? 'on' : ''} onClick={() => ses.setGoal(null)}>
              Serbest
            </button>
          </div>
        </div>

        <section className="card focus-card" style={{ borderColor: color }}>
          <div className="muted small">{ses.paused ? 'Sayaç durdu ⏸' : reached ? 'Turu tamamladın, harika! 🎉' : 'Odaklanıyorsun, harika!'}</div>
          <div className="timer-course">
            <span className="dot" style={{ background: color }} />
            {course?.name ?? 'Ders'}
          </div>
          <div className="focus-ring">
            <svg viewBox="0 0 260 260" aria-hidden>
              <circle cx="130" cy="130" r={R} fill="none" stroke="var(--line)" strokeWidth="14" />
              <circle
                cx="130"
                cy="130"
                r={R}
                fill="none"
                stroke={reached ? 'var(--good)' : color}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0.001, pct) * C} ${C}`}
                transform="rotate(-90 130 130)"
              />
            </svg>
            <div className="focus-center">
              <div className="clock">{formatClock(ses.elapsedMs)}</div>
              <div className={stage < 0 ? 'focus-tree faint' : 'focus-tree'}>
                <Tree species={stats?.today.tree?.species ?? stats?.favoriteSpecies ?? 'elma'} stage={Math.max(0, stage)} size={64} />
              </div>
            </div>
          </div>
          <div className="muted small center">
            {goal != null && !reached && <>Turun bitmesine {formatMinutes(Math.ceil(goal - elapsedMin))} · </>}
            {nx ? (
              <>
                Bugünün ağacı büyüyor · <strong className="ink">{nx.stage.name}</strong> olmasına {formatMinutes(nx.remaining)}
              </>
            ) : (
              <>Bugünün ağacı dev olacak kadar çalıştın! 🌲</>
            )}
          </div>
          <div className="rounds" aria-label={`Bugün ${rounds}. oturumun`}>
            {Array.from({ length: Math.max(4, rounds) }, (_, i) => (
              <span key={i} className={i < rounds - 1 ? 'done' : i === rounds - 1 ? 'now' : ''} style={i === rounds - 1 ? { background: color } : undefined} />
            ))}
          </div>
          <div className="muted small">Bugün {rounds}. oturumun</div>
          {reached && <div className="break-note">Bitirip 5 dakika mola ver: su iç, biraz esne. 🧃</div>}
          {!reached && elapsedMin >= 45 && goal == null && (
            <div className="break-note">{Math.floor(elapsedMin)} dakikadır çalışıyorsun. Kısa bir mola iyi gelir. 🧃</div>
          )}
          <div className="actions center focus-actions">
            <ConfirmButton className="btn ghost" confirmLabel={elapsedMin >= WILT_MIN ? 'Fidan solsun mu?' : 'Kaydetmeden sil?'} onConfirm={onCancel}>
              İptal
            </ConfirmButton>
            {ses.paused && (
              <button className="btn" onClick={() => ses.resume()}>
                ▶ Devam et
              </button>
            )}
            <button className="btn primary big" onClick={onFinish}>
              Bitirdim
            </button>
          </div>
        </section>

        <section className="card row focus-sound">
          <label className="check grow" htmlFor="focus-sound">
            <span className="grow">
              <strong>Yağmur sesi</strong>
              <span className="muted small"> · dikkat dağıtan sesleri örter</span>
            </span>
          </label>
          <input
            id="focus-sound"
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              try {
                localStorage.setItem(SOUND_KEY, e.target.checked ? '1' : '0');
              } catch {
                /* yok say */
              }
            }}
          />
        </section>
        <p className="muted small center">
          {STAGES[0].name} için {STAGES[0].min} dk yeter. Her dakika 🪙 1 dk para; sayaçla çalıştıkça 💎 Elmas da kazanırsın.
        </p>
      </div>
    </div>
  );
}

/** Açıkken ekran kararmasın (destekleyen tarayıcılarda). Sekmeye dönünce kilit yeniden istenir. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stop = false;
    const get = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (l) => {
          if (stop) l.release().catch(() => {});
          else lock = l;
        },
        () => {},
      );
    };
    get();
    document.addEventListener('visibilitychange', get);
    return () => {
      stop = true;
      document.removeEventListener('visibilitychange', get);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

/** Kahverengi gürültü: yumuşak yağmur benzeri ses. Kapanınca/odak modundan çıkınca durur. */
function useRain(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    src.connect(gain).connect(ctx.destination);
    src.start();
    return () => {
      src.stop();
      ctx.close();
    };
  }, [on]);
}

/** Son zil çalınan tur (modül düzeyinde: odak modu kapanıp açılınca tekrar çalmasın) */
let rungKey: string | null = null;

/** Tur bitince bir kez kısa zil çalar. */
function useChime(reached: boolean, key: string) {
  useEffect(() => {
    if (!reached || rungKey === key) return;
    rungKey = key;
    try {
      const ctx = new AudioContext();
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.25 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.25);
        o.stop(ctx.currentTime + i * 0.25 + 0.7);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch {
      /* ses yoksa sessiz geç */
    }
  }, [reached, key]);
}
