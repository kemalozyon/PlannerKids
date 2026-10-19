// Radyo / pikap (MUSIC): çalışırken dinlenecek Lo-Fi ve doğa sesleri. Uygulamanın tek ortam çaları
// (lib/ambient.ts): pencere kapansa, sekme değişse de çalmaya devam eder; çalan eşyanın plağı döner.
import { CHANNELS, play, setVolume, stop, useAmbient } from '../lib/ambient';
import Sheet from './Sheet';

export default function MusicSheet({ title, source, onClose }: { title: string; source: string; onClose: () => void }) {
  const amb = useAmbient();
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted small">Ders çalışırken arkada çalsın: odak modunda ve başka sekmelerde de devam eder.</p>
      <div className="music-list" role="radiogroup" aria-label="Kanal">
        {CHANNELS.map((c) => {
          const on = amb.channel === c.id;
          return (
            <button key={c.id} role="radio" aria-checked={on} className={`music-ch${on ? ' on' : ''}`} onClick={() => (on ? stop() : play(c.id, source))}>
              <span className="ico" aria-hidden>
                {c.icon}
              </span>
              <span>
                <b>{c.name}</b>
                <br />
                <span className="muted small">{c.desc}</span>
              </span>
              {on && (
                <span className="eq" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className="music-vol">
        <span aria-hidden>🔈</span>
        <input type="range" min={5} max={100} value={Math.round(amb.volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} aria-label="Ses düzeyi" />
        <span aria-hidden>🔊</span>
      </label>
      {amb.channel && (
        <button className="btn full" onClick={stop}>
          ⏹ Durdur
        </button>
      )}
    </Sheet>
  );
}
