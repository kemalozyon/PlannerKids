import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmButton from '../components/ConfirmButton';
import ParentSettings from '../components/ParentSettings';
import { useApi } from '../lib/ApiContext';
import { addDays, formatMinutes, formatShort, toLocalDate, weekStart } from '../lib/date';
import { hashPin, isUnlocked, setUnlocked, validPin } from '../lib/family';
import { itemById } from '../lib/catalog';
import { CFG } from '../lib/config';
import { GIFT_MAX } from '../lib/economy';
import { LEDGER_LABEL } from '../lib/game';
import { useGame } from '../lib/GameContext';
import { MOODS } from '../lib/mood';
import { useReading } from '../lib/ReadingContext';
import { kindOf, REWARD_KINDS, rewardProgress } from '../lib/rewards';
import type { Course, FamilySettings, ParentNote, PlanItem, Reflection, Reward, RewardKind } from '../lib/types';

const QUICK_NOTES = ['Aferin! 👏', 'Seninle gurur duyuyorum!', 'Yarın da böyle devam 💪', 'Bugün biraz dinlen, hak ettin.'];

/** Aile paneli: PIN ile açılır. Haftalık özet, plan onayı, not, ödüller ve günlük rapor ayarları. */
export default function ParentPanel({ courses, goPlan }: { courses: Course[]; goPlan: () => void }) {
  const api = useApi();
  const [family, setFamily] = useState<FamilySettings | null>(null);
  const [unlocked, setUnlockedState] = useState(isUnlocked);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getFamily()
      .then(setFamily)
      .catch((e) => setError(`Aile ayarları okunamadı: ${(e as Error).message}. 0005_plans_family.sql çalıştırıldı mı?`));
  }, [api]);

  const saveFamily = async (f: FamilySettings) => {
    await api.setFamily(f);
    setFamily(f);
  };

  if (error) return <div className="error">{error}</div>;
  if (!family) return <div className="splash">Yükleniyor…</div>;
  if (!family.pin_hash || !unlocked) {
    return (
      <PinGate
        family={family}
        onSetPin={async (hash) => {
          await saveFamily({ ...family, pin_hash: hash });
          setUnlocked(true);
          setUnlockedState(true);
        }}
        onUnlock={() => {
          setUnlocked(true);
          setUnlockedState(true);
        }}
      />
    );
  }

  return (
    <div className="stack">
      <div className="actions">
        <span className="pill ok">🔓 PIN ile açıldı</span>
        <button
          className="btn ghost sm"
          onClick={() => {
            setUnlocked(false);
            setUnlockedState(false);
          }}
        >
          Kilitle
        </button>
      </div>
      <WeekSummary />
      <PlanApproval family={family} onChange={saveFamily} courses={courses} goPlan={goPlan} />
      <NotesCard />
      <RewardsAdmin />
      <EconomyAdmin />
      <ParentSettings />
      <PinChange family={family} onChange={saveFamily} />
    </div>
  );
}

function PinGate({
  family,
  onSetPin,
  onUnlock,
}: {
  family: FamilySettings;
  onSetPin: (hash: string) => Promise<void>;
  onUnlock: () => void;
}) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState('');
  const creating = !family.pin_hash;

  return (
    <section className="card pin-card">
      <div className="pin-icon" aria-hidden>
        🔒
      </div>
      <h2>{creating ? 'Aile paneli için PIN belirle' : 'Aile paneli kilitli'}</h2>
      <p className="muted small">
        {creating
          ? 'Bu bölüm ebeveyn içindir. 4 haneli bir PIN seçin; çocuğunuz bilmesin.'
          : 'Devam etmek için ebeveyn PIN’ini girin.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!validPin(pin)) return setMsg('PIN 4 rakam olmalı.');
          if (creating) {
            if (pin !== pin2) return setMsg('PIN’ler aynı değil.');
            await onSetPin(await hashPin(pin));
          } else if ((await hashPin(pin)) === family.pin_hash) onUnlock();
          else {
            setMsg('PIN yanlış.');
            setPin('');
          }
        }}
      >
        <label className="field">
          <span>PIN</span>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setMsg('');
            }}
            autoFocus
          />
        </label>
        {creating && (
          <label className="field">
            <span>PIN (tekrar)</span>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin2}
              onChange={(e) => {
                setPin2(e.target.value.replace(/\D/g, ''));
                setMsg('');
              }}
            />
          </label>
        )}
        {msg && <div className="error">{msg}</div>}
        <button className="btn primary full">{creating ? 'PIN’i kaydet ve aç' : 'Aç'}</button>
      </form>
      {!creating && <p className="muted small">PIN’i unuttuysanız: Supabase'de family_settings tablosundaki pin_hash'i silin.</p>}
    </section>
  );
}

