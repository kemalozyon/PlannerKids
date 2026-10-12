import { formatMinutes } from '../lib/date';
import { STAGES, nextStage, stageIndex } from '../lib/forest';
import { dayAction } from '../lib/game';
import { useGame } from '../lib/GameContext';
import Tree from './Tree';

/** Bugün ekranının başı: bugünün ağacı (çalışılan dakika = para), dikme/büyütme düğmesi, seri. */
export default function GameStrip({ onPlant, goForest }: { onPlant: () => void; goForest: () => void }) {
  const { stats } = useGame();
  if (!stats) return <div className="game-strip skeleton" />;
  const w = stats.today;
  const best = stageIndex(w.earned);
  const nx = nextStage(w.earned);
  const lower = best >= 0 ? STAGES[best].min : 0;
  const pct = nx ? (w.earned - lower) / (nx.stage.min - lower) : 1;
  const act = dayAction(w);
  // Dikildiyse gerçek ağaç, dikilmediyse paranın yettiği ağacın önizlemesi
  const shown = w.tree ? w.tree.stage : best;

  return (
    <section className="game-strip">
      <button className="gs-plant" onClick={goForest} aria-label="Ormanımı göster">
        {shown >= 0 ? <Tree species={w.tree?.species ?? stats.favoriteSpecies} stage={shown} size={64} /> : <span className="gs-soil" aria-hidden />}
      </button>
      <div className="gs-main grow">
        <div className="gs-label">Bugünün ağacı</div>
        <div className="gs-value">
          🪙 {w.earned} dk
          {w.tree && <span className="muted small"> · {STAGES[w.tree.stage].name.toLowerCase()} dikildi</span>}
        </div>
        {nx ? (
          <>
            <div className="water-bar coin-bar" aria-hidden>
              <span style={{ width: `${Math.max(0.03, pct) * 100}%` }} />
            </div>
            <div className="muted small tabular">
              {nx.stage.name} için {formatMinutes(nx.remaining)} daha
            </div>
          </>
        ) : (
          <div className="muted small">Bugün dev ağaç kadar çalıştın! 🌲</div>
        )}
      </div>
      <span className={`chip streak${stats.streak === 0 ? ' off' : ''}`} title="Seri">
        <span aria-hidden>🔥</span> {stats.streak}
      </span>
      {act?.kind === 'plant' ? (
        <button className="btn primary full plant-btn" onClick={onPlant}>
          🌱 Bugünün ağacını dik
        </button>
      ) : act?.kind === 'grow' ? (
        <button className="btn primary full plant-btn" onClick={onPlant}>
          🌳 Ağacını büyüt: {STAGES[act.stage].name}
        </button>
      ) : w.tree ? (
        <div className="gs-note calm">Bugünün ağacı ormanında. Çalıştıkça büyütebilirsin.</div>
      ) : stats.todayPending ? (
        <div className="gs-note">Bugün de çalışırsan serin {stats.streak + 1} gün olur 🌱</div>
      ) : null}
    </section>
  );
}
