import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { formatMinutes } from '../lib/date';
import { CFG } from '../lib/config';
import type { Course } from '../lib/types';
import { formatClock } from '../lib/useTimer';
import type { SessionApi } from '../lib/SessionContext';
import ConfirmButton from './ConfirmButton';
import { speciesOf, stageOf, treeLabel } from '../lib/world';
import { useGame } from '../lib/GameContext';
import { toLocalDate } from '../lib/date';
import { ambientState, play as playAmbient, stop as stopAmbient } from '../lib/ambient';
import { hasWebGL } from '../lib/webgl';

const GOALS = [25, 40];
const SOUND_KEY = 'ct-focus-sound-v1';
const ROOM_KEY = 'ct-focus-room-v1';
const StudyRoom = lazy(() => import('./world3d/StudyRoom'));

/**
 * Tam ekran odak modu: halka sayaç, çalıştıkça büyüyen bugünün ağacı (her gün bir ağaç; büyüklüğü günün
 * toplamına göre), tur seçimi (25 / 40 / serbest), tur bitince zil ve mola önerisi, isteğe bağlı yağmur sesi.
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
  /** İptal: seans kaydedilmez (ağaç büyümez) */
  onCancel: () => void;
  onClose: () => void;
}) {
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

  // Odam: karakter odadaki masasında ders çalışırken (isteğe bağlı, 3D)
  const can3D = useMemo(hasWebGL, []);
  const [room, setRoom] = useState(() => {
    try {
      return localStorage.getItem(ROOM_KEY) === '1';
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

  // Bugünün ağacı: günün toplamı (bu seans dahil) büyüklüğünü, tarih türünü belirler
  const { stats } = useGame();
  const dayMin = (stats?.todayMinutes ?? 0) + elapsedMin;
  const species = speciesOf(toLocalDate(), stats?.seeds);
  const { stage } = stageOf(Math.floor(dayMin));
  const nx = CFG.world.stages.find((k) => k.min > dayMin);
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
              <div className="focus-tree" aria-hidden>
                {species.icon}
              </div>
            </div>
          </div>
          <div className="muted small center">
            {goal != null && !reached && <>Turun bitmesine {formatMinutes(Math.ceil(goal - elapsedMin))} · </>}
            {nx ? (
              <>
                Bugünün ağacı: <strong className="ink">{treeLabel(species, stage)}</strong> · büyümesine {formatMinutes(Math.ceil(nx.min - dayMin))}
              </>
            ) : (
              <>Bugünün ağacı dev bir {species.name.toLocaleLowerCase('tr-TR')} oldu! {species.icon}</>
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
            <ConfirmButton className="btn ghost" confirmLabel="Kaydetmeden sil?" onConfirm={onCancel}>
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

        {can3D && room && (
          <div className="focus-room">
            <Suspense fallback={null}>
              <StudyRoom />
            </Suspense>
          </div>
        )}
        {can3D && (
          <section className="card row focus-sound">
            <label className="check grow" htmlFor="focus-room">
              <span className="grow">
                <strong>🏠 Odamı göster</strong>
                <span className="muted small"> · karakterin masanda seninle çalışsın</span>
              </span>
            </label>
            <input
              id="focus-room"
              type="checkbox"
              checked={room}
              onChange={(e) => {
                setRoom(e.target.checked);
                try {
                  localStorage.setItem(ROOM_KEY, e.target.checked ? '1' : '0');
                } catch {
                  /* yok say */
                }
              }}
            />
          </section>
        )}
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
        <p className="muted small center">Seansı bitirince bugünün ağacı büyür ve çalıştığın her dakikaya 1 💎 Elmas kazanırsın. Bir günde {CFG.world.drop.minutes} dk sayaçla çalışırsan ağacın nadir olur ve dibinden bir eşya çıkar.</p>
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

/**
 * Yağmur sesi (uygulamanın ortam çaları, lib/ambient.ts). Odadaki radyoda başka bir kanal çalıyorsa ona dokunmaz;
 * yalnızca kendi açtığı yağmuru kapatır.
 */
function useRain(on: boolean) {
  useEffect(() => {
    if (!on || ambientState().channel) return;
    playAmbient('yagmur');
    return () => {
      if (ambientState().channel === 'yagmur' && !ambientState().source) stopAmbient();
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
