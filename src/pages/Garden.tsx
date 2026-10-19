// Bahçem: ağaç bahçeleri ayrı bir sayfa (süslenmez). Her ay bir bahçe (Eylül 2026 – Haziran 2027); çalışılan her
// gün o ayın bahçesinde kendi yerine (takvim düzeni) bir ağaç dikilir: türü günün tohumundan, büyüklüğü günün
// toplamından (Fidan · Genç · Tam · Nadir). O günün Elması ağacında bekler (💎); ağaca dokununca gün kartı açılır,
// "Elmas'ı al" ile kumbaraya geçer (economy.ts → claimable, claim_day). Altta aynı ay bir takvim olarak da durur
// (3D yoksa yalnızca o).
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import DaySheet from '../components/DaySheet';
import { CFG } from '../lib/config';
import { dayPhase } from '../lib/dayPhase';
import { toLocalDate } from '../lib/date';
import { formatMonth } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import { loadQuality } from '../lib/gfx';
import { sfx } from '../lib/sfx';
import type { Course } from '../lib/types';
import { hasWebGL } from '../lib/webgl';
import { daysIn, monthState, seasonMonths } from '../lib/world';

const GardenView = lazy(() => import('../components/world3d/GardenView'));

/** Büyüme animasyonu oynatılan ağaçlar (gün:aşama) */
const GROWN_KEY = 'ct-grown-v2';
const readGrown = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(GROWN_KEY) ?? '[]');
  } catch {
    return [];
  }
};

