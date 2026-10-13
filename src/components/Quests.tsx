// Görevlerim: bugünün ve bu haftanın ders görevleri (ödülü 💎) ve haftalık sandık.
// Görevler kendiliğinden tamamlanır; Elmas'ı sunucu hesaplayıp deftere yazar (GameContext yenilenince).
import { useState } from 'react';
import { RARITY, type Item } from '../lib/catalog';
import { CHEST_DAYS, CHEST_MINUTES, chestPrize, type ChestState, type QuestState } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import Sheet from './Sheet';

export default function Quests({ goShop }: { goShop: () => void }) {
  const { stats } = useGame();
  const [chest, setChest] = useState<ChestState | null>(null);
  if (!stats) return null;
  const daily = stats.quests.filter((q) => q.scope === 'day');
  const weekly = stats.quests.filter((q) => q.scope === 'week');
  const [last, now] = stats.chests;
  const waiting = [last, now].filter((c) => c.ready && !c.opened);

  return (
    <section className="card quests" data-tour="quests">
      <div className="card-head">
        <h2>🎯 Görevlerim</h2>
        <button className="chip gem" onClick={goShop} aria-label={`${stats.crystals} Elmas — dükkân`}>
          💎 {stats.crystals}
        </button>
      </div>
      {waiting.map((c) => (
        <button key={c.week} className="chest-ready" onClick={() => setChest(c)}>
          <span className="chest-icon" aria-hidden>
            📦
          </span>
          <span className="grow">
            <strong>{c === last ? 'Geçen haftanın sandığı seni bekliyor!' : 'Haftalık sandığın hazır!'}</strong>
            <span className="muted small">Aç bakalım içinden ne çıkacak</span>
          </span>
          <span className="pending-cta">Aç</span>
        </button>
      ))}
      <ul className="quest-list">
        {daily.map((q) => (
          <QuestRow key={q.id} q={q} />
        ))}
        <li className="quest-sub muted small">Bu hafta</li>
        {weekly.map((q) => (
          <QuestRow key={q.id} q={q} />
        ))}
        {!now.opened && !now.ready && (
          <li className="quest">
            <span className="quest-icon" aria-hidden>
              📦
            </span>
            <span className="grow">
              <span className="quest-title">Haftalık sandık</span>
              <span className="muted small">
                {now.days}/{CHEST_DAYS} gün · {Math.min(now.minutes, CHEST_MINUTES)}/{CHEST_MINUTES} dk
              </span>
              <span className="pbar" aria-hidden>
                <span style={{ width: `${Math.min(1, (Math.min(now.days / CHEST_DAYS, 1) + Math.min(now.minutes / CHEST_MINUTES, 1)) / 2) * 100}%` }} />
              </span>
            </span>
            <span className="quest-reward">🎁</span>
          </li>
        )}
      </ul>
      {chest && <ChestSheet chest={chest} onClose={() => setChest(null)} />}
    </section>
  );
}

function QuestRow({ q }: { q: QuestState }) {
  return (
    <li className={`quest${q.done ? ' done' : ''}`}>
      <span className="quest-icon" aria-hidden>
        {q.done ? '✅' : q.icon}
      </span>
      <span className="grow">
        <span className="quest-title">{q.title}</span>
        {!q.done && (
          <span className="pbar" aria-hidden>
            <span style={{ width: `${(q.progress / q.target) * 100}%` }} />
          </span>
        )}
      </span>
      <span className="quest-reward">
        +{q.reward} 💎
      </span>
    </li>
  );
}

/** Sandık açılışı: sallanan sandık → "Aç!" → içinden çıkan eşya */
function ChestSheet({ chest, onClose }: { chest: ChestState; onClose: () => void }) {
  const { stats, openChest } = useGame();
  const [prize, setPrize] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!stats) return null;
  return (
    <Sheet title="Haftalık sandık" onClose={onClose}>
      {prize ? (
        <div className="chest-open">
          <div className="chest-prize" aria-hidden>
            {prize.icon}
          </div>
          <h2>{prize.name}!</h2>
          <span className="rarity-tag" style={{ ['--rarity' as string]: RARITY[prize.rarity].color }}>
            {RARITY[prize.rarity].name}
          </span>
          <p className="muted small">
            {prize.category === 'evcil' ? 'Dükkândan ya da koleksiyondan yanına alabilirsin.' : 'Gezintide 🔨 ile adana yerleştirebilirsin.'}
          </p>
          <button className="btn primary full" onClick={onClose}>
            Harika!
          </button>
        </div>
      ) : (
        <div className="chest-open">
          <div className="chest-shake" aria-hidden>
            📦
          </div>
          <p className="muted">Bu hafta {chest.days} gün, {chest.minutes} dk çalıştın. Sandığı hak ettin!</p>
          <button
            className="btn primary full big"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const item = chestPrize(chest.week, stats.owned);
              try {
                await openChest(chest.week, item.id);
                setPrize(item);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Aç!
          </button>
          {error && <p className="error-ink small">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
