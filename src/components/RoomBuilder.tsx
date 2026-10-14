// Oda ekle / değiştir: türü (adı, simgesi, varsayılan zemin ve duvarı), şekli (Habbo'daki oda modelleri gibi şablon:
// Kare, L, Basamak…) ve boyutu seçilir. Kilit yok, ücretsiz; en çok world.maxRooms oda. Şekil küçülünce sığmayan
// eşyalar envantere döner; oda silinince içindekilerin hepsi envantere döner.
import { useState } from 'react';
import { CFG } from '../lib/config';
import type { RoomInput, UserRoom } from '../lib/types';
import { cellsOf, inCells, kindById, ROOM_KINDS, ROOM_SHAPES, ROOM_SIZES, roomInputProblem, type RoomCells, type RoomSize } from '../lib/world';
import Sheet from './Sheet';

/** Şeklin kuşbakışı küçük resmi: arka duvar üstte, kapılar yanlarda */
export function ShapePreview({ cells, cell = 6 }: { cells: RoomCells; cell?: number }) {
  return (
    <span className="shape-prev" style={{ gridTemplateColumns: `repeat(${cells.w}, ${cell}px)`, gridAutoRows: `${cell}px` }} aria-hidden>
      {Array.from({ length: cells.w * cells.h }, (_, i) => {
        const x = i % cells.w;
        const y = Math.floor(i / cells.w);
        const door = y === 5 && (x === 0 || x === cells.w - 1);
        return <span key={i} className={inCells(cells, x, y) ? (door ? 'door' : 'on') : ''} />;
      })}
    </span>
  );
}

export default function RoomBuilder({
  room,
  count,
  onSave,
  onDelete,
  onClose,
}: {
  /** Değiştirilen oda (yoksa yeni oda) */
  room?: UserRoom;
  /** Şu an kaç oda var */
  count: number;
  onSave: (r: RoomInput) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(room?.kind ?? ROOM_KINDS[0].id);
  const [shape, setShape] = useState(room?.shape ?? ROOM_SHAPES[0].id);
  const [size, setSize] = useState<RoomSize>(room?.size ?? 'm');
  const [name, setName] = useState(room?.name ?? ROOM_KINDS[0].name);
  // Ad elle değiştirilmediyse tür değişince adı da değişir
  const [named, setNamed] = useState(!!room);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input: RoomInput = { kind, shape, size, name };
  const problem = roomInputProblem(input);
  const full = !room && count >= CFG.world.maxRooms;
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const cells = cellsOf(shape, size);
  return (
    <Sheet title={room ? `${kindById(room.kind).icon} ${room.name}` : '➕ Yeni oda'} onClose={onClose}>
      {full ? (
        <p className="muted small">Evinde {CFG.world.maxRooms} oda var, daha fazla eklenemez. Bir odayı değiştirebilir ya da silebilirsin.</p>
      ) : (
        <div className="room-builder">
          <div className="rb-label">Ne odası?</div>
          <div className="pick-row">
            {ROOM_KINDS.map((k) => (
              <button
                key={k.id}
                className={`pick${kind === k.id ? ' on' : ''}`}
                aria-pressed={kind === k.id}
                title={k.desc}
                onClick={() => {
                  setKind(k.id);
                  if (!named) setName(k.name);
                }}
              >
                <span aria-hidden>{k.icon}</span> {k.name}
              </button>
            ))}
          </div>
          <div className="rb-label">Şekli</div>
          <div className="shape-grid">
            {ROOM_SHAPES.map((s) => (
              <button key={s.id} className={`shape-btn${shape === s.id ? ' on' : ''}`} aria-pressed={shape === s.id} onClick={() => setShape(s.id)}>
                <ShapePreview cells={s.sizes[size]} cell={4} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
          <div className="rb-label">Boyu</div>
          <div className="pick-row">
            {ROOM_SIZES.map((z) => {
              const c = cellsOf(shape, z.id);
              return (
                <button key={z.id} className={`pick${size === z.id ? ' on' : ''}`} aria-pressed={size === z.id} onClick={() => setSize(z.id)}>
                  {z.name} <span className="muted">{c.w}×{c.h}</span>
                </button>
              );
            })}
          </div>
          <div className="rb-preview">
            <ShapePreview cells={cells} cell={10} />
            <span className="muted small">Üst kenar arka duvar; yanlardaki koyu karolar kapılar (komşu odalara açılır).</span>
          </div>
          <label className="rb-label" htmlFor="rb-name">
            Adı
          </label>
          <input
            id="rb-name"
            value={name}
            maxLength={24}
            onChange={(e) => {
              setName(e.target.value);
              setNamed(true);
            }}
          />
          {room && (room.shape !== shape || room.size !== size) && <p className="muted small">Yeni şekle sığmayan eşyalar envanterine döner.</p>}
          {error && <p className="error">{error}</p>}
          <div className="rb-actions">
            {room && onDelete && (
              <button className={`btn${sure ? ' danger' : ' ghost'}`} disabled={busy} onClick={() => (sure ? run(onDelete) : setSure(true))}>
                {sure ? '🗑️ Evet, sil (eşyalar envantere)' : '🗑️ Odayı sil'}
              </button>
            )}
            <span className="grow" />
            <button className="btn primary" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => run(() => onSave(input))}>
              {room ? '✓ Kaydet' : '➕ Odayı ekle'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
