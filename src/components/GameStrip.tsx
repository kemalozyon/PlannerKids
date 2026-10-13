import { CFG } from '../lib/config';
import { toLocalDate } from '../lib/date';
import { useGame } from '../lib/GameContext';
import { speciesOf } from '../lib/world';

/** Bugün ekranının başı: bugünün ağacı (her çalışılan gün bir ağaç), büyümesine kalan, seri. */
export default function GameStrip({ goForest }: { goForest: () => void }) {
  const { stats } = useGame();
  if (!stats) return <div className="game-strip skeleton" />;
  const today = toLocalDate();
  const tree = stats.forest.find((t) => t.date === today && !t.dry) ?? null;
  const species = speciesOf(today);
  const next = CFG.world.stages.find((s) => s.min > (tree?.minutes ?? 0));
  return (
    <section className="game-strip">
      <button className="gs-plant gs-forest" onClick={goForest} aria-label="Dünyamı göster">
        {tree ? <span>{species.icon}</span> : <span className="gs-soil" aria-hidden />}
      </button>
      <div className="gs-main grow">
        <div className="gs-label">Bugünün ağacı</div>
        <div className="gs-value">
          {tree ? tree.name : `Bir ${species.name.toLocaleLowerCase('tr-TR')} seni bekliyor`}
          <span className="muted small"> · bahçelerinde {stats.treeCount}</span>
        </div>
        <div className="muted small">
          {next ? `${Math.max(1, next.min - (tree?.minutes ?? 0))} dk daha çalışınca ${tree ? 'büyür' : 'dikilir'}` : 'Bugünün ağacı dev oldu!'}
        </div>
      </div>
      <span className={`chip streak${stats.streak === 0 ? ' off' : ''}`} title="Seri">
        <span aria-hidden>🔥</span> {stats.streak}
      </span>
      <button className="btn full plant-btn" onClick={goForest}>
        🏡 Dünyama git
      </button>
      {stats.todayPending && <div className="gs-note">Bugün de sayaçla çalışırsan serin {stats.streak + 1} gün olur 🌱</div>}
    </section>
  );
}
