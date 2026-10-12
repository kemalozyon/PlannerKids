import ConfirmButton from './components/ConfirmButton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { localApi, supabaseApi } from './lib/api';
import { ApiContext } from './lib/ApiContext';
import { demoSeed } from './lib/demoSeed';
import { supabase } from './lib/supabase';
import type { Api, Course } from './lib/types';
import Courses from './pages/Courses';
import History from './pages/History';
import Today from './pages/Today';
import Forest from './pages/Forest';
import Library from './pages/Library';
import { ReadingProvider } from './lib/ReadingContext';
import Celebrations from './components/Celebrations';
import { GameProvider } from './lib/GameContext';

type Tab = 'today' | 'forest' | 'library' | 'history' | 'courses';
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Bugün' },
  { id: 'forest', label: 'Orman' },
  { id: 'library', label: 'Kitaplık' },
  { id: 'history', label: 'Geçmiş' },
  { id: 'courses', label: 'Dersler' },
];

function readTab(): Tab {
  const h = location.hash.slice(1);
  return (TABS.some((t) => t.id === h) ? h : 'today') as Tab;
}

export default function App() {
  // Supabase env yoksa demo modu
  if (!supabase) return <Shell api={DEMO_API} demo />;
  return <AuthGate />;
}

const DEMO_API = localApi(demoSeed);

function AuthGate() {
  const sb = supabase!;
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const api = useMemo(() => supabaseApi(sb), [sb]);

  if (session === undefined) return <div className="splash">Yükleniyor…</div>;
  if (!session) return <Login />;
  return <Shell api={api} email={session.user.email} onSignOut={() => sb.auth.signOut()} />;
}

function Login() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="login">
      <div className="card login-card">
        <div className="logo">◷</div>
        <h1>Çalışma Takip</h1>
        <p className="muted">Bugün ne çalıştın, ne kadar çalıştın, gün nasıl geçti?</p>
        <button
          className="btn google full"
          onClick={async () => {
            const { error } = await supabase!.auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo: location.origin + location.pathname },
            });
            if (error) setErr(error.message);
          }}
        >
          <GoogleIcon /> Google ile giriş yap
        </button>
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  );
}

function Shell({ api, demo, email, onSignOut }: { api: Api; demo?: boolean; email?: string; onSignOut?: () => void }) {
  const [tab, setTab] = useState<Tab>(readTab);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [plantIntent, setPlantIntent] = useState(false);
  const [plantBookId, setPlantBookId] = useState<string | null>(null);
  const clearIntent = useCallback(() => {
    setPlantIntent(false);
    setPlantBookId(null);
  }, []);
  const plantBook = (id: string) => {
    setPlantBookId(id);
    go('forest');
  };

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => {
    location.hash = t;
    setTab(t);
  };

  const reloadCourses = useCallback(() => {
    api.listCourses().then(setCourses);
  }, [api]);
  useEffect(reloadCourses, [reloadCourses]);

  return (
    <ApiContext.Provider value={api}>
      <GameProvider>
      <ReadingProvider>
      <div className="app">
        <nav className="topbar">
          <span className="brand">◷ Çalışma Takip</span>
          <div className="nav-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {onSignOut && (
            <button className="btn ghost sm" title={email} onClick={onSignOut}>
              Çıkış
            </button>
          )}
        </nav>
        {demo && (
          <div className="demo-banner">
            Demo modu — veriler yalnızca bu tarayıcıda saklanıyor.{' '}
            <ConfirmButton
              className="link"
              confirmLabel="Sıfırlamak için tekrar tıkla"
              onConfirm={() => {
                try {
                  localStorage.removeItem('ct-demo-db-v7');
                  localStorage.removeItem('ct-timer-v1');
                } catch {
                  /* yok say */
                }
                location.reload();
              }}
            >
              Örnek veriye sıfırla
            </ConfirmButton>
          </div>
        )}
        <main>
          {courses === null ? (
            <div className="splash">Yükleniyor…</div>
          ) : tab === 'today' ? (
            <Today
              courses={courses}
              goCourses={() => go('courses')}
              goForest={() => go('forest')}
              onPlant={() => {
                setPlantIntent(true);
                go('forest');
              }}
              reloadCourses={reloadCourses}
              goLibrary={() => go('library')}
              onPlantBook={plantBook}
              demo={!!demo}
            />
          ) : tab === 'forest' ? (
            <Forest courses={courses} startPlanting={plantIntent} plantBookId={plantBookId} onStarted={clearIntent} />
          ) : tab === 'library' ? (
            <Library onPlantBook={plantBook} />
          ) : tab === 'history' ? (
            <History courses={courses} />
          ) : (
            <Courses courses={courses} reload={reloadCourses} />
          )}
        </main>
        <Celebrations />
      </div>
      </ReadingProvider>
      </GameProvider>
    </ApiContext.Provider>
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
