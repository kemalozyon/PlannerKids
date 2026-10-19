import { openShop } from '../lib/shop';
import { IconChevron } from '../components/Icons';
import { CFG } from '../lib/config';
import { startTour } from '../lib/tour';
import { companionSlots, itemById, ITEMS, type Item } from '../lib/catalog';
import { lazy, Suspense, useMemo, useState } from 'react';
import { lookParts } from '../lib/avatar';
import { hasWebGL } from '../lib/webgl';
import { formatMinutes } from '../lib/date';
import { owns } from '../lib/economy';
import { useGame } from '../lib/GameContext';
import { LEVELS, TIERS } from '../lib/level';
import type { Equipped } from '../lib/types';

const AvatarPreview = lazy(() => import('../components/avatar/AvatarPreview'));
const AvatarEditor = lazy(() => import('../components/avatar/AvatarEditor'));

type Target = 'parent' | 'rewards' | 'courses' | 'collection';

const LINKS: { id: Target | 'shop'; icon: string; title: string; desc: string }[] = [
  { id: 'shop', icon: '🛍️', title: 'Dükkân', desc: 'Elmasla mobilya, bahçe süsü ve kıyafet al' },
  { id: 'collection', icon: '📒', title: 'Koleksiyon defteri', desc: 'Topladığın eşyalar ve ağaç bahçelerin' },
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

      <LookCard />
      <LevelCard />
      <BadgesCard />
      <SkillsCard />

      <section className="card link-list">
        {LINKS.map((l) => (
          <button key={l.id} className="link-row" onClick={() => (l.id === 'shop' ? openShop() : go(l.id))}>
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
        <button className="link-row" onClick={() => startTour('audio')}>
          <span className="link-icon" aria-hidden>
            🎬
          </span>
          <span className="grow">
            <strong>Tanıtımı izle</strong>
            <span className="muted small">Sesli ya da yazılı 5 dakikalık tur</span>
          </span>
          <IconChevron />
        </button>
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
    <section className="card rank-card" data-tour="level">
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

/** Karakterim: parça parça avatar (düzenleyici tam ekran açılır) ve yanındaki hayvanlar */
function LookCard() {
  const { stats, equip } = useGame();
  const [editing, setEditing] = useState(false);
  const can3D = useMemo(hasWebGL, []);
  if (!stats) return null;
  const e = stats.equipped;
  const pets = ITEMS.filter((i) => i.category === 'evcil' && owns(i, stats.owned, stats.unlock));
  const slots = companionSlots(stats.level.index);
  const set = (next: Equipped) => equip(next).catch(() => {});
  const worn = lookParts(e.look).map((id) => itemById(id)).filter((i): i is Item => !!i);
  return (
    <section className="card look-card" data-tour="avatar">
      <div className="card-head">
        <h2>Karakterim</h2>
        <button className="btn sm primary" onClick={() => setEditing(true)}>
          ✏️ Düzenle
        </button>
      </div>
      <div className="look-row">
        {can3D ? (
          <Suspense fallback={<div className="avatar-preview" />}>
            <AvatarPreview look={e.look} />
          </Suspense>
        ) : (
          <div className="avatar-preview emoji">🧒</div>
        )}
        <div className="grow">
          <p className="small">{worn.map((i) => `${i.icon} ${i.name}`).join(' · ')}</p>
          <p className="muted small">Saçını, kıyafetlerini, şapkanı, gözlüğünü ve sırt çantanı seç. Bazı parçalar ücretsiz, bazıları çalışarak kazandığın 💎 Elmasla alınır.</p>
        </div>
      </div>
      <div className="muted small">
        Yanımdaki hayvan{slots > 1 ? 'lar (en çok 2)' : ''}
      </div>
      {pets.length ? (
        <div className="pick-row">
          {pets.map((i) => {
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
        <p className="muted small">Bahçelerinde ağaçlar çoğaldıkça hayvanlar kendiliğinden gelir.</p>
      )}
      {editing && (
        <Suspense fallback={null}>
          <AvatarEditor onClose={() => setEditing(false)} />
        </Suspense>
      )}
    </section>
  );
}

const STREAK_TIERS = CFG.elmas.streak.tiers;

/** Rozetler ve kademeli serinin kuralı */
function BadgesCard() {
  const { stats } = useGame();
  if (!stats) return null;
  const unlocked = stats.badges.filter((b) => b.unlocked).length;
  const nextBadge = stats.badges.filter((b) => !b.unlocked).sort((a, b) => b.progress - a.progress)[0];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Rozetlerim</h2>
        <span className="muted small tabular">
          {unlocked}/{stats.badges.length}
        </span>
      </div>
      {nextBadge && (
        <p className="muted small next-badge">
          Sıradaki: <strong>{nextBadge.title}</strong> — {nextBadge.desc.toLowerCase()} ({nextBadge.hint})
        </p>
      )}
      <ul className="badges">
        {stats.badges.map((b) => (
          <li key={b.id} className={b.unlocked ? 'on' : ''} title={b.desc}>
            <span className="badge-icon" aria-hidden>
              {b.icon}
            </span>
            <span className="badge-title">{b.title}</span>
            <span className="badge-desc">{b.desc}</span>
            {!b.unlocked && (
              <span className="badge-progress">
                <span style={{ width: `${b.progress * 100}%` }} />
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="rules muted small">
        <strong>Seri nasıl işler?</strong> Sayaçla çalıştığın her gün serin 1 büyür. Hafta sonu dinlenmek seriyi bozmaz.
        Hafta içi bir günü kaçırırsan serin sıfırlanmaz, bir kademe düşer ({STREAK_TIERS.map((t) => t.days).join(' → ')} gün).
        Kademen yükseldikçe her gün fazladan Elmas kazanırsın.{' '}
        {stats.streakTier > 0 && <span className="pill">Kademe {stats.streakTier}: günde +{STREAK_TIERS[stats.streakTier - 1].bonus} 💎</span>}
      </div>
    </section>
  );
}
