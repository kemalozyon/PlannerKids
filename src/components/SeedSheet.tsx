// Günün tohumu: bugünün ağacının türünü seç. Sende olan ve mevsiminde olan tohumlar ekilir; alınmamış tohum burada
// Elmasla alınabilir. Seçim gün içinde değiştirilebilir (ağaç dikildiyse türü değişir). Kurallar: lib/seeds.ts.
import { useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { buyCheck } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { seasonText, seedChoices, seedProblem } from '../lib/seeds';
import { speciesOf } from '../lib/world';
import Sheet from './Sheet';

export default function SeedSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const api = useApi();
  const { stats, refresh, buy } = useGame();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!stats) return null;
  const current = speciesOf(today, stats.seeds);
  const chosen = !!stats.seeds[today];
  const run = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet title="🌱 Bugünün tohumu" onClose={onClose}>
      <p className="muted small">
        Bugün çalışınca bahçende {chosen ? 'seçtiğin' : 'kendiliğinden gelen'} <b>{current.name.toLocaleLowerCase('tr-TR')}</b> büyüyecek. İstersen başka bir tohum
        seç: mevsimi olan ağaçlar yalnızca mevsiminde ekilir.
      </p>
      <ul className="seed-list">
        {seedChoices(today, stats.owned).map(({ species, item, owned, season }) => {
          const on = current.id === species.id && chosen;
          const price = item.acquire.kind === 'buy' ? item.acquire.price : 0;
          const why = !owned && season ? buyCheck(item.id, stats.crystals, stats.owned, stats.freezesLeft) : null;
          return (
            <li key={species.id} className={`seed${on ? ' on' : ''}${season ? '' : ' off'}`}>
              <span className="seed-ico" aria-hidden>
                {species.icon}
              </span>
              <span className="grow">
                <b>{species.name}</b>
                <br />
                <span className="muted small">{seasonText(species)}</span>
              </span>
              {!season ? (
                <span className="muted small">Mevsimi değil</span>
              ) : on ? (
                <span className="seed-done">✓ Ekildi</span>
              ) : owned ? (
                <button
                  className="btn sm"
                  disabled={busy != null}
                  onClick={() =>
                    run(species.id, async () => {
                      const bad = seedProblem(today, species.id, stats.owned, today);
                      if (bad) throw new Error(bad);
                      await api.setDaySeed(today, species.id);
                      await refresh();
                    })
                  }
                >
                  Ek
                </button>
              ) : (
                <button className="btn sm" disabled={!!why || busy != null} title={why ?? undefined} onClick={() => run(species.id, () => buy(item.id))}>
                  💎 {price}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error-ink small">{error}</p>}
    </Sheet>
  );
}
