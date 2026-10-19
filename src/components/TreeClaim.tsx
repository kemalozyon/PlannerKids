// Ağaçtan Elmas: o günün ağacında bekleyen Elmas (güne bağlı kazançlar, economy.ts → claimable) gün kartında
// (DaySheet) "💎 N Elmas'ı al" ile alınır; sunucu claim_day ile deftere yazar. Hiç kaybolmaz.
import { useState } from 'react';
import { CLAIM_FROM } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { sfx } from '../lib/sfx';

export default function TreeClaim({ date, studied }: { date: string; studied: boolean }) {
  const { stats, claimDay } = useGame();
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!stats) return null;
  const waiting = stats.treeElmas.get(date) ?? 0;
  if (got != null && !waiting) {
    return (
      <div className="drop-row claim-row done" role="status">
        <span className="chest-icon" aria-hidden>
          💎
        </span>
        <span className="grow small">
          <strong>+{got} Elmas aldın!</strong>
          <br />
          <span className="muted">Dükkândan yeni eşyalar alabilirsin.</span>
        </span>
      </div>
    );
  }
  if (!waiting) {
    return studied && date >= CLAIM_FROM ? <p className="muted small">✓ Bu günün ağacındaki Elmas alındı.</p> : null;
  }
  return (
    <>
      <div className="drop-row ready claim-row">
        <span className="chest-icon" aria-hidden>
          💎
        </span>
        <span className="grow small">
          <strong>Ağacında {waiting} Elmas bekliyor</strong>
          <br />
          <span className="muted">Bu gün çalışarak kazandın; dokun, kumbarana geçsin.</span>
        </span>
        <button
          className="btn primary sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const n = await claimDay(date);
              setGot(n);
              sfx.star();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          💎 {waiting} Elmas'ı al
        </button>
      </div>
      {error && <p className="error-ink small">{error}</p>}
    </>
  );
}
