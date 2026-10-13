import { IconChevron } from '../components/Icons';
import { companionSlots, ITEMS, type Item } from '../lib/catalog';
import { formatMinutes } from '../lib/date';
import { owns } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { LEVELS, TIERS } from '../lib/level';
import type { Equipped } from '../lib/types';

type Target = 'parent' | 'rewards' | 'courses' | 'shop' | 'collection';

const LINKS: { id: Target; icon: string; title: string; desc: string }[] = [
  { id: 'shop', icon: '🛍️', title: 'Dükkân', desc: 'Elmasla karakter, hayvan, yapı al' },
  { id: 'collection', icon: '📒', title: 'Koleksiyon defteri', desc: 'Topladığın eşyalar ve geçmiş ayların adaları' },
  { id: 'rewards', icon: '🎁', title: 'Ödül hedeflerim', desc: 'Ailenle koyduğunuz gerçek ödüller' },
  { id: 'courses', icon: '📚', title: 'Dersler', desc: 'Ders ekle, rengini değiştir, sil' },
  { id: 'parent', icon: '🔒', title: 'Aile paneli', desc: 'Ebeveyn için: haftalık özet, not, ödül, rapor ayarları' },
];

/** Profil: hesap bilgisi ve alt sayfalara bağlantılar. Aile kontrolü (rapor ayarları dahil) Aile panelinde. */
export default function Profile({
  email,
  demo,
  onSignOut,
  go,
}: {
  email?: string;
  demo: boolean;
  onSignOut?: () => void;
  go: (t: Target) => void;
}) {
  return (
    <div className="stack">
      <h1>Profil</h1>

      <LevelCard />
      <SkillsCard />
      <LookCard />

      <section className="card link-list">
        {LINKS.map((l) => (
          <button key={l.id} className="link-row" onClick={() => go(l.id)}>
            <span className="link-icon" aria-hidden>
              {l.icon}
            </span>
            <span className="grow">
              <strong>{l.title}</strong>
              <span className="muted small">{l.desc}</span>
            </span>
            <IconChevron />
          </button>
        ))}
      </section>

      <section className="card">
        <h2>Hesap</h2>
        <div className="row">
          <span className="grow">{demo ? 'Demo modu — veriler yalnızca bu tarayıcıda.' : email}</span>
          {onSignOut && (
            <button className="btn ghost sm" onClick={onSignOut}>
              Çıkış
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** Seviye: toplam çalışma saatiyle atlanır, her seviye gezintide yeni bir yetenek açar */
function LevelCard() {
  const { stats } = useGame();
  if (!stats) return null;
  const { level, next, progress, minutesLeft, index } = stats.level;
  return (
    <section className="card rank-card">
      <div className="level-top">
        <span className="level-icon" aria-hidden>
          {level.icon}
        </span>
        <span className="grow">
          <span className="muted small">Seviye {index + 1}</span>
          <strong className="level-name">{level.name}</strong>
        </span>
      </div>
      {next ? (
        <>
          <div className="pbar" aria-hidden>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="muted small">
            {next.icon} {next.name} için {formatMinutes(minutesLeft)} daha · açılacak: {next.perk.toLowerCase()}
          </div>
        </>
      ) : (
        <div className="muted small">En yüksek seviyedesin! 👑</div>
      )}
      <ul className="perk-list">
        {LEVELS.slice(1).map((l, i) => (
          <li key={l.name} className={i + 1 <= index ? 'on' : ''}>
            <span aria-hidden>{i + 1 <= index ? l.icon : '🔒'}</span> {l.perk}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ders yetenekleri: her ders bronz → gümüş → altın; en az çalışılan ders vurgulanır */
function SkillsCard() {
  const { stats } = useGame();
  if (!stats || !stats.skills.length) return null;
  return (
    <section className="card">
      <h2>Ders yeteneklerim</h2>
      <ul className="skill-list">
        {stats.skills.map((k) => {
          const next = TIERS[Math.min(3, k.tier + 1)];
          return (
            <li key={k.course.id} className={k.weakest ? 'weak' : ''}>
              <span className="skill-icon" aria-hidden style={{ background: k.course.color }}>
                {k.icon}
              </span>
              <span className="grow">
                <strong>
                  {k.course.name} · {k.tier ? `${TIERS[k.tier].icon} ${TIERS[k.tier].name} ` : ''}
                  {k.title}
                </strong>
                <span className="pbar" aria-hidden>
                  <span style={{ width: `${k.progress * 100}%`, background: k.course.color }} />
                </span>
                <span className="muted small">
                  {k.tier === 3 ? 'Altın! Bu derste ustasın.' : `${next.name} için ${formatMinutes(next.hours * 60 - k.minutes)} daha`}
                  {k.weakest && ' · Bunu da büyüt! 💪'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Görünüşüm: gezinti karakteri, aksesuar ve yanındaki hayvanlar */
function LookCard() {
  const { stats, equip } = useGame();
  if (!stats) return null;
  const e = stats.equipped;
  const mine = (cat: Item['category']) => ITEMS.filter((i) => i.category === cat && owns(i, stats.owned, stats.unlock));
  const slots = companionSlots(stats.level.index);
  const set = (next: Equipped) => equip(next).catch(() => {});
  return (
    <section className="card">
      <h2>Görünüşüm</h2>
      <div className="muted small">Karakter</div>
      <div className="pick-row">
        {mine('karakter').map((i) => (
          <button key={i.id} className={`pick${e.character === i.id ? ' on' : ''}`} aria-pressed={e.character === i.id} onClick={() => set({ ...e, character: i.id })}>
            <span aria-hidden>{i.icon}</span> {i.name}
          </button>
        ))}
      </div>
      {mine('aksesuar').length > 0 && (
        <>
          <div className="muted small">Aksesuar</div>
          <div className="pick-row">
            {mine('aksesuar').map((i) => (
              <button
                key={i.id}
                className={`pick${e.accessory === i.id ? ' on' : ''}`}
                aria-pressed={e.accessory === i.id}
                onClick={() => set({ ...e, accessory: e.accessory === i.id ? null : i.id })}
              >
                <span aria-hidden>{i.icon}</span> {i.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="muted small">
        Yanımdaki hayvan{slots > 1 ? 'lar (en çok 2)' : ''}
      </div>
      {mine('evcil').length ? (
        <div className="pick-row">
          {mine('evcil').map((i) => {
            const on = e.pets.includes(i.id);
            return (
              <button
                key={i.id}
                className={`pick${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => set({ ...e, pets: on ? e.pets.filter((p) => p !== i.id) : [...e.pets, i.id].slice(-slots) })}
              >
                <span aria-hidden>{i.icon}</span> {i.name}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted small">Dükkândan bir evcil hayvan alınca seninle gezer.</p>
      )}
    </section>
  );
}
