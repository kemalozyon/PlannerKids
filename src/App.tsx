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
import Profile from './pages/Profile';
import { ReadingProvider } from './lib/ReadingContext';
import Celebrations from './components/Celebrations';
import Login, { NewPassword } from './components/Login';
import { GameProvider } from './lib/GameContext';

type Tab = 'today' | 'forest' | 'library' | 'history' | 'courses' | 'profile';
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Bugün' },
  { id: 'forest', label: 'Orman' },
  { id: 'library', label: 'Kitaplık' },
  { id: 'history', label: 'Geçmiş' },
  { id: 'courses', label: 'Dersler' },
  { id: 'profile', label: 'Profil' },
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
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((e, s) => {
      setSession(s);
      // Şifre yenileme bağlantısıyla gelindi: önce yeni şifre sorulur
      if (e === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const api = useMemo(() => supabaseApi(sb), [sb]);

  if (session === undefined) return <div className="splash">Yükleniyor…</div>;
  if (!session) return <Login />;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;
  return <Shell api={api} email={session.user.email} onSignOut={() => sb.auth.signOut()} />;
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
              goProfile={() => go('profile')}
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
          ) : tab === 'courses' ? (
            <Courses courses={courses} reload={reloadCourses} />
          ) : (
            <Profile email={email} demo={!!demo} onSignOut={onSignOut} />
          )}
        </main>
        <Celebrations />
      </div>
      </ReadingProvider>
      </GameProvider>
    </ApiContext.Provider>
  );
}
