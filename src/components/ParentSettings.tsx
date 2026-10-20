import { useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import type { ReportSettings } from '../lib/types';
import { hourAt, reportsPreviousDay } from '../../supabase/functions/_shared/report';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Ebeveyn raporu ayarları: e-posta, çocuğun adı, yedek gönderim saati. */
export default function ParentSettings() {
  const api = useApi();
  const [s, setS] = useState<ReportSettings | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getReportSettings().then((r) =>
      setS(r ?? { parent_email: '', child_name: '', send_hour: 21, timezone: 'Europe/Istanbul', enabled: true }),
    );
  }, [api]);
  if (!s) return null;

  const set = (patch: Partial<ReportSettings>) => {
    setS({ ...s, ...patch });
    setStatus('idle');
  };
  const emailOk = !s.parent_email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.parent_email);

  return (
    <section className="card parent-settings" id="ebeveyn">
      <h2>Aile kontrolü · günlük rapor</h2>
      <p className="muted small">
        Her gün, çocuk "Bugünü bitirdim"e bastığında ya da en geç seçtiğiniz saatte, günün özeti e-postayla gelir. Özet ve öneri metnini yapay zekâ
        (Google Gemini) yazar. Bunun için o günün kayıtları ve çocuğun "nasıl geçti" notu rapor hazırlanırken Google'ın Gemini API'sine
        gönderilir.
      </p>
      <label className="field">
        <span>Ebeveyn e-postası</span>
        <input
          id="parent-email"
          type="email"
          autoComplete="email"
          value={s.parent_email ?? ''}
          onChange={(e) => set({ parent_email: e.target.value })}
          placeholder="ornek@eposta.com"
        />
      </label>
      {!emailOk && <div className="error">E-posta adresi geçerli görünmüyor.</div>}
      <div className="form-row">
        <label className="field">
          <span>Çocuğun adı (raporda)</span>
          <input id="child-name" value={s.child_name ?? ''} maxLength={40} onChange={(e) => set({ child_name: e.target.value })} placeholder="ör. Ece" />
        </label>
        <label className="field">
          <span>En geç gönderim saati</span>
          <select id="send-hour" value={s.send_hour} onChange={(e) => set({ send_hour: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
                {reportsPreviousDay(h) ? ' (önceki günün raporu)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">
        {reportsPreviousDay(s.send_hour)
          ? `Rapor ertesi ${s.send_hour < 6 ? 'gece' : 'sabah'} ${hourAt(s.send_hour)}, bir önceki günün özetiyle gelir.`
          : `Rapor her gün en geç ${hourAt(s.send_hour)}, o günün özetiyle gelir.`}
      </p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Günlük raporu gönder</span>
      </label>
      <div className="actions">
        <span className="muted small">{status === 'saved' ? 'Kaydedildi ✓' : status === 'error' ? msg : ''}</span>
        <button
          className="btn primary"
          disabled={!emailOk}
          onClick={async () => {
            try {
              await api.setReportSettings({ ...s, parent_email: s.parent_email?.trim() || null, child_name: s.child_name?.trim() || null });
              setStatus('saved');
            } catch (e) {
              setMsg((e as Error).message);
              setStatus('error');
            }
          }}
        >
          Kaydet
        </button>
      </div>
    </section>
  );
}
