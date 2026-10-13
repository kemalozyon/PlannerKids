// Karakter düzenleyici (Profil → Karakterim): ten, yapı, yüz, saç, üst, alt, ayakkabı ve aksesuarlar.
// Her parça ve rengi anında 3D önizlemede görünür. Sende olmayan parçayı deneyebilirsin; 💎 Elmasla
// alınabiliyorsa "Al" çıkar, başarıyla açılıyorsa nasıl açılacağı yazar. Kaydet yalnızca sahip olunan
// parçalarla açılır (sunucu da denetler).
import { useState } from 'react';
import {
  BODIES,
  BROWS,
  CHEEKS,
  CLOTH_COLORS,
  EYE_COLORS,
  EYES,
  HAIR_COLORS,
  lookParts,
  lookProblem,
  MOUTHS,
  randomLook,
  SKINS,
  SLOT_KEY,
  slotItems,
  wear,
  type AvatarLook,
} from '../../lib/avatar';
import { itemById, type Item, type Slot } from '../../lib/catalog';
import { buyCheck, owns, unlockHint } from '../../lib/economy';
import { useGame } from '../../lib/GameContext';
import { sfx } from '../../lib/sfx';
import AvatarPreview from './AvatarPreview';

type Tab = 'govde' | 'yuz' | Slot | 'aksesuar';
const TABS: { id: Tab; name: string; icon: string }[] = [
  { id: 'govde', name: 'Vücut', icon: '🧍' },
  { id: 'yuz', name: 'Yüz', icon: '🙂' },
  { id: 'hair', name: 'Saç', icon: '💇' },
  { id: 'top', name: 'Üst', icon: '👕' },
  { id: 'bottom', name: 'Alt', icon: '👖' },
  { id: 'shoes', name: 'Ayakkabı', icon: '👟' },
  { id: 'aksesuar', name: 'Aksesuar', icon: '🎒' },
];

