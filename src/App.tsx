import ConfirmButton from './components/ConfirmButton';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEMO_KEY, localApi, supabaseApi } from './lib/api';
import { ApiContext } from './lib/ApiContext';
import { demoSeed } from './lib/demoSeed';
import { supabase } from './lib/supabase';
import type { Api, Course } from './lib/types';
import Courses from './pages/Courses';
import History from './pages/History';
import Today from './pages/Today';
import World from './pages/World';
import Library from './pages/Library';
import Profile from './pages/Profile';
import WeekPlan from './pages/WeekPlan';
import Rewards from './pages/Rewards';
import ParentPanel from './pages/ParentPanel';
import Collection from './pages/Collection';
import { ReadingProvider } from './lib/ReadingContext';
import Celebrations from './components/Celebrations';
import Login, { NewPassword } from './components/Login';
import { GameProvider, useGame } from './lib/GameContext';
import { SessionProvider, useSession } from './lib/SessionContext';
import { formatClock } from './lib/useTimer';
import { TOUR_EVENT, type TourMode } from './lib/tour';
import { openShop, placeNow, SHOP_EVENT } from './lib/shop';
import { STUDIO_EVENT, studioWanted } from './lib/thumbs';

const Tour = lazy(() => import('./components/Tour'));
const ShopWindow = lazy(() => import('./pages/Shop'));
const ThumbStudio = lazy(() => import('./components/ThumbStudio'));
import { IconBack, IconBook, IconCalendar, IconForest, IconToday, IconUser } from './components/Icons';

/** Alt menüdeki sekmeler */
type MainTab = 'today' | 'forest' | 'library' | 'history' | 'profile';
/** Bir sekmenin içinden açılan alt sayfalar */
type SubPage = 'plan' | 'rewards' | 'parent' | 'courses' | 'collection';
type Tab = MainTab | SubPage;

const TABS: { id: MainTab; label: string; icon: () => ReactNode }[] = [
  { id: 'today', label: 'Bugün', icon: IconToday },
  { id: 'forest', label: 'Dünyam', icon: IconForest },
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
  collection: { title: 'Koleksiyon defteri', parent: 'profile' },
};

const ALL: Tab[] = [...TABS.map((t) => t.id), ...(Object.keys(SUB) as SubPage[])];