export default function Garden({ courses, goToday }: { courses: Course[]; goToday: () => void }) {
  const { stats } = useGame();
  const today = toLocalDate();
  const thisMonth = today.slice(0, 7);
  const months = useMemo(seasonMonths, []);
  const [month, setMonth] = useState(() => (months.includes(thisMonth) ? thisMonth : months.filter((m) => monthState(m, today) === 'open').at(-1) ?? months[0]));
  const [day, setDay] = useState<string | null>(null);
  const [grown, setGrown] = useState(readGrown);
  const can3D = useMemo(hasWebGL, []);
  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  const quality = useMemo(loadQuality, []);
  useEffect(() => {
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!stats) return <div className="splash">Yükleniyor…</div>;

  const state = monthState(month, today);
  const trees = stats.forest.filter((t) => t.month === month);
  const byDate = new Map(trees.map((t) => [t.date, t]));
  const dateOf = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
  const gems = new Map<number, number>();
  for (const [date, n] of stats.treeElmas) if (date.startsWith(`${month}-`)) gems.set(Number(date.slice(8, 10)), n);
  const monthGems = [...gems.values()].reduce((a, b) => a + b, 0);
  // Bugünün ağacı yeni dikildiyse ya da büyüdüyse bir kez büyüme animasyonu
  const todayTree = stats.forest.find((t) => t.date === today);
  const growKey = todayTree ? `${todayTree.id}:${todayTree.stageIndex}` : null;
  const growId = month === thisMonth && growKey && !grown.includes(growKey) ? todayTree!.id : null;
  const markGrown = () => {
    if (!growKey) return;
    const next = [...grown, growKey].slice(-40);
    setGrown(next);
    try {
      localStorage.setItem(GROWN_KEY, JSON.stringify(next));
    } catch {
      /* yok say */
    }
  };
  const open = (date: string) => {
    sfx.pop();
    setDay(date);
  };
  const lead = (() => {
    const [y, m] = month.split('-').map(Number);
    return (new Date(y, m - 1, 1).getDay() + 6) % 7;
  })();
  const sheetTree = day ? (stats.forest.find((t) => t.date === day) ?? null) : null;

  return (
    <div className="stack garden-page">
      <section className="card garden-head">
        <div className="card-head">
          <h2>🌳 Bahçem</h2>
          <span className="muted small">{stats.treeCount} ağaç</span>
        </div>
        {stats.treeElmasTotal > 0 ? (
          <p className="garden-gems">
            💎 Ağaçlarında <strong>{stats.treeElmasTotal} Elmas</strong> bekliyor. Parlayan taşı olan ağaca dokun, Elmasını al.
          </p>
        ) : (
          <p className="muted small">Çalıştığın her gün bahçende bir ağaç büyür ve o günün Elması ağacına düşer. Ağaca dokunup alırsın; hiç kaybolmaz.</p>
        )}
      </section>

      <div className="month-chips garden-months" role="tablist" aria-label="Aylar">
        {months.map((m) => {
          const st = monthState(m, today);
          const n = stats.forest.filter((t) => t.month === m).length;
          const g = [...stats.treeElmas].some(([d]) => d.startsWith(`${m}-`));
          return (
            <button key={m} role="tab" aria-selected={m === month} className={`chip${m === month ? ' on' : ''}${st !== 'open' ? ' locked' : ''}`} onClick={() => setMonth(m)}>
              {st !== 'open' ? '🔒 ' : ''}
              {formatMonth(m).split(' ')[0].slice(0, 3)}
              {st === 'open' && <span className="muted"> {n}</span>}
              {g && <span aria-label="Elmas bekliyor"> 💎</span>}
            </button>
          );
        })}
      </div>

      {can3D && (
        <div className="world-wrap garden-wrap" data-tour="garden">
          <Suspense fallback={<div className="world-loading">🌳 Bahçen hazırlanıyor…</div>}>
            <GardenView
              key={month}
              month={month}
              trees={trees}
              locked={state === 'locked'}
              today={today}
              phase={phase}
              quality={quality}
              creatures={stats.creatures}
              gems={gems}
              growId={growId}
              onGrown={markGrown}
              onTree={(t) => open(t.date)}
              onPlot={(d) => open(dateOf(d))}
            />
          </Suspense>
          <div className="world-top">
            <span className="world-chip">🌳 {formatMonth(month)}</span>
            <span className="grow" />
            {monthGems > 0 && <span className="world-chip">💎 {monthGems}</span>}
          </div>
          {state === 'locked' && (
            <div className="world-locked" role="status">
              <span>🔒 {formatMonth(month)} bahçesi ayın ilk günü açılır.</span>
            </div>
          )}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{formatMonth(month)}</h2>
          <span className="muted small">{trees.length} ağaç</span>
        </div>
        <div className="garden-cal" role="grid" aria-label={`${formatMonth(month)} takvimi`}>
          {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map((d) => (
            <span key={d} className="gc-head" aria-hidden>
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysIn(month) }, (_, i) => {
            const date = dateOf(i + 1);
            const t = byDate.get(date);
            const g = gems.get(i + 1);
            const future = date > today;
            return (
              <button
                key={date}
                className={`gc-day${t ? ' tree' : ''}${g ? ' gem' : ''}${date === today ? ' today' : ''}`}
                disabled={future || state !== 'open'}
                aria-label={`${i + 1}. gün${t ? `: ${t.name}` : ''}${g ? `, ${g} Elmas bekliyor` : ''}`}
                onClick={() => open(date)}
              >
                <span className="gc-n">{i + 1}</span>
                <span className="gc-tree" aria-hidden>
                  {t ? t.species.icon : ''}
                </span>
                {g ? <span className="gc-gem">💎{g}</span> : null}
              </button>
            );
          })}
        </div>
        <p className="muted small">
          Ağacın büyüklüğü o gün ne kadar çalıştığına bağlı: {CFG.world.stages.map((s) => `${s.name} ${s.min}+`).join(' · ')} dk. Bir günde {CFG.world.drop.minutes} dk sayaçla çalışırsan ağacın
          dibinden nadir bir eşya da çıkar.
        </p>
        {!todayTree && (
          <button className="btn" onClick={goToday}>
            ⏱ Bugünün ağacını dik
          </button>
        )}
      </section>

      {day && <DaySheet date={day} tree={sheetTree} minutes={stats.dayTotals.get(day) ?? 0} courses={courses} onClose={() => setDay(null)} />}
    </div>
  );
}
