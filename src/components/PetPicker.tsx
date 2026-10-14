// Yanıma al: sahip olunan evcil hayvanlardan seçilenler karakterin peşinden gelir (dünya ve gezinti). Kaç hayvan
// alınabileceği seviyeye bağlı (catalog.ts → companionSlots). Her dokunuş hemen kaydedilir (equipped.pets).
import { companionSlots, ITEMS } from '../lib/catalog';
import { owns } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { sfx } from '../lib/sfx';
import Sheet from './Sheet';

export default function PetPicker({ onClose }: { onClose: () => void }) {
  const { stats, equip } = useGame();
  if (!stats) return null;
  const e = stats.equipped;
  const pets = ITEMS.filter((i) => i.category === 'evcil' && owns(i, stats.owned, stats.unlock));
  const slots = companionSlots(stats.level.index);
  return (
    <Sheet title="🐾 Yanıma al" onClose={onClose}>
      <p className="muted small">{slots > 1 ? 'En çok iki hayvan peşinden gelebilir.' : 'Bir hayvan peşinden gelebilir (Bahçıvan seviyesinde iki).'}</p>
      {pets.length ? (
        <div className="pick-row">
          {pets.map((i) => {
            const on = e.pets.includes(i.id);
            return (
              <button
                key={i.id}
                className={`pick${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  sfx.pop();
                  equip({ ...e, pets: on ? e.pets.filter((p) => p !== i.id) : [...e.pets, i.id].slice(-slots) }).catch(() => {});
                }}
              >
                <span aria-hidden>{i.icon}</span> {i.name}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted small">Henüz hayvanın yok. Bahçelerinde ağaçlar çoğaldıkça hayvanlar kendiliğinden gelir (ilki 5 ağaçta 🐱).</p>
      )}
    </Sheet>
  );
}
