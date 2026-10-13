import { CFG } from '../lib/config';
import { toLocalDate } from '../lib/date';
import { useGame } from '../lib/GameContext';

/** Bugün ekranının başı: bugün dikilen ağaçlar (her seans bir ağaç), sıradaki ağacın ipucu, seri. */
export default function GameStrip({ goForest }: { goForest: () => void }) {
  const { stats } = useGame();
  if (!stats) return <div className="game-strip skeleton" />;
  const today = toLocalDate();
  const trees = stats.forest.filter((t) => t.date === today);
  const grown = trees.filter((t) => !t.dry);
  const kinds = CFG.world.trees;
  return (
    <section className="game-strip">
      <button className="gs-plant gs-forest" onClick={goForest} aria-label="Dünyamı göster">
        {grown.length ? grown.slice(-4).map((t) => <span key={t.id}>{t.icon}</span>) : <span className="gs-soil" aria-hidden />}
      </button>
      <div className="gs-main grow">
        <div className="gs-label">Bugünün ormanı</div>
        <div className="gs-value">
          {grown.length ? `${grown.length} ağaç dikildi` : 'Henüz ağaç yok'}
          <span className="muted small"> · toplam {stats.treeCount}</span>
        </div>
        <div className="muted small">
          Her seans bir ağaç: {kinds.slice(1).map((k) => `${k.icon} ${k.min}`).join(' · ')} dk
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
