// Nadir ağaç ödülü: bir günde world.drop.minutes dk sayaçla çalışınca o günün ağacının dibinden bir eşya çıkar
// (yalnızca bu yolla bulunan nadir eşyalar; günün eşyası tarihe göre sabit: economy.ts → dropPrize). Gün kartında
// (DaySheet) ve Bugün'deki ağaç kartında (GameStrip → DropSheet) görünür. Sunucu owned_check ile doğrular.
import { useState } from 'react';
import { itemById, RARITY, type Item } from '../lib/catalog';
import { dropPrize } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { ItemIcon } from './ItemCard';
import Sheet from './Sheet';

/** Günün ödülü: alınmadıysa "🎁 Ödülünü al", alındıysa çıkan eşya. O gün ödül yoksa hiçbir şey. */
export default function DropReward({ date, onDone }: { date: string; onDone?: () => void }) {
  const { stats, openDrop } = useGame();
  const [prize, setPrize] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drop = stats?.drops.find((d) => d.date === date);
  if (!stats || !drop) return null;

  if (prize) {
    return (
      <div className="chest-open drop-open">
        <div className="chest-prize" aria-hidden>
          <ItemIcon item={prize} className="big" />
        </div>
        <h2>{prize.name}!</h2>
        <span className="rarity-tag" style={{ ['--rarity' as string]: RARITY[prize.rarity].color }}>
          {RARITY[prize.rarity].name}
        </span>
        <p className="muted small">Yalnızca nadir ağaç günlerinde bulunur. Envanterinden Dünyam'a yerleştirebilirsin.</p>
        {onDone && (
          <button className="btn primary full" onClick={onDone}>
            Harika!
          </button>
        )}
      </div>
    );
  }

  if (drop.opened) {
    const got = itemById(stats.owned.find((o) => o.via === 'drop' && o.ref === date)?.item_id ?? '');
    return got ? (
      <div className="drop-row">
        <ItemIcon item={got} />
        <span className="grow small">
          <strong>Nadir ağaç ödülü</strong>
          <br />
          <span className="muted">{got.name} bu günün ağacından çıktı</span>
        </span>
      </div>
    ) : null;
  }

  return (
    <>
      <div className="drop-row ready">
        <span className="chest-icon" aria-hidden>
          🎁
        </span>
        <span className="grow small">
          <strong>Nadir ağaç ödülü!</strong>
          <br />
          <span className="muted">Bu gün {drop.minutes} dk sayaçla çalıştın; ağacının dibinde bir şey parlıyor.</span>
        </span>
        <button
          className="btn primary sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const item = dropPrize(date, stats.owned);
            try {
              await openDrop(date, item.id);
              setPrize(item);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Ödülünü al
        </button>
      </div>
      {error && <p className="error-ink small">{error}</p>}
    </>
  );
}

/** Bugün'deki ağaç kartından açılan ödül paneli */
export function DropSheet({ date, onClose }: { date: string; onClose: () => void }) {
  return (
    <Sheet title="🎁 Nadir ağaç ödülü" onClose={onClose}>
      <DropReward date={date} onDone={onClose} />
    </Sheet>
  );
}
