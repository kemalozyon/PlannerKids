import { formatMinutes } from '../lib/date';
import { STAGES, nextStage, stageIndex } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import Tree from './Tree';

/** Bugün ekranının başı: bugünün cüzdanı (çalışılan dakika = para), alınabilecek en büyük bitki, seri. */
export default function GameStrip({ onPlant, goForest }: { onPlant: () => void; goForest: () => void }) {
  const { stats } = useGame();
  if (!stats) return <div className="game-strip skeleton" />;
  const w = stats.today;
  const best = stageIndex(w.left);
  const nx = nextStage(w.left);
  const lower = best >= 0 ? STAGES[best].min : 0;
  const pct = nx ? (w.left - lower) / (nx.stage.min - lower) : 1;
  const plantedToday = stats.trees.filter((t) => t.date === w.date).length;

  return (
    <section className="game-strip">
      <button className="gs-plant" onClick={goForest} aria-label="Ormanımı göster">
        {best >= 0 ? <Tree species={stats.favoriteSpecies} stage={best} size={64} /> : <span className="gs-soil" aria-hidden />}
      </button>
      <div className="gs-main grow">
        <div className="gs-label">Bugünkü cüzdanım</div>
        <div className="gs-value">
          🪙 {w.left} dk
          {w.spent > 0 && <span className="muted small"> · {w.spent} dk harcadın</span>}
        </div>
        {nx ? (
          <>
            <div className="water-bar coin-bar" aria-hidden>
              <span style={{ width: `${Math.max(0.03, pct) * 100}%` }} />
            </div>
            <div className="muted small tabular">
              {best >= 0 ? `${STAGES[best].name} alabilirsin · ` : ''}
              {nx.stage.name} için {formatMinutes(nx.remaining)} daha
            </div>
          </>
        ) : (
          <div className="muted small">Dev ağaç alacak kadar paran var! 🌲</div>
        )}
      </div>
      <span className={`chip streak${stats.streak === 0 ? ' off' : ''}`} title="Seri">
        <span aria-hidden>🔥</span> {stats.streak}
      </span>
      {best >= 0 ? (
        <button className="btn primary full plant-btn" onClick={onPlant}>
          🛒 Bitki al, ormanıma dik
        </button>
      ) : plantedToday > 0 ? (
        <div className="gs-note calm">Bugün {plantedToday} bitki diktin. Çalıştıkça yeni para kazanırsın.</div>
      ) : stats.todayPending ? (
        <div className="gs-note">Bugün de çalışırsan serin {stats.streak + 1} gün olur 🌱</div>
      ) : null}
    </section>
  );
}
