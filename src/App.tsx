import ConfirmButton from './components/ConfirmButton';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEMO_KEY, localApi, supabaseApi } from './lib/api';
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
import WeekPlan from './pages/WeekPlan';
import Rewards from './pages/Rewards';
import ParentPanel from './pages/ParentPanel';
import Shop from './pages/Shop';
import Collection from './pages/Collection';
import { ReadingProvider } from './lib/ReadingContext';
import Celebrations from './components/Celebrations';
import Login, { NewPassword } from './components/Login';
import { GameProvider, useGame } from './lib/GameContext';
import { SessionProvider, useSession } from './lib/SessionContext';
import { formatClock } from './lib/useTimer';
import { IconBack, IconBook, IconCalendar, IconForest, IconToday, IconUser } from './components/Icons';

/** Alt menüdeki sekmeler */
type MainTab = 'today' | 'forest' | 'library' | 'history' | 'profile';
/** Bir sekmenin içinden açılan alt sayfalar */
type SubPage = 'plan' | 'rewards' | 'parent' | 'courses' | 'shop' | 'collection';
type Tab = MainTab | SubPage;

const TABS: { id: MainTab; label: string; icon: () => ReactNode }[] = [
  { id: 'today', label: 'Bugün', icon: IconToday },
  { id: 'forest', label: 'Orman', icon: IconForest },
  { id: 'library', label: 'Kitaplık', icon: IconBook },
  { id: 'history', label: 'Geçmiş', icon: IconCalendar },
  { id: 'profile', label: 'Profil', icon: IconUser },
];

/** Alt sayfanın başlığı ve hangi sekmenin altında olduğu (geri tuşu oraya döner) */
const SUB: Record<SubPage, { title: string; parent: MainTab }> = {
  plan: { title: 'Haftalık planım', parent: 'today' },
  rewards: { title: 'Ödül hedeflerim', parent: 'profile' },
  parent: { title: 'Aile paneli', parent: 'profile' },
  courses: { title: 'Dersler', parent: 'profile' },
  shop: { title: 'Dükkân', parent: 'forest' },
  collection: { title: 'Koleksiyon defteri', parent: 'profile' },
};

const ALL: Tab[] = [...TABS.map((t) => t.id), ...(Object.keys(SUB) as SubPage[])];

function readTab(): Tab {
  const h = location.hash.slice(1);
  return (ALL.includes(h as Tab) ? h : 'today') as Tab;
}

const isSub = (t: Tab): t is SubPage => t in SUB;

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

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((t: Tab) => {
    location.hash = t;
    setTab(t);
    window.scrollTo(0, 0);
  }, []);
  const plantBook = (id: string) => {
    setPlantBookId(id);
    go('forest');
  };

  const reloadCourses = useCallback(() => {
    api.listCourses().then(setCourses);
  }, [api]);
  useEffect(reloadCourses, [reloadCourses]);

  const active: MainTab = isSub(tab) ? SUB[tab].parent : tab;

  return (
    <ApiContext.Provider value={api}>
      <GameProvider>
      <SessionProvider>
      <ReadingProvider>
      <div className="app">
        <TopBar
          sub={isSub(tab) ? tab : null}
          onBack={() => isSub(tab) && go(SUB[tab].parent)}
          onForest={() => go('forest')}
          onShop={() => go('shop')}
          onToday={tab === 'today' ? null : () => go('today')}
        />
        {demo && (
          <div className="demo-banner">
            Demo modu — veriler yalnızca bu tarayıcıda saklanıyor.{' '}
            <ConfirmButton
              className="link"
              confirmLabel="Sıfırlamak için tekrar tıkla"
              onConfirm={() => {
                try {
                  localStorage.removeItem(DEMO_KEY);
                  localStorage.removeItem('ct-timer-v1');
                  localStorage.removeItem('ct-goal-v1');
                  localStorage.removeItem('ct-break-v1');
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
              goProfile={() => go('parent')}
              goForest={() => go('forest')}
              goPlan={() => go('plan')}
              goRewards={() => go('rewards')}
              goShop={() => go('shop')}
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
          ) : tab === 'plan' ? (
            <WeekPlan courses={courses} goToday={() => go('today')} goCourses={() => go('courses')} />
          ) : tab === 'rewards' ? (
            <Rewards />
          ) : tab === 'shop' ? (
            <Shop goCollection={() => go('collection')} />
          ) : tab === 'collection' ? (
            <Collection />
          ) : tab === 'parent' ? (
            <ParentPanel courses={courses} goPlan={() => go('plan')} />
          ) : (
            <Profile email={email} demo={!!demo} onSignOut={onSignOut} go={go} />
          )}
        </main>
        <nav className="bottom-nav" aria-label="Ana menü">
          {TABS.map((t) => (
            <button key={t.id} className={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <span className="bn-icon">{t.icon()}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <Celebrations />
        <IdlePrompt />
      </div>
      </ReadingProvider>
      </SessionProvider>
      </GameProvider>
    </ApiContext.Provider>
  );
}

/** Uzun süre dokunulmadıysa: "Hâlâ çalışıyor musun?" — cevap gelmezse seans duraklar (SessionContext) */
function IdlePrompt() {
  const ses = useSession();
  if (ses.idleAsk == null) return null;
  const left = Math.max(0, Math.ceil((ses.idleAsk - ses.now) / 1000));
  return (
    <div className="idle-overlay" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="card idle-card">
        <div className="idle-face" aria-hidden>
          👀
        </div>
        <h2 id="idle-title">Hâlâ çalışıyor musun?</h2>
        <p className="muted">Bir süredir ekrana dokunmadın. {left} saniye içinde cevap gelmezse sayaç durur.</p>
        <button className="btn primary big full" onClick={ses.stillHere} autoFocus>
          Evet, çalışıyorum
        </button>
      </div>
    </div>
  );
}

/** Üst çubuk: ana sekmelerde marka + seri + cüzdan; alt sayfalarda geri tuşu + başlık. Seans açıkken başka sekmede süre görünür. */
function TopBar({
  sub,
  onBack,
  onForest,
  onShop,
  onToday,
}: {
  sub: SubPage | null;
  onBack: () => void;
  onForest: () => void;
  onShop: () => void;
  onToday: (() => void) | null;
}) {
  const { stats } = useGame();
  const ses = useSession();
  return (
    <header className="topbar">
      {sub ? (
        <>
          <button className="icon-btn back" aria-label="Geri" onClick={onBack}>
            <IconBack />
          </button>
          <span className="brand">{SUB[sub].title}</span>
        </>
      ) : (
        <span className="brand">◷ Çalışma Takip</span>
      )}
      {stats && (
        <div className="top-chips">
          {ses.session && onToday && (
            <button className={`chip timer-chip${ses.paused ? ' off' : ''}`} title="Çalışma sayacı — Bugün'e git" onClick={onToday}>
              <span aria-hidden>{ses.paused ? '⏸' : '⏱'}</span> {formatClock(ses.elapsedMs)}
            </button>
          )}
          <span className={`chip streak${stats.streak === 0 ? ' off' : ''}`} title="Seri">
            <span aria-hidden>🔥</span> {stats.streak}
          </span>
          <button className="chip coin" title="Bugünkü cüzdanım — ormana git" onClick={onForest}>
            <span aria-hidden>🪙</span> {stats.today.left}
          </button>
          <button className="chip gem" title="Elmaslarım — dükkân" onClick={onShop}>
            <span aria-hidden>💎</span> {stats.crystals}
          </button>
        </div>
      )}
    </header>
  );
}