/** Bu haftanın özeti: çalışma / plan, seri, son 7 günün ruh hali ve nazik bir uyarı. */
function WeekSummary() {
  const api = useApi();
  const { stats } = useGame();
  const today = toLocalDate();
  const monday = weekStart(today);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [refs, setRefs] = useState<Reflection[]>([]);
  useEffect(() => {
    api.listPlans(monday, today).then(setPlans).catch(() => setPlans([]));
    api.listReflections(addDays(today, -6), today).then(setRefs);
  }, [api, monday, today]);
  if (!stats) return null;

  let studied = 0;
  for (let d = monday; d <= today; d = addDays(d, 1)) studied += stats.dayTotals.get(d) ?? 0;
  const planned = plans.reduce((s, p) => s + p.minutes, 0);
  const rated = refs.filter((r) => r.rating != null);
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.rating!, 0) / rated.length) : null;
  const recentHard = refs.filter((r) => r.date >= addDays(today, -3) && r.rating != null && r.rating <= 2).length;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Bu hafta</h2>
        <span className="muted small">
          {formatShort(monday)} – {formatShort(addDays(monday, 6))}
        </span>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Çalışma</span>
          <strong>{formatMinutes(studied)}</strong>
          <span className="muted small">{planned ? `plan ${formatMinutes(planned)}` : 'plan yok'}</span>
        </div>
        <div className="tile">
          <span className="muted small">Seri</span>
          <strong>{stats.streak} gün</strong>
          <span className="muted small">en uzun {stats.bestStreak}</span>
        </div>
        <div className="tile">
          <span className="muted small">Ruh hali</span>
          <strong>{avg ? MOODS[avg - 1].face : '—'}</strong>
          <span className="muted small">{avg ? MOODS[avg - 1].label : 'son 7 gün'}</span>
        </div>
      </div>
      {recentHard >= 2 && (
        <div className="note-box">
          Son 4 günde {recentHard} kez "zordu" seçildi. Planı biraz hafifletmek ya da birlikte konuşmak iyi gelebilir.
        </div>
      )}
      <p className="muted small">Bu hafta {stats.planDays.filter((d) => d >= monday).length} günün planı tamamlandı.</p>
    </section>
  );
}

