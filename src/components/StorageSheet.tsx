// Depo eşyasının içi (STORAGE: sandık, gardırop, dolap): içindekiler ve envanterde boşta duran, içine konabilecek
// eşyalar. Konan eşya envanterden düşer (başka yere yerleştirilemez); çıkarılan envantere döner. Her dokunuş hemen
// kaydedilir (dünya sayfası → persist).
import type { Item } from '../lib/catalog';
import { itemById } from '../lib/catalog';
import { ItemIcon } from './ItemCard';
import Sheet from './Sheet';

export default function StorageSheet({
  item,
  stored,
  candidates,
  onPut,
  onTake,
  onClose,
}: {
  item: Item;
  stored: string[];
  /** Envanterde boşta duran, içine konabilecek eşyalar ve adetleri */
  candidates: { it: Item; n: number }[];
  onPut: (id: string) => void;
  onTake: (k: number) => void;
  onClose: () => void;
}) {
  const cap = item.capacity ?? 0;
  const full = stored.length >= cap;
  return (
    <Sheet title={`${item.icon} ${item.name}`} onClose={onClose}>
      <p className="muted small">
        İçinde {stored.length}/{cap} eşya. İçindekine dokun: envantere döner.
      </p>
      <div className="storage-grid" aria-label="İçindekiler">
        {stored.length === 0 && <p className="muted small">Boş.</p>}
        {stored.map((id, k) => {
          const it = itemById(id);
          return (
            it && (
              <button key={`${id}-${k}`} className="inv-item" onClick={() => onTake(k)} title="Çıkar">
                <span aria-hidden>
                  <ItemIcon item={it} />
                </span>
                <span className="inv-name">{it.name}</span>
              </button>
            )
          );
        })}
      </div>
      <h3 className="storage-head">Envanterinden koy</h3>
      {full ? (
        <p className="muted small">{item.name} doldu.</p>
      ) : candidates.length === 0 ? (
        <p className="muted small">Envanterinde boşta eşya yok.</p>
      ) : (
        <div className="storage-grid" aria-label="Envanter">
          {candidates.map(({ it, n }) => (
            <button key={it.id} className="inv-item" onClick={() => onPut(it.id)} title="İçine koy">
              <span aria-hidden>
                <ItemIcon item={it} />
              </span>
              <span className="inv-name">{it.name}</span>
              {n > 1 && n < 1000 && <span className="inv-n">×{n}</span>}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
