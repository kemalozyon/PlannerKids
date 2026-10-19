// Blok düzenleyici (Habbo'nun kat planı gibi): eklenen odanın şekli karo karo çizilir. Bir karoya dokununca
// zemin eklenir ya da çıkar; en ve boy düğmeleriyle kutu büyür/küçülür (en çok world.roomMax); hazır şablonlardan
// başlanabilir. Arka sıra ve sol sütun duvar dibidir, hep dolu kalır (pencere ve duvar süsleri orada). Kurallar
// world.ts → roomCellsProblem (sunucuda room_cells_check). Kaydedince sığmayan eşyalar envantere döner.
import { useState } from 'react';
import { CFG } from '../lib/config';
import type { UserRoom } from '../lib/types';
import { cellCount, cellsFrom, doorRow, inCells, MIN_CELLS, roomCells, ROOM_SHAPES, roomCellsProblem, roomFixed, kindById, type RoomCells } from '../lib/world';
import Sheet from './Sheet';

const MAX = CFG.world.roomMax;

/** Şekil → açık karolar kümesi */
const floorOf = (c: RoomCells) => {
  const out = new Set<string>();
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (inCells(c, x, y)) out.add(`${x},${y}`);
  return out;
};

export default function RoomBlocks({ room, onSave, onClose }: { room: UserRoom; onSave: (cells: RoomCells) => Promise<unknown>; onClose: () => void }) {
  const first = roomCells(room);
  const [w, setW] = useState(first.w);
  const [h, setH] = useState(first.h);
  const [floor, setFloor] = useState(() => floorOf(first));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cells = cellsFrom(w, h, (x, y) => x === 0 || y === 0 || floor.has(`${x},${y}`));
  const problem = roomCellsProblem(cells);
  const doors = roomFixed(cells, !!kindById(room.kind).outdoor).filter((f) => f.kind === 'door');
  const same = JSON.stringify(cells) === JSON.stringify(cellsFrom(first.w, first.h, (x, y) => inCells(first, x, y)));

  const toggle = (x: number, y: number) => {
    if (x === 0 || y === 0) return;
    const k = `${x},${y}`;
    setFloor((f) => {
      const n = new Set(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  /** Kutuyu büyüt/küçült: yeni sıra/sütun zeminle dolar */
  const resize = (nw: number, nh: number) => {
    if (nw < 3 || nh < 3 || nw > MAX.w || nh > MAX.h) return;
    setFloor((f) => {
      const n = new Set([...f].filter((k) => {
        const [x, y] = k.split(',').map(Number);
        return x < nw && y < nh;
      }));
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) if (x >= w || y >= h) n.add(`${x},${y}`);
      return n;
    });
    setW(nw);
    setH(nh);
  };
  const fromTemplate = (c: RoomCells) => {
    setW(c.w);
    setH(c.h);
    setFloor(floorOf(c));
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(cells);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={`🧱 ${room.name}: şekli`} onClose={onClose}>
      <div className="room-blocks">
        <p className="muted small">
          Karoya dokun: zemin eklenir ya da çıkar. Üst sıra arka duvar, sol sütun yan duvar: onlar hep dolu. Koyu karolar kapılar.
        </p>
        <div className="rbk-size">
          <span className="rbk-label">En</span>
          <button className="btn sm" aria-label="Eni azalt" disabled={w <= 3} onClick={() => resize(w - 1, h)}>
            −
          </button>
          <strong>{w}</strong>
          <button className="btn sm" aria-label="Eni artır" disabled={w >= MAX.w} onClick={() => resize(w + 1, h)}>
            +
          </button>
          <span className="rbk-label">Boy</span>
          <button className="btn sm" aria-label="Boyu azalt" disabled={h <= 3} onClick={() => resize(w, h - 1)}>
            −
          </button>
          <strong>{h}</strong>
          <button className="btn sm" aria-label="Boyu artır" disabled={h >= MAX.h} onClick={() => resize(w, h + 1)}>
            +
          </button>
          <span className="grow" />
          <span className="muted small">{cellCount(cells)} karo</span>
        </div>
        <div className="rbk-grid" style={{ gridTemplateColumns: `repeat(${w}, minmax(0, 26px))` }} role="grid" aria-label="Odanın karoları">
          {Array.from({ length: w * h }, (_, i) => {
            const x = i % w;
            const y = Math.floor(i / w);
            const on = inCells(cells, x, y);
            const door = doors.some((d) => d.x === x && d.y === y);
            const wall = x === 0 || y === 0;
            return (
              <button
                key={`${x},${y}`}
                className={`rbk-cell${on ? ' on' : ''}${door ? ' door' : ''}${wall ? ' wall' : ''}`}
                aria-label={`${x + 1}. sütun, ${y + 1}. sıra: ${on ? 'zemin' : 'boş'}${wall ? ' (duvar dibi)' : ''}`}
                aria-pressed={on}
                disabled={wall}
                onClick={() => toggle(x, y)}
              />
            );
          })}
        </div>
        <div className="rb-label">Hazır şekiller</div>
        <div className="pick-row">
          {ROOM_SHAPES.map((s) => (
            <button key={s.id} className="pick" onClick={() => fromTemplate(s.sizes.m)}>
              {s.name}
            </button>
          ))}
        </div>
        {problem ? <p className="error small">{problem}</p> : <p className="muted small">Kapılar {doorRow(cells) + 1}. sırada. Yeni şekle sığmayan eşyalar envanterine döner.</p>}
        {error && <p className="error">{error}</p>}
        <div className="rb-actions">
          <span className="muted small">En az {MIN_CELLS} karo, hepsi birbirine bağlı.</span>
          <span className="grow" />
          <button className="btn primary" disabled={busy || !!problem || same} onClick={save}>
            ✓ Şekli kaydet
          </button>
        </div>
      </div>
    </Sheet>
  );
}
