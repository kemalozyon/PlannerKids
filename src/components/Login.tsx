import { useEffect, useState, type FormEvent } from 'react';
import { enabledProviders, supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup' | 'reset';

const redirectTo = () => location.origin + location.pathname;

/** Google girişi hata verirse Supabase hatayı adrese (hash ya da query) yazıp geri döner; okunur ve adresten silinir. */
function redirectError(): { code?: string; message: string } | null {
  const p = new URLSearchParams(location.hash.slice(1));
  const q = new URLSearchParams(location.search);
  const code = p.get('error_code') ?? q.get('error_code');
  const message = p.get('error_description') ?? q.get('error_description');
  if (!code && !message) return null;
  history.replaceState(null, '', location.pathname);
  return { code: code ?? undefined, message: message ?? 'Giriş yapılamadı.' };
}

/** Supabase hata kodlarını Türkçe, anlaşılır mesajlara çevirir. */
function authMessage(e: { code?: string; message: string }): string {
  switch (e.code) {
    case 'invalid_credentials':
      return 'E-posta ya da şifre hatalı.';
    case 'email_not_confirmed':
      return 'Önce e-postana gelen doğrulama bağlantısına tıkla.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Bu e-postayla zaten bir hesap var. Giriş yapmayı dene.';
    case 'weak_password':
      return 'Şifre çok zayıf. En az 6 karakter kullan.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar dene.';
    case 'email_address_not_authorized':
      return 'Bu adrese e-posta gönderilemiyor. Supabase\'de özel SMTP (ör. Resend) ayarlanmalı.';
    case 'same_password':
      return 'Yeni şifre eskisiyle aynı olamaz.';
    case 'signup_disabled':
      return 'Yeni hesap açılamıyor; bu uygulama yalnızca mevcut hesapla kullanılıyor.';
    default:
      return e.message;
  }
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  // Panelde "Allow new users to sign up" kapalıysa "Hesap oluştur" sekmesi gösterilmez.
  const [signup, setSignup] = useState(false);

  useEffect(() => {
    const e = redirectError();
    if (e) setErr(authMessage(e));
    enabledProviders().then((p) => {
      setGoogle(p.google);
      setSignup(p.signup);
    });
  }, []);

  const switchTo = (m: Mode) => {
    setMode(m);
    setErr(null);
    setInfo(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sb = supabase!;
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
        if (error) throw error;
        // E-posta doğrulaması açıksa oturum gelmez; açık değilse onAuthStateChange zaten içeri alır.
        if (!data.session) setInfo(`${email.trim()} adresine bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladıktan sonra giriş yapabilirsin.`);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
        if (error) throw error;
        setInfo('Bu adrese kayıtlı bir hesap varsa şifre yenileme bağlantısı gönderdik.');
      }
    } catch (e) {
      setErr(authMessage(e as { code?: string; message: string }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="card login-card">
        <div className="logo">◷</div>
        <h1>Çalışma Takip</h1>
        <p className="muted">Bugün ne çalıştın, ne kadar çalıştın, gün nasıl geçti?</p>

        {signup && mode !== 'reset' && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchTo('signin')}>
              Giriş yap
            </button>
            <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>
              Hesap oluştur
            </button>
          </div>
        )}

        <form onSubmit={submit}>
          {mode === 'reset' && <p className="muted small">E-postanı yaz, şifreni yenilemen için bir bağlantı gönderelim.</p>}
          <label className="field">
            <span>E-posta</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@eposta.com" />
          </label>
          {mode !== 'reset' && (
            <label className="field">
              <span>Şifre{mode === 'signup' ? ' (en az 6 karakter)' : ''}</span>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {err && <div className="error">{err}</div>}
          {info && <div className="notice">{info}</div>}
          <button className="btn primary full" disabled={busy}>
            {busy ? 'Bekle…' : mode === 'signin' ? 'Giriş yap' : mode === 'signup' ? 'Hesap oluştur' : 'Bağlantı gönder'}
          </button>
        </form>

        <div className="login-links">
          {mode === 'signin' && (
            <button className="link" onClick={() => switchTo('reset')}>
              Şifremi unuttum
            </button>
          )}
          {mode === 'reset' && (
            <button className="link" onClick={() => switchTo('signin')}>
              Girişe dön
            </button>
          )}
        </div>

        {google && mode !== 'reset' && (
          <>
            <div className="login-or">
              <span>ya da</span>
            </div>
            <button
              className="btn google full"
              onClick={async () => {
                const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
                if (error) setErr(authMessage(error));
              }}
            >
              <GoogleIcon /> Google ile giriş yap
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Şifre yenileme bağlantısıyla gelindiğinde yeni şifre sorulur. */
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="login">
      <div className="card login-card">
        <div className="logo">◷</div>
        <h1>Yeni şifre</h1>
        <p className="muted">Hesabın için yeni bir şifre belirle.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            const { error } = await supabase!.auth.updateUser({ password });
            setBusy(false);
            if (error) setErr(authMessage(error));
            else onDone();
          }}
        >
          <label className="field">
            <span>Yeni şifre (en az 6 karakter)</span>
            <input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {err && <div className="error">{err}</div>}
          <button className="btn primary full" disabled={busy}>
            {busy ? 'Bekle…' : 'Şifreyi kaydet'}
          </button>
        </form>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
