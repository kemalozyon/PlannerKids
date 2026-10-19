// Mantar pano (NOTES): çocuğun kendi hatırlatıcı notları. Not yaz, renk seç, as; yapınca üstünü çiz ya da kaldır.
// Panonun 3D yüzünde son 6 not görünür (art.ts → boardTexture). Her dokunuş hemen kaydedilir (dünya sayfası).
import { useState } from 'react';
import { BOARD_COLORS, BOARD_MAX, BOARD_TEXT_MAX, type BoardNote } from '../lib/types';
import Sheet from './Sheet';

const QUICK = ['Matematik ödevi', 'Kitap oku 20 dk', 'Çantanı hazırla', 'Kelime tekrarı', 'Su iç 💧'];

export default function NoteBoardSheet({
  notes,
  onAdd,
  onToggle,
  onDelete,
  onClose,
}: {
  notes: BoardNote[];
  onAdd: (text: string, color: number) => Promise<void>;
  onToggle: (n: BoardNote) => void;
  onDelete: (n: BoardNote) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [color, setColor] = useState(0);
  const [busy, setBusy] = useState(false);
  const full = notes.length >= BOARD_MAX;
  const add = async () => {
    const t = text.trim();
    if (!t || busy || full) return;
    setBusy(true);
    try {
      await onAdd(t, color);
      setText('');
      setColor((c) => (c + 1) % BOARD_COLORS.length);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="📌 Mantar panom" onClose={onClose}>
      <p className="muted small">Kendine kısa bir not as: panoda son 6 not görünür. Yapınca üstüne dokun, çizilsin.</p>
      <label className="field">
        <span>Yeni not</span>
        <textarea
          rows={2}
          maxLength={BOARD_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="ör. Cuma fen sınavı"
        />
      </label>
      <div className="chips">
        {QUICK.map((q) => (
          <button key={q} className="chip-btn" onClick={() => setText(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="board-colors" role="radiogroup" aria-label="Kâğıt rengi">
        {BOARD_COLORS.map((c, i) => (
          <button key={c} role="radio" aria-checked={color === i} aria-label={`Renk ${i + 1}`} className={`board-color${color === i ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(i)} />
        ))}
        <button className="btn primary grow" disabled={!text.trim() || busy || full} onClick={() => void add()}>
          {full ? 'Pano doldu' : '📌 As'}
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="muted small">Pano boş.</p>
      ) : (
        <ul className="board-list">
          {[...notes].reverse().map((n) => (
            <li key={n.id} className={`board-note${n.done ? ' done' : ''}`} style={{ background: BOARD_COLORS[n.color] ?? BOARD_COLORS[0] }}>
              <button className="board-text" aria-pressed={n.done} onClick={() => onToggle(n)} title={n.done ? 'Yapılmadı say' : 'Yaptım'}>
                {n.done ? '✅ ' : ''}
                {n.text}
              </button>
              <button className="icon-btn" aria-label="Notu kaldır" onClick={() => onDelete(n)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
