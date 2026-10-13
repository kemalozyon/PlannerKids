import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { toLocalDate } from '../lib/date';
import type { DayTree } from '../lib/world';
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
              : 'Ebeveyn raporu için annen ya da baban önce Profil › Aile paneli\'nden rapor ayarlarını doldurmalı.'}
          </p>
        </>
      )}

      {open && stats && (
        <EndDaySheet
          date={date}
          ready={ready}
          demo={demo}
          trees={stats.forest.filter((t) => t.date === date)}
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
              Demo modu: e-posta gönderilmedi. Gerçek sürümde özet ve öneri metnini yapay zekâ (EVREN) yazar, rapor <strong>{settings?.parent_email}</strong> adresine gider.
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
  trees,
  readToday,
  onClose,
  goForest,
  goSettings,
  onSent,
}: {
  date: string;
  ready: boolean;
  demo: boolean;
  /** Bugün dikilen ağaçlar */
  trees: DayTree[];
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
  const grown = trees.filter((t) => !t.dry);
  const treeText = grown.length
    ? `Bugünün ağacı bahçende: ${grown[0].name} ${grown[0].species.icon}`
    : 'Bugün henüz ağaç yok: çalışınca bu ayın bahçesine bugünün ağacı dikilir.';

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
        <li className={grown.length ? 'ok' : ''}>
          <span aria-hidden>{grown.length ? '✅' : '🌱'}</span>
          <span className="grow">{treeText}</span>
          {grown.length > 0 && (
            <button className="btn sm" onClick={goForest}>
              Gör
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
      <p className="muted small center">Günde bir rapor gider. Bitirdikten sonra çalışmaya devam edersen bugünün ağacı yine büyür.</p>
    </Sheet>
  );
}
