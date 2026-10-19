import { useState } from 'react';
import { CFG } from '../lib/config';
import { toLocalDate } from '../lib/date';
import { useGame } from '../lib/GameContext';
import { speciesOf } from '../lib/world';
import { DropSheet } from './DropReward';
import SeedSheet from './SeedSheet';

/** Bugün ekranının başı: bugünün ağacı (her çalışılan gün bir ağaç), türünü seçme, büyümesine kalan, seri,
 *  ağaçlarda bekleyen Elmas ve nadir ağaç ödülü. */
export default function GameStrip({ goForest, goGarden }: { goForest: () => void; goGarden: () => void }) {
  const { stats } = useGame();
  const [seeds, setSeeds] = useState(false);
  const [drop, setDrop] = useState<string | null>(null);
  if (!stats) return <div className="game-strip skeleton" />;
  const today = toLocalDate();
  const tree = stats.forest.find((t) => t.date === today) ?? null;
  const species = speciesOf(today, stats.seeds);
  const next = CFG.world.stages.find((s) => s.min > (tree?.minutes ?? 0));
  const waiting = stats.drops.filter((d) => !d.opened).at(-1);
  return (
    <section className="game-strip">
      <button className="gs-plant gs-forest" onClick={goGarden} aria-label="Bahçemi göster">
        {tree ? <span>{species.icon}</span> : <span className="gs-soil" aria-hidden />}
      </button>
      <div className="gs-main grow">
        <div className="gs-label">Bugünün ağacı</div>
        <div className="gs-value">
          {tree ? tree.name : `Bir ${species.name.toLocaleLowerCase('tr-TR')} seni bekliyor`}
          <span className="muted small"> · bahçelerinde {stats.treeCount}</span>
        </div>
        <div className="muted small">
          {!tree ? 'Çalışmaya başlayınca dikilir' : next ? `${Math.max(1, next.min - tree.minutes)} dk daha çalışınca büyür` : 'Bugünün ağacı nadir oldu! ✨'}
        </div>
      </div>
      <span className={`chip streak${stats.streak === 0 ? ' off' : ''}`} title="Seri">
        <span aria-hidden>🔥</span> {stats.streak}
      </span>
      <div className="gs-actions">
        <button className="btn" onClick={() => setSeeds(true)}>
          🌱 Tohum seç
        </button>
        <button className="btn grow" onClick={goGarden}>
          🌳 Bahçem
        </button>
        <button className="btn grow" onClick={goForest}>
          🏡 Dünyam
        </button>
      </div>
      {stats.treeElmasTotal > 0 && (
        <button className="gs-note gs-drop" onClick={goGarden}>
          💎 Ağaçlarında {stats.treeElmasTotal} Elmas bekliyor: <b>Bahçeme git</b>
        </button>
      )}
      {waiting && (
        <button className="gs-note gs-drop" onClick={() => setDrop(waiting.date)}>
          🎁 {waiting.date === today ? 'Bugünün' : 'Bir günün'} nadir ağaç ödülü seni bekliyor: <b>Ödülünü al</b>
        </button>
      )}
      {seeds && <SeedSheet today={today} onClose={() => setSeeds(false)} />}
      {drop && <DropSheet date={drop} onClose={() => setDrop(null)} />}
      {stats.todayPending && <div className="gs-note">Bugün de sayaçla çalışırsan serin {stats.streak + 1} gün olur 🌱</div>}
    </section>
  );
}
