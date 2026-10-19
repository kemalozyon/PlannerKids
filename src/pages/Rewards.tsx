import { useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { formatShort } from '../lib/date';
import { useGame } from '../lib/GameContext';
import { useReading } from '../lib/ReadingContext';
import { kindOf, openRewards, type RewardProgress } from '../lib/rewards';
import type { Reward, RewardKind } from '../lib/types';

const ICONS: Record<RewardKind, string> = { minutes: '⏱️', streak: '🔥', books: '📚', plans: '📋' };

/** Çocuğun gördüğü ödül hedefleri. Ödülleri ebeveyn Aile panelinden ekler ve "verildi" işaretler. */
export default function Rewards() {
  const api = useApi();
  const { stats } = useGame();
  const reading = useReading();
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRewards()
      .then(setRewards)
      .catch((e) => {
        setError((e as Error).message);
        setRewards([]);
      });
  }, [api]);

  if (!rewards || !stats) return <div className="splash">Yükleniyor…</div>;
  const open = openRewards(rewards, { dayTotals: stats.dayTotals, streak: stats.streak, books: reading.books, planDays: stats.planDays });
  const claimed = rewards.filter((r) => r.claimed_on).sort((a, b) => b.claimed_on!.localeCompare(a.claimed_on!));
  const [top, ...rest] = open;

  return (
    <div className="stack">
      <p className="muted">Ailenle birlikte koyduğunuz gerçek ödüller. Ödüller Elmasını harcamaz, sadece ilerlemeni sayar.</p>
      {error && <div className="error">{error}</div>}

      {top ? (
        <section className={`card reward-hero${top.reached ? ' reached' : ''}`} data-tour="rewards">
          <div className="reward-hero-head">
            <span className="reward-big-icon" aria-hidden>
              {top.reached ? '🎉' : '🎁'}
            </span>
            <div className="grow">
              <div className="eyebrow">{top.reached ? 'KAZANDIN!' : 'SIRADAKİ ÖDÜL'}</div>
              <div className="reward-title">{top.reward.title}</div>
              <div className="muted small">
                {top.reward.given_by ? `${top.reward.given_by} koydu · ` : ''}
                {kindOf(top.reward.kind).label.toLowerCase()}
              </div>
            </div>
          </div>
          <div className="reward-bar" aria-hidden>
            <span style={{ width: `${Math.max(0.02, top.pct) * 100}%` }} />
          </div>
          <div className="reward-meta">
            <strong>
              {top.value} / {top.reward.target} {kindOf(top.reward.kind).unit}
            </strong>
            <span className="muted">{top.reached ? 'Ailene göster, ödülünü versinler!' : top.leftText}</span>
          </div>
        </section>
      ) : (
        <section className="card empty" data-tour="rewards">
          <div className="reward-big-icon" aria-hidden>
            🎁
          </div>
          <h2>Henüz ödül hedefi yok</h2>
          <p className="muted">Annen ya da baban Profil › Aile paneli'nden bir ödül ekleyebilir. Mesela "600 dakika çalışınca sinema".</p>
        </section>
      )}

      {rest.length > 0 && (
        <section className="card">
          <h2>Diğer hedefler</h2>
          <ul className="list">
            {rest.map((p) => (
              <RewardRow key={p.reward.id} p={p} />
            ))}
          </ul>
        </section>
      )}

      {claimed.length > 0 && (
        <section className="card">
          <h2>Kazandıklarım</h2>
          <ul className="list">
            {claimed.map((r) => (
              <li key={r.id} className="row">
                <span className="plan-check done" aria-hidden>
                  ✓
                </span>
                <span className="grow">{r.title}</span>
                <span className="muted small">{formatShort(r.claimed_on!)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RewardRow({ p }: { p: RewardProgress }) {
  const k = kindOf(p.reward.kind);
  return (
    <li className="row reward-row">
      <span className="reward-icon" aria-hidden>
        {ICONS[p.reward.kind]}
      </span>
      <div className="grow">
        <div className="reward-row-head">
          <strong>{p.reward.title}</strong>
          <span className="muted small tabular">
            {p.value}/{p.reward.target}
          </span>
        </div>
        <div className="muted small">
          {k.label} {p.reward.given_by ? `· ${p.reward.given_by}` : ''} {p.reached ? '· Hedefe ulaştın! 🎉' : ''}
        </div>
        <div className="pbar gold" aria-hidden>
          <span style={{ width: `${p.pct * 100}%` }} />
        </div>
      </div>
    </li>
  );
}