function PlanApproval({
  family,
  onChange,
  courses,
  goPlan,
}: {
  family: FamilySettings;
  onChange: (f: FamilySettings) => Promise<void>;
  courses: Course[];
  goPlan: () => void;
}) {
  const api = useApi();
  const today = toLocalDate();
  // Haftalık plan birkaç hafta ileriye yazılabilir; bekleyen her şey görünsün
  const to = addDays(today, 365);
  const [pending, setPending] = useState<PlanItem[]>([]);
  const load = useCallback(() => {
    api
      .listPlans(today, to)
      .then((p) => setPending(p.filter((x) => !x.approved)))
      .catch(() => setPending([]));
  }, [api, today, to]);
  useEffect(load, [load]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const dates = [...new Set(pending.map((p) => p.date))].sort();

  return (
    <section className="card">
      <h2>Plan</h2>
      <label className="check toggle-row">
        <span className="grow">
          <strong>Plan değişikliklerini onayla</strong>
          <span className="muted small">Açıkken çocuğun kaydettiği plan siz onaylayana kadar "onay bekliyor" görünür.</span>
        </span>
        <input
          type="checkbox"
          checked={family.require_plan_approval}
          onChange={(e) => onChange({ ...family, require_plan_approval: e.target.checked })}
        />
      </label>
      {dates.length > 0 ? (
        <>
          <p className="small">
            <strong>{dates.length} gün</strong> onay bekliyor ({formatShort(dates[0])}
            {dates.length > 1 ? ` – ${formatShort(dates.at(-1)!)}` : ''}):
          </p>
          <ul className="list small">
            {dates.slice(0, 7).map((d) => (
              <li key={d} className="row">
                <span className="nowrap">{formatShort(d)}</span>
                <span className="grow muted">
                  {pending
                    .filter((p) => p.date === d)
                    .map((p) => `${byId.get(p.course_id)?.name ?? '?'} ${p.minutes}`)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn ghost" onClick={goPlan}>
              Planı aç
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                await api.approvePlans(today, to);
                load();
              }}
            >
              Onayla
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">Onay bekleyen plan yok.</p>
      )}
    </section>
  );
}

function NotesCard() {
  const api = useApi();
  const [notes, setNotes] = useState<ParentNote[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.listNotes(5).then(setNotes).catch(() => setNotes([]));
  }, [api]);
  useEffect(load, [load]);

  return (
    <section className="card">
      <h2>Bir not bırak</h2>
      <label className="field">
        <span>Çocuğunuzun Bugün ekranında 3 gün görünür</span>
        <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="ör. Dün kesirleri çok güzel çalışmışsın!" />
      </label>
      <div className="chips">
        {QUICK_NOTES.map((q) => (
          <button key={q} className="chip-btn" onClick={() => setText(text ? `${text} ${q}` : q)}>
            {q}
          </button>
        ))}
      </div>
      <button
        className="btn primary full"
        disabled={!text.trim() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.addNote(text.trim());
            setText('');
            load();
          } finally {
            setBusy(false);
          }
        }}
      >
        Notu gönder
      </button>
      {notes.length > 0 && (
        <ul className="list sent-notes">
          {notes.map((n) => (
            <li key={n.id} className="row">
              <span className="grow small">
                {n.text}
                <span className="muted">
                  {' '}
                  · {formatShort(toLocalDate(new Date(n.created_at)))}
                  {n.reaction === 'heart' ? ' · ❤️' : n.reaction === 'thanks' ? ' · 🙏' : ''}
                </span>
              </span>
              <button
                className="icon-btn"
                aria-label="Notu sil"
                onClick={async () => {
                  await api.deleteNote(n.id);
                  load();
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RewardsAdmin() {
  const api = useApi();
  const { stats } = useGame();
  const reading = useReading();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RewardKind>('minutes');
  const [target, setTarget] = useState(String(REWARD_KINDS[0].example));
  const [givenBy, setGivenBy] = useState('');
  const load = useCallback(() => {
    api.listRewards().then(setRewards).catch(() => setRewards([]));
  }, [api]);
  useEffect(load, [load]);
  const input = useMemo(
    () => (stats ? { dayTotals: stats.dayTotals, streak: stats.streak, books: reading.books, planDays: stats.planDays } : null),
    [stats, reading.books],
  );
  const open = rewards.filter((r) => !r.claimed_on);
  const n = Number(target);
  const ok = title.trim() && Number.isInteger(n) && n >= 1 && n <= 100000;

  return (
    <section className="card">
      <h2>Ödüller</h2>
      {open.length === 0 && <p className="muted small">Açık ödül hedefi yok.</p>}
      <ul className="list">
        {input &&
          open.map((r) => {
            const p = rewardProgress(r, input);
            return (
              <li key={r.id} className="row">
                <div className="grow">
                  <strong>{r.title}</strong>
                  <div className="muted small">
                    {p.value}/{r.target} {kindOf(r.kind).unit} · {formatShort(r.start_date)}'ten beri
                    {p.reached && <strong className="good-ink"> · hedefe ulaştı</strong>}
                  </div>
                </div>
                <button
                  className={`btn sm${p.reached ? ' primary' : ''}`}
                  onClick={async () => {
                    await api.updateReward(r.id, { claimed_on: toLocalDate() });
                    load();
                  }}
                >
                  Verildi
                </button>
                <ConfirmButton
                  className="icon-btn"
                  confirmLabel="Sil?"
                  onConfirm={async () => {
                    await api.deleteReward(r.id);
                    load();
                  }}
                >
                  ×
                </ConfirmButton>
              </li>
            );
          })}
      </ul>
      <form
        className="reward-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          await api.addReward({ title: title.trim(), kind, target: n, given_by: givenBy.trim() || null, start_date: toLocalDate() });
          setTitle('');
          load();
        }}
      >
        <h3>Yeni ödül ekle</h3>
        <label className="field">
          <span>Ödül</span>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Hafta sonu sinema" />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Hedef türü</span>
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value as RewardKind;
                setKind(k);
                setTarget(String(kindOf(k).example));
              }}
            >
              {REWARD_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Miktar ({kindOf(kind).unit})</span>
            <input type="number" min={1} max={100000} value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Kim koyuyor? (istersen)</span>
          <input value={givenBy} maxLength={40} onChange={(e) => setGivenBy(e.target.value)} placeholder="ör. Annem" />
        </label>
        <p className="muted small">İlerleme bugünden itibaren sayılır (seri hariç: seri o anki seridir).</p>
        <button className="btn full" disabled={!ok}>
          Ödülü ekle
        </button>
      </form>
    </section>
  );
}

function PinChange({ family, onChange }: { family: FamilySettings; onChange: (f: FamilySettings) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <section className="card">
      <h2>PIN'i değiştir</h2>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!validPin(pin)) return setMsg('PIN 4 rakam olmalı.');
          await onChange({ ...family, pin_hash: await hashPin(pin) });
          setPin('');
          setMsg('Yeni PIN kaydedildi ✓');
        }}
      >
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          aria-label="Yeni PIN"
          placeholder="Yeni PIN"
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''));
            setMsg('');
          }}
        />
        <button className="btn">Kaydet</button>
      </form>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}

/** Aile panelindeki kural özeti (config'ten) */
function economyRules(): string {
  const e = CFG.elmas;
  const t = e.study.tiers;
  const tiers =
    t.length === 1 && t[0].minutesPer === 1
      ? 'her çalışma dakikasına 1 💎'
      : t.map((x, i) => `${i ? t[i - 1].upTo : 0}–${x.upTo}. dk ${x.minutesPer} dk = 1 💎`).join(', ');
  return (
    `Elmas yalnızca sayaçla ölçülen çalışmadan kazanılır; süreyi sunucu tutar, sekme değişince ya da uzun süre dokunulmayınca sayaç durur. ` +
    `Elle yazılan süre kayda geçer ama Elmas vermez. Günlük: ${tiers}, en çok ${e.study.dailyCap} 💎. ` +
    `Seri kademesi günde +${e.streak.tiers[0].bonus}…+${e.streak.tiers.at(-1)!.bonus}, öz değerlendirme +${e.reflection.bonus}, ` +
    `planı biten gün +${e.plan}, biten kitap +${e.book.bonus} (haftada en çok ${e.book.perWeek}), ders görevleri. Gezinti yıldızları para değildir.`
  );
}

/** Kazancın ait olduğu gün (geçmişten kazanılanlar kendi gününde görünsün), değilse yazıldığı gün */
function ledgerDate(e: { kind: string; ref: string; created_at: string }): string {
  const d = ['study', 'plan', 'streak', 'reflection'].includes(e.kind) ? e.ref : e.kind === 'quest' ? e.ref.split(':')[1] : null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : toLocalDate(new Date(e.created_at));
}

/** Oyun ve Elmas: bakiye, son hareketler, hediye Elmas ve kuralların özeti */
function EconomyAdmin() {
  const api = useApi();
  const { stats, refresh, celebrate } = useGame();
  const [amount, setAmount] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!stats) return null;
  const recent = [...stats.ledger]
    .filter((e) => e.kind !== 'star')
    .sort((a, b) => ledgerDate(b).localeCompare(ledgerDate(a)) || b.created_at.localeCompare(a.created_at))
    .slice(0, 30);
  const label = (e: (typeof recent)[number]) =>
    e.kind === 'buy' ? `${itemById(e.note ?? '')?.icon ?? '🛍️'} ${itemById(e.note ?? '')?.name ?? 'Satın alma'}` : e.kind === 'gift' ? `🎁 Hediye${e.note ? `: ${e.note}` : ''}` : (LEDGER_LABEL[e.kind]?.(e.ref) ?? e.kind);
  return (
    <section className="card">
      <h2>Oyun ve Elmas</h2>
      <p className="muted small">{economyRules()}</p>
      <div className="row">
        <span className="grow">Bakiye</span>
        <strong>💎 {stats.crystals}</strong>
      </div>
      <div className="row">
        <span className="grow">Gezintide toplanan yıldız</span>
        <strong>⭐ {stats.stars}</strong>
      </div>
      <div className="row">
        <span className="grow">Seri dondurma</span>
        <strong>{stats.freezesLeft} bekliyor</strong>
      </div>
      <div className="gift-form">
        <label className="grow">
          <span className="muted small">Hediye Elmas (1–{GIFT_MAX})</span>
          <input type="number" min={1} max={GIFT_MAX} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <label className="grow">
          <span className="muted small">Not (isteğe bağlı)</span>
          <input value={note} maxLength={120} placeholder="Örn. Karne hediyesi" onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          className="btn primary"
          disabled={busy || !(amount >= 1 && amount <= GIFT_MAX)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.giftCrystals(Math.round(amount), note.trim());
              await refresh();
              celebrate({ kind: 'badge', icon: '🎁', title: `${Math.round(amount)} Elmas hediye edildi`, detail: note.trim() || 'Çocuğunuz dükkânda kullanabilir.' });
              setNote('');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Hediye et
        </button>
      </div>
      {error && <p className="error-ink small">{error}</p>}
      <details className="ledger">
        <summary className="small">Son hareketler</summary>
        {recent.length === 0 ? (
          <p className="muted small">Henüz hareket yok.</p>
        ) : (
          <ul>
            {recent.map((e) => (
              <li key={e.id} className="row small">
                <span className="grow">{label(e)}</span>
                <span className="muted">{formatShort(ledgerDate(e))}</span>
                <strong className={e.amount < 0 ? 'neg' : 'pos'}>
                  {e.amount > 0 ? '+' : ''}
                  {e.amount} {e.currency === 'crystal' ? '💎' : '⭐'}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
