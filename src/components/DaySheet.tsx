import { useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { formatDay, formatMinutes } from '../lib/date';
import { MOODS } from '../lib/mood';
import type { Book, Course, Reflection, StudyLog, Task } from '../lib/types';
import type { DayTree } from '../lib/world';
import Sheet from './Sheet';

/**
 * Bir günün kartı: o günün ağacı (her çalışılan gün bir ağaç), ders ders süreler ve notlar, "nasıl geçti",
 * tamamlanan görevler ve bitirilen kitap. Geçmiş takviminden ve bahçede ağaca yaklaşınca açılır.
 */
export default function DaySheet({
  date,
  tree,
  minutes,
  courses,
  onClose,
}: {
  date: string;
  /** O günün ağacı (yoksa çalışılmamış) */
  tree: DayTree | null;
  /** O gün çalışılan toplam dakika */
  minutes: number;
  courses: Course[];
  onClose: () => void;
}) {
  const api = useApi();
  const [logs, setLogs] = useState<StudyLog[] | null>(null);
  const [ref, setRef] = useState<Reflection | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  useEffect(() => {
    api.listLogs(date, date).then(setLogs);
    api.getReflection(date).then(setRef);
    api.listTasks(date).then(setTasks).catch(() => {});
    api.listBooks().then((b) => setBooks(b.filter((x) => x.finished_on === date))).catch(() => {});
  }, [api, date]);

  const byCourse = new Map<string, number>();
  logs?.forEach((l) => byCourse.set(l.course_id, (byCourse.get(l.course_id) ?? 0) + l.duration_minutes));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const mood = ref?.rating ? MOODS[ref.rating - 1] : null;
  const manual = logs?.filter((l) => l.source === 'manual').reduce((s, l) => s + l.duration_minutes, 0) ?? 0;
  const done = tasks.filter((t) => t.done);

  return (
    <Sheet title={formatDay(date)} onClose={onClose}>
      <div className="detail-top">
        <div className="day-trees" aria-hidden>
          {tree ? <span>{tree.dry ? tree.icon : tree.species.icon}</span> : <span className="gs-soil day-soil" />}
        </div>
        <div>
          <div className="detail-time">{formatMinutes(minutes)}</div>
          <div className="muted">
            {tree ? (tree.dry ? 'Kuru ağaç: o gün başlayan seans yarıda kaldı' : `${tree.name}${tree.glow ? ' ✨' : ''}${tree.flowers ? ' · seri günü 🌼' : ''}`) : 'Bu gün ağaç dikilmedi'}
          </div>
          {manual > 0 && <div className="muted small">{formatMinutes(manual)} elle yazıldı (ağaç verir, Elmas vermez)</div>}
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
      {done.length > 0 && (
        <div className="day-extra">
          <strong className="small">✅ Bitirdiği görevler</strong>
          <ul className="small">
            {done.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </div>
      )}
      {books.length > 0 && (
        <div className="day-extra">
          <strong className="small">📚 Bitirdiği kitap</strong>
          <ul className="small">
            {books.map((b) => (
              <li key={b.id}>
                {b.title}
                {b.favorite_part ? <span className="muted"> · “{b.favorite_part}”</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {tree && !tree.dry && <p className="muted small">Ağacın türü güne göre seçilir; büyüklüğü o gün ne kadar çalıştığına bağlı: {'🌱 0+ · 🌿 20+ · 🌳 45+ · 90+ · 150+ dk'}.</p>}
    </Sheet>
  );
}
