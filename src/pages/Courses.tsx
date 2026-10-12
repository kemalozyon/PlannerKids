import ConfirmButton from '../components/ConfirmButton';
import { useState } from 'react';
import { useApi } from '../lib/ApiContext';
import { useGame } from '../lib/GameContext';
import { SCHOOL_SUBJECTS, hasCourse } from '../lib/presets';
import ParentSettings from '../components/ParentSettings';
import type { Course } from '../lib/types';

export const PALETTE = ['#4f7cff', '#16a37f', '#e0803a', '#d1477a', '#8b5cf6', '#0ea5c6', '#c9a227', '#6b7280'];

export default function Courses({ courses, reload }: { courses: Course[]; reload: () => void }) {
  const api = useApi();
  const game = useGame();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[courses.length % PALETTE.length]);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="stack">
      <h1>Dersler</h1>

      {SCHOOL_SUBJECTS.some((p) => !hasCourse(courses.map((c) => c.name), p.name)) && (
        <section className="card">
          <h2>Okul dersleri</h2>
          <p className="muted small">Dokun, hemen eklensin.</p>
          <div className="quick-add">
            {SCHOOL_SUBJECTS.filter((p) => !hasCourse(courses.map((c) => c.name), p.name)).map((p) => (
              <button
                key={p.name}
                className="subject-chip"
                style={{ borderColor: p.color, color: p.color }}
                onClick={async () => {
                  await api.addCourse(p.name, p.color);
                  reload();
                }}
              >
                + {p.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Başka bir ders</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await api.addCourse(name.trim(), color);
            setName('');
            setColor(PALETTE[(courses.length + 1) % PALETTE.length]);
            reload();
          }}
        >
          <label className="field">
            <span>İsim</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="ör. Satranç, Piyano" />
          </label>
          <ColorPicker value={color} onChange={setColor} />
          <button className="btn primary full">Ekle</button>
        </form>
      </section>

      <section className="card">
        <h2>Derslerin</h2>
        {courses.length === 0 ? (
          <p className="muted">Henüz ders yok.</p>
        ) : (
          <ul className="list">
            {courses.map((c) =>
              editing === c.id ? (
                <EditRow
                  key={c.id}
                  course={c}
                  onDone={() => {
                    setEditing(null);
                    reload();
                  }}
                />
              ) : (
                <li key={c.id} className="row">
                  <span className="dot lg" style={{ background: c.color }} />
                  <span className="grow">{c.name}</span>
                  <button className="btn ghost sm" onClick={() => setEditing(c.id)}>
                    Düzenle
                  </button>
                  <ConfirmButton
                    className="btn ghost sm danger"
                    confirmLabel="Kayıtlarıyla sil?"
                    ariaLabel={`${c.name} dersini sil`}
                    onConfirm={async () => {
                      await api.deleteCourse(c.id);
                      reload();
                      game.refresh();
                    }}
                  >
                    Sil
                  </ConfirmButton>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <ParentSettings />
    </div>
  );
}

function EditRow({ course, onDone }: { course: Course; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState(course.name);
  const [color, setColor] = useState(course.color);
  return (
    <li className="edit-row">
      <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <ColorPicker value={color} onChange={setColor} />
      <div className="actions">
        <button className="btn ghost" onClick={onDone}>
          Vazgeç
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            if (name.trim()) await api.updateCourse(course.id, { name: name.trim(), color });
            onDone();
          }}
        >
          Kaydet
        </button>
      </div>
    </li>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Renk">
      {PALETTE.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={value === c ? 'on' : ''}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
