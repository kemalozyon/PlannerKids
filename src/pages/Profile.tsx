import { IconChevron } from '../components/Icons';

type Target = 'parent' | 'rewards' | 'courses';

const LINKS: { id: Target; icon: string; title: string; desc: string }[] = [
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
