import ParentSettings from '../components/ParentSettings';

/** Profil: hesap bilgisi ve aile kontrolü (ebeveyn raporu ayarları). */
export default function Profile({ email, demo, onSignOut }: { email?: string; demo: boolean; onSignOut?: () => void }) {
  return (
    <div className="stack">
      <h1>Profil</h1>

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

      <ParentSettings />
    </div>
  );
}
