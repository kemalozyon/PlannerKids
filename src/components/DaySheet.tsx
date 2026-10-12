import { useEffect, useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { formatDay, formatMinutes, toLocalDate } from '../lib/date';
import { monthOf, priceOf, speciesById, STAGES, stageIndex } from '../lib/forest';
import { MOODS } from '../lib/mood';
import type { Course, ForestTree, Reflection, StudyLog } from '../lib/types';
import Sheet from './Sheet';
import Tree from './Tree';

/**
 * Bir günün kartı: o güne dikilen ağaç, çalışılan dersler ve "nasıl geçti".
 * Ormandan (büyütme/taşıma ile) ve Geçmiş takviminden (yalnızca görüntüleme) açılır.
 */
export default function DaySheet({
  date,
  tree,
  minutes,
  courses,
  edit,
  onClose,
}: {
  date: string;
  /** O güne dikilen ağaç; yoksa null */
  tree: ForestTree | null;
  /** O gün çalışılan toplam dakika (= o günün parası) */
  minutes: number;
  courses: Course[];
  /** Ormandan açıldıysa ve ağaç bu ayınsa: büyütme ve yer değiştirme */
  edit?: { onMove: () => void; onUpgrade: (stage: number) => void };
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
  const thisMonth = monthOf(date) === monthOf(toLocalDate());
  const best = stageIndex(minutes);
  const left = tree ? minutes - priceOf(tree.stage) : minutes;
  const upgrades = tree ? STAGES.map((st, i) => ({ st, i, cost: priceOf(i) - priceOf(tree.stage) })).filter((u) => u.i > tree.stage) : [];

  return (
    <Sheet title={formatDay(date)} onClose={onClose}>
      <div className="detail-top">
        {tree ? <Tree species={tree.species} stage={tree.stage} size={110} /> : <span className="gs-soil day-soil" aria-hidden />}
        <div>
          <div className="detail-time">{formatMinutes(minutes)}</div>
          {tree ? (
            <div className="muted">
              {speciesById(tree.species).name} · {STAGES[tree.stage].name}
            </div>
          ) : (
            <div className="muted">Bu güne ağaç dikilmedi</div>
          )}
          {!tree && best < 0 && <div className="muted small">Ağaç için o gün en az {STAGES[0].min} dk çalışmak gerekiyordu.</div>}
          {!tree && best >= 0 && thisMonth && <div className="muted small">Bu günün parası {STAGES[best].name.toLowerCase()} dikmeye yetiyor. Ormanda dikebilirsin.</div>}
          {tree && !edit && thisMonth && best > tree.stage && (
            <div className="muted small">Ormanda bu ağacı {STAGES[best].name.toLowerCase()} yapabilirsin.</div>
          )}
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
      {edit && tree && upgrades.length > 0 && (
        <div className="field">
          <span>Büyüt (farkını o günün parasından öde)</span>
          <div className="upgrades">
            {upgrades.map(({ st, i, cost }) => (
              <button key={st.id} className="btn upgrade" disabled={cost > left} onClick={() => edit.onUpgrade(i)}>
                <Tree species={tree.species} stage={i} size={30} />
                <span>{st.name}</span>
                <span className="price">🪙 {cost}</span>
              </button>
            ))}
          </div>
          {upgrades[0].cost > left && (
            <span className="muted small">
              {date === toLocalDate()
                ? `Bugün ${formatMinutes(upgrades[0].cost - left)} daha çalışırsan ${upgrades[0].st.name.toLowerCase()} olur.`
                : `O gün ${formatMinutes(upgrades[0].cost - left)} daha çalışılsaydı ${upgrades[0].st.name.toLowerCase()} olurdu.`}
            </span>
          )}
        </div>
      )}
      {edit && tree && (
        <button className="btn full" onClick={edit.onMove}>
          Yerini değiştir
        </button>
      )}
    </Sheet>
  );
}
