import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { toLocalDate } from '../lib/date';
import { STAGES } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import { useReading } from '../lib/ReadingContext';
import type { DailyReport, Reflection, ReportSettings } from '../lib/types';
import Sheet from './Sheet';

/**
 * Bugün ekranının sonu: "Bugünü bitirdim" → kısa kontrol listesi → ebeveyne rapor.
 * Basılmazsa rapor her akşam yedek saatte otomatik gider (sunucu tarafı).
 */
export default function EndDay({ goForest, goSettings, demo }: { goForest: () => void; goSettings: () => void; demo: boolean }) {
  const api = useApi();
  const { stats } = useGame();
  const reading = useReading();
  const date = toLocalDate();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([api.getDailyReport(date), api.getReportSettings()]);
    setReport(r);
    setSettings(s);
  }, [api, date]);
  useEffect(() => {
    load();
  }, [load]);

  const ready = !!settings?.enabled && !!settings.parent_email;
  const time = report?.sent_at ? new Date(report.sent_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section className="card end-day">
      {report ? (
        <div className="end-done">
          <span className="end-moon" aria-hidden>
            🌙
          </span>
          <div className="grow">
            <strong>Bugünü bitirdin, iyi dinlen!</strong>
            <div className="muted small">
              {demo ? 'Rapor önizlemesi hazırlandı' : `Rapor ebeveynine gönderildi${time ? ` · ${time}` : ''}`}
            </div>
          </div>
          <button className="btn sm" onClick={() => setPreview(true)}>
            Raporu gör
          </button>
        </div>
      ) : (
        <>
          <button className="btn big full end-btn" onClick={() => setOpen(true)}>
            🌙 Bugünü bitirdim
          </button>
          <p className="muted small center">
            {ready
              ? `Basınca günün raporu ebeveynine gider. Basmazsan saat ${String(settings!.send_hour).padStart(2, '0')}:00'da kendiliğinden gider.`
              : 'Ebeveyn raporu için önce Dersler sayfasındaki ebeveyn ayarlarını doldur.'}
          </p>
        </>
      )}

      {open && stats && (
        <EndDaySheet
          date={date}
          ready={ready}
          demo={demo}
          walletLeft={stats.today.left}
          readToday={!!reading.stats?.readToday}
          onClose={() => setOpen(false)}
          goForest={() => {
            setOpen(false);
            goForest();
          }}
          goSettings={() => {
            setOpen(false);
            goSettings();
          }}
          onSent={async () => {
            await load();
            setOpen(false);
            setPreview(true);
          }}
        />
      )}
      {preview && report?.html && (
        <Sheet title={demo ? 'Rapor önizlemesi' : 'Gönderilen rapor'} onClose={() => setPreview(false)}>
          {demo && (
            <p className="demo-note small">
              Demo modu: e-posta gönderilmedi. Gerçek sürümde özet ve öneri metnini Claude yazar, rapor <strong>{settings?.parent_email}</strong> adresine gider.
            </p>
          )}
          {report.subject && (
            <div className="mail-subject">
              <span className="muted small">Konu</span> {report.subject}
            </div>
          )}
          <div className="report-preview" dangerouslySetInnerHTML={{ __html: report.html }} />
        </Sheet>
      )}
    </section>
  );
}

function EndDaySheet({
  date,
  ready,
  demo,
  walletLeft,
  readToday,
  onClose,
  goForest,
  goSettings,
  onSent,
}: {
  date: string;
  ready: boolean;
  demo: boolean;
  walletLeft: number;
  readToday: boolean;
  onClose: () => void;
  goForest: () => void;
  goSettings: () => void;
  onSent: () => void;
}) {
  const api = useApi();
  const [ref, setRef] = useState<Reflection | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getReflection(date).then(setRef);
  }, [api, date]);

  const wrote = !!ref && (ref.rating != null || !!ref.note?.trim());
  const canBuy = walletLeft >= STAGES[0].min;

  return (
    <Sheet title="Günü kapatalım 🌙" onClose={onClose}>
      <ul className="end-checklist">
        <li className={wrote ? 'ok' : ''}>
          <span aria-hidden>{wrote ? '✅' : '✍️'}</span>
          <span className="grow">{wrote ? '"Bugün nasıl geçti?" yazıldı' : '"Bugün nasıl geçti?" kısmını yazmadın. Raporda o da yer alır.'}</span>
          {!wrote && (
            <button className="btn sm" onClick={onClose}>
              Yaz
            </button>
          )}
        </li>
        <li className={canBuy ? '' : 'ok'}>
          <span aria-hidden>{canBuy ? '🪙' : '✅'}</span>
          <span className="grow">{canBuy ? `Cüzdanında ${walletLeft} dk var. Ay bitene kadar bekler ama şimdi de harcayabilirsin.` : 'Bugünün parası harcandı'}</span>
          {canBuy && (
            <button className="btn sm" onClick={goForest}>
              Harca
            </button>
          )}
        </li>
        <li className={readToday ? 'ok' : ''}>
          <span aria-hidden>{readToday ? '✅' : '📖'}</span>
          <span className="grow">{readToday ? 'Bugün kitap okudun' : 'Bugün kitap okuma kaydı yok'}</span>
        </li>
      </ul>
      {error && <div className="error">Rapor gönderilemedi: {error}. Biraz sonra tekrar dene.</div>}
      {ready ? (
        <button
          className="btn primary big full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await api.sendDailyReport(date);
            setBusy(false);
            if (r.status === 'error') setError(r.message);
            else onSent();
          }}
        >
          {busy ? 'Rapor hazırlanıyor…' : demo ? 'Günü bitir ve raporu önizle' : 'Günü bitir, raporu gönder'}
        </button>
      ) : (
        <button className="btn primary big full" onClick={goSettings}>
          Ebeveyn ayarlarına git
        </button>
      )}
      <p className="muted small center">Günde bir rapor gider. Bitirdikten sonra çalışmaya devam edersen ormanın yine büyür.</p>
    </Sheet>
  );
}