export default function AvatarEditor({ onClose }: { onClose: () => void }) {
  const { stats, equip, buy } = useGame();
  const [look, setLook] = useState<AvatarLook>(() => stats!.equipped.look);
  const [tab, setTab] = useState<Tab>('govde');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!stats) return null;
  const has = (i: Item) => owns(i, stats.owned, stats.unlock);
  const problem = lookProblem(look, has);
  const set = (patch: Partial<AvatarLook>) => {
    setLook({ ...look, ...patch });
    setError(null);
  };
  /** Denenen ama sende olmayan parçalar */
  const missing = lookParts(look)
    .map((id) => itemById(id))
    .filter((i): i is Item => !!i && !has(i));

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const parts = (slot: Slot) => {
    const s = SLOT_KEY[slot];
    const cur = look[s.key] as string | null;
    return (
      <>
        <div className="ae-grid">
          {s.optional && (
            <button className={`ae-part${cur == null ? ' on' : ''}`} aria-pressed={cur == null} onClick={() => set({ [s.key]: null } as Partial<AvatarLook>)}>
              <span aria-hidden>🚫</span>
              <span>Yok</span>
            </button>
          )}
          {slotItems(slot).map((i) => {
            const mine = has(i);
            const a = i.acquire;
            return (
              <button key={i.id} className={`ae-part${cur === i.id ? ' on' : ''}${mine ? '' : ' locked'}`} aria-pressed={cur === i.id} onClick={() => setLook(wear(look, i))}>
                <span aria-hidden>{i.icon}</span>
                <span>{i.name}</span>
                {!mine && <span className="ae-price">{a.kind === 'buy' ? `💎 ${a.price}` : '🔒'}</span>}
              </button>
            );
          })}
        </div>
        {s.color && cur && !slotItems(slot).find((i) => i.id === cur)?.fixed && (
          <Colors label="Renk" list={slot === 'hair' ? HAIR_COLORS : CLOTH_COLORS} value={look[s.color] as string} onPick={(c) => set({ [s.color!]: c } as Partial<AvatarLook>)} />
        )}
      </>
    );
  };

  return (
    <div className="avatar-editor" role="dialog" aria-modal="true" aria-label="Karakterini düzenle">
      <div className="ae-head">
        <button className="btn ghost sm" onClick={onClose}>
          Vazgeç
        </button>
        <strong className="grow center">Karakterim</strong>
        <button className="btn sm" aria-label="Rastgele" onClick={() => setLook(randomLook(has, String(Date.now())))}>
          🎲
        </button>
      </div>
      <AvatarPreview look={look} className="avatar-preview big" />
      <div className="ae-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span aria-hidden>{t.icon}</span> {t.name}
          </button>
        ))}
      </div>
      <div className="ae-body">
        {tab === 'govde' && (
          <>
            <Colors label="Ten rengi" list={SKINS} value={look.skin} onPick={(c) => set({ skin: c })} />
            <Options label="Boy" list={BODIES} value={look.body} onPick={(v) => set({ body: v as AvatarLook['body'] })} />
          </>
        )}
        {tab === 'yuz' && (
          <>
            <Options label="Gözler" list={EYES} value={look.eyes} onPick={(v) => set({ eyes: v as AvatarLook['eyes'] })} />
            <Colors label="Göz rengi" list={EYE_COLORS} value={look.eyeColor} onPick={(c) => set({ eyeColor: c })} />
            <Options label="Kaşlar" list={BROWS} value={look.brows} onPick={(v) => set({ brows: v as AvatarLook['brows'] })} />
            <Options label="Ağız" list={MOUTHS} value={look.mouth} onPick={(v) => set({ mouth: v as AvatarLook['mouth'] })} />
            <Options label="Yanaklar" list={CHEEKS} value={look.cheeks} onPick={(v) => set({ cheeks: v as AvatarLook['cheeks'] })} />
          </>
        )}
        {(tab === 'hair' || tab === 'top' || tab === 'bottom' || tab === 'shoes') && parts(tab)}
        {tab === 'aksesuar' && (
          <>
            <h3 className="ae-sub">🧢 Şapka</h3>
            {parts('hat')}
            <h3 className="ae-sub">👓 Gözlük</h3>
            {parts('glasses')}
            <h3 className="ae-sub">🎒 Sırt</h3>
            {parts('back')}
          </>
        )}
      </div>
      <div className="ae-foot">
        {missing.length > 0 && (
          <div className="ae-missing">
            {missing.map((i) => {
              const reason = i.acquire.kind === 'buy' ? buyCheck(i.id, stats.crystals, stats.owned, stats.freezesLeft) : unlockHint(i);
              return (
                <div key={i.id} className="row">
                  <span className="grow small">
                    {i.icon} <strong>{i.name}</strong> sende yok{reason ? ` · ${reason}` : ''}
                  </span>
                  {i.acquire.kind === 'buy' && (
                    <button
                      className="btn sm primary"
                      disabled={busy || !!buyCheck(i.id, stats.crystals, stats.owned, stats.freezesLeft)}
                      onClick={() =>
                        run(async () => {
                          await buy(i.id);
                          sfx.star();
                        })
                      }
                    >
                      💎 {i.acquire.price} · Al
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="error-ink small">{error}</p>}
        <button
          className="btn primary full big"
          disabled={busy || !!problem}
          onClick={() =>
            run(async () => {
              await equip({ ...stats.equipped, look });
              sfx.place();
              onClose();
            })
          }
        >
          {problem && missing.length ? 'Önce eksik parçaları al' : 'Kaydet'}
        </button>
        <p className="muted small center">💎 {stats.crystals} Elmas · Elmas yalnızca çalışarak kazanılır</p>
      </div>
    </div>
  );
}

function Colors({ label, list, value, onPick }: { label: string; list: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="ae-row">
      <span className="muted small">{label}</span>
      <div className="ae-colors">
        {list.map((c) => (
          <button key={c} className={`swatch round${c === value ? ' on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={c === value} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  );
}

function Options({ label, list, value, onPick }: { label: string; list: readonly { id: string; name: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="ae-row">
      <span className="muted small">{label}</span>
      <div className="ae-opts">
        {list.map((o) => (
          <button key={o.id} className={`chip${o.id === value ? ' on' : ''}`} aria-pressed={o.id === value} onClick={() => onPick(o.id)}>
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}