function readTab(): Tab {
  const h = location.hash.slice(1);
  // Dükkân bir pencere: "#shop" Dünyam'ın üstünde açılır
  if (h === 'shop') return 'forest';
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

  // Tanıtım turu (Bugün'deki karşılama kartından ya da Profil'den başlar)
  const [tour, setTour] = useState<TourMode | null>(null);
  useEffect(() => {
    const on = (e: Event) => setTour((e as CustomEvent<TourMode>).detail);
    window.addEventListener(TOUR_EVENT, on);
    return () => window.removeEventListener(TOUR_EVENT, on);
  }, []);

  // Dükkân penceresi (her sayfanın üstünde) ve eşya resimlerini çizen gizli sahne
  const [shop, setShop] = useState(() => location.hash === '#shop');
  const [studio, setStudio] = useState(false);
  useEffect(() => {
    const on = () => setShop(true);
    const st = () => setStudio(true);
    if (studioWanted()) setStudio(true);
    window.addEventListener(SHOP_EVENT, on);
    window.addEventListener(STUDIO_EVENT, st);
    return () => {
      window.removeEventListener(SHOP_EVENT, on);
      window.removeEventListener(STUDIO_EVENT, st);
    };
  }, []);

  useEffect(() => {
    const onHash = () => {
      setShop(location.hash === '#shop');
      setTab(readTab());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const closeShop = useCallback(() => {
    setShop(false);
    if (location.hash === '#shop') history.replaceState(null, '', '#forest');
  }, []);

  const go = useCallback((t: Tab) => {
    location.hash = t;
    setTab(t);
    window.scrollTo(0, 0);
  }, []);
  /** Odadaki kitaplığı aç (kitap bitirince "Kitaplığımda gör") */
  const goShelf = () => {
    try {
      sessionStorage.setItem('ct-open-shelf', '1');
    } catch {
      /* yok say */
    }
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
          onShop={openShop}
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
              goShop={openShop}
              reloadCourses={reloadCourses}
              goLibrary={() => go('library')}
              demo={!!demo}
            />
          ) : tab === 'forest' ? (
            <GameLock goToday={() => go('today')}>
              <World courses={courses} goShop={openShop} />
            </GameLock>
          ) : tab === 'library' ? (
            <Library onShelf={goShelf} />
          ) : tab === 'history' ? (
            <History courses={courses} />
          ) : tab === 'courses' ? (
            <Courses courses={courses} reload={reloadCourses} />
          ) : tab === 'plan' ? (
            <WeekPlan courses={courses} goToday={() => go('today')} goCourses={() => go('courses')} />
          ) : tab === 'rewards' ? (
            <Rewards />
          ) : tab === 'collection' ? (
            <GameLock goToday={() => go('today')}>
              <Collection goWorld={() => go('forest')} />
            </GameLock>
          ) : tab === 'parent' ? (
            <ParentPanel courses={courses} goPlan={() => go('plan')} />
          ) : (
            <Profile email={email} demo={!!demo} onSignOut={onSignOut} go={go} />
          )}
        </main>
        <nav className="bottom-nav" aria-label="Ana menü" data-tour="nav">
          {TABS.map((t) => (
            <button key={t.id} className={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <span className="bn-icon">{t.icon()}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <Celebrations />
        <IdlePrompt />
        {shop && (
          <Suspense fallback={null}>
            <ShopWindow
              onClose={closeShop}
              goCollection={() => {
                closeShop();
                go('collection');
              }}
              onPlace={(id) => {
                closeShop();
                placeNow(id);
                if (tab !== 'forest') go('forest');
              }}
            />
          </Suspense>
        )}
        {studio && (
          <Suspense fallback={null}>
            <ThumbStudio />
          </Suspense>
        )}
        {tour && (
          <Suspense fallback={null}>
            <Tour mode={tour} onClose={() => setTour(null)} />
          </Suspense>
        )}
      </div>
      </ReadingProvider>
      </SessionProvider>
      </GameProvider>
    </ApiContext.Provider>
  );
}

/** Çalışma sürerken dünya, dükkân ve koleksiyon kapalı: önce bitir ya da ara ver (süre oyuna akmasın) */
function GameLock({ goToday, children }: { goToday: () => void; children: ReactNode }) {
  const ses = useSession();
  const [busy, setBusy] = useState(false);
  if (!ses.running) return <>{children}</>;
  return (
    <section className="card idle-card game-lock" role="status">
      <div className="idle-face" aria-hidden>
        ⏱
      </div>
      <h2>Çalışırken dünyan kapalı</h2>
      <p className="muted">Sayacın çalışıyor ({formatClock(ses.elapsedMs)}). Önce çalışmanı bitir ya da kısa bir ara ver; arada sayaç durur.</p>
      <div className="stack">
        <button className="btn primary big full" onClick={goToday}>
          Sayaca dön
        </button>
        <button
          className="btn full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            ses.pause('game').catch(() => {}).finally(() => setBusy(false));
          }}
        >
          ☕ Ara ver ve gir
        </button>
      </div>
    </section>
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
          <button className="chip coin" title="Ağaçlarım — dünyama git" onClick={onForest}>
            <span aria-hidden>🌳</span> {stats.treeCount}
          </button>
          <button className="chip gem" title="Elmaslarım — dükkân" onClick={onShop} data-tour="elmas">
            <span aria-hidden>💎</span> {stats.crystals}
          </button>
        </div>
      )}
    </header>
  );
}
