import { useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { formatDay, formatMinutes } from '../lib/date';
import { MOODS } from '../lib/mood';
import type { Course, Reflection, StudyLog } from '../lib/types';
import type { WorldTree } from '../lib/world';
import Sheet from './Sheet';

/**
 * Bir günün kartı: o gün dikilen ağaçlar (her seans bir ağaç), çalışılan dersler ve "nasıl geçti".
 * Geçmiş takviminden açılır.
 */
export default function DaySheet({
  date,
  trees,
  minutes,
  courses,
  onClose,
}: {
  date: string;
  /** O gün dikilen ağaçlar (kuru dahil) */
  trees: WorldTree[];
  /** O gün çalışılan toplam dakika */
  minutes: number;
  courses: Course[];
  onClose: () => void;
}) {
  const api = useApi();
  const [logs, setLogs] = useState<StudyLog[] | null>(null);
  const [ref, setRef] = useState<Reflection | null>(null);
  useEffect(() => {
    api.listLogs(date, date).then(setLogs);
    api.getReflection(date).then(setRef);
  }, [api, date]);

  const byCourse = new Map<string, number>();
  logs?.forEach((l) => byCourse.set(l.course_id, (byCourse.get(l.course_id) ?? 0) + l.duration_minutes));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const mood = ref?.rating ? MOODS[ref.rating - 1] : null;
  const manual = logs?.filter((l) => l.source === 'manual').reduce((s, l) => s + l.duration_minutes, 0) ?? 0;

  return (
    <Sheet title={formatDay(date)} onClose={onClose}>
      <div className="detail-top">
        <div className="day-trees" aria-label={`${trees.length} ağaç`}>
          {trees.length ? trees.map((t) => <span key={t.id} title={`${t.name} · ${t.minutes} dk`}>{t.icon}</span>) : <span className="gs-soil day-soil" aria-hidden />}
        </div>
        <div>
          <div className="detail-time">{formatMinutes(minutes)}</div>
          <div className="muted">{trees.length ? trees.map((t) => `${t.name} (${t.minutes} dk)`).join(', ') : 'Bu gün ağaç dikilmedi'}</div>
          {manual > 0 && <div className="muted small">{formatMinutes(manual)} elle yazıldı (ağaç ve Elmas vermez)</div>}
        </div>
      </div>
      {logs && byCourse.size > 0 && (
        <ul className="list detail-courses">
          {[...byCourse.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([cid, m]) => {
              const c = courseById.get(cid);
              return (
                <li key={cid} className="row">
                  <span className="dot" style={{ background: c?.color ?? '#999' }} />
                  <span className="grow">{c?.name ?? 'Silinmiş ders'}</span>
                  <strong className="nowrap">{formatMinutes(m)}</strong>
                </li>
              );
            })}
        </ul>
      )}
      {logs && logs.some((l) => l.note) && (
        <p className="muted small">
          {logs
            .filter((l) => l.note)
            .map((l) => l.note)
            .join(' · ')}
        </p>
      )}
      {(mood || ref?.note) && (
        <div className="detail-mood">
          {mood && (
            <span className="detail-face" title={mood.label}>
              {mood.face}
            </span>
          )}
          <span>{ref?.note || mood?.label}</span>
        </div>
      )}
    </Sheet>
  );
}
