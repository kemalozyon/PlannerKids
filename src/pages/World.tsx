// Dünyam: evin (oda, kütüphane odası) ve dış mekân (bahçe + aylık orman bölgeleri). Hepsi aynı karo
// ızgarasında, aynı yerleştirme motoruyla (world.ts, world3d/). Çalıştıkça dünya büyür: her seans bir ağaç,
// toplam saatle yeni araziler, kitaplarla kütüphane odası. Elmasla alınan eşyalar burada yerleştirilir.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import ShelfView from '../components/ShelfView';
import Sheet from '../components/Sheet';
import { itemById, ITEMS, type Item } from '../lib/catalog';
import type { SpaceId } from '../lib/config';
import { dayPhase } from '../lib/dayPhase';
import { formatMinutes, formatShort, toLocalDate } from '../lib/date';
import { ownedCount, owns } from '../lib/economy';
import { perksOf } from '../lib/level';
import { formatMonth, monthOf } from '../lib/forest';
import { useGame } from '../lib/GameContext';
import { useReading } from '../lib/ReadingContext';
import { useSession } from '../lib/SessionContext';
import { setSoundOn, sfx, soundOn } from '../lib/sfx';
import type { Course } from '../lib/types';
import { hasWebGL } from '../lib/webgl';
import {
  canPlaceAt,
  emptyLayout,
  fitsSpace,
  outdoorMap,
  type PlacedItem,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
  type WorldTree,
} from '../lib/world';
import { CFG } from '../lib/config';
import { VIEW_EVENT } from '../lib/tour';

const WorldView = lazy(() => import('../components/world3d/WorldView'));
const Explore = lazy(() => import('../components/forest3d/Explore'));

type View = 'room' | 'library' | 'outdoor';
const VIEW_KEY = 'ct-world-view-v1';
const GFX_KEY = 'ct-gfx-v1';
const GROWN_KEY = 'ct-grown-v1';

/** Kapıdan geçince karakterin başladığı karo */
const START: Record<View, Record<string, Tile>> = {
  room: { garden: { x: 6, y: 1 }, library: { x: 1, y: 5 }, start: { x: 4, y: 4 } },
  library: { room: { x: 4, y: 1 }, start: { x: 4, y: 1 } },
  outdoor: { room: { x: 2, y: 5 }, start: { x: 2, y: 5 } },
};

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* yok say */
  }
};

export default function World({ courses, goShop }: { courses: Course[]; goShop: () => void }) {
  const { stats, saveSpace, collectStar, equip, refresh } = useGame();
  const reading = useReading();
  const ses = useSession();
  const can3D = useMemo(hasWebGL, []);
  const [view, setView] = useState<View>(() => {
    const v = read(VIEW_KEY);
    return v === 'outdoor' || v === 'library' ? v : 'room';
  });
  const [from, setFrom] = useState('start');
  const [fading, setFading] = useState(false);
  const [shadows, setShadows] = useState(() => read(GFX_KEY) === 'on' || (read(GFX_KEY) == null && !matchMedia('(pointer: coarse)').matches));
  const [sound, setSound] = useState(soundOn);
  const [focus, setFocus] = useState<Tile | null>(null);
  const [tree, setTree] = useState<WorldTree | null>(null);
  // "Kitaplığımda gör" ile gelindiyse kitaplık açık başlar
  const [shelf, setShelf] = useState(() => {
    try {
      const on = sessionStorage.getItem('ct-open-shelf') === '1';
      sessionStorage.removeItem('ct-open-shelf');
      return on;
    } catch {
      return false;
    }
  });
  const [exploring, setExploring] = useState(false);
  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  // Düzenleme
  const [draft, setDraft] = useState<SpaceLayout | null>(null);
  const [held, setHeld] = useState<{ item: string; rot: number; from?: PlacedItem } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [grown, setGrown] = useState<string[]>(() => JSON.parse(read(GROWN_KEY) ?? '[]') as string[]);

  useEffect(() => {
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => write(VIEW_KEY, view), [view]);
  // Tanıtım turu oda/dış mekân değiştirebilir
  useEffect(() => {
    const on = (e: Event) => {
      const v = (e as CustomEvent<View>).detail;
      setDraft(null);
      setView(v);
      setFocus(null);
    };
    window.addEventListener(VIEW_EVENT, on);
    return () => window.removeEventListener(VIEW_EVENT, on);
  }, []);
  // Kütüphane kapandıysa (kitap silindi) odaya dön
  useEffect(() => {
    if (stats && view === 'library' && !stats.libraryOpen) setView('room');
  }, [stats, view]);

  const thisMonth = monthOf(toLocalDate());
  const ctx: WorldCtx = useMemo(() => ({ totalMinutes: stats?.trustedMinutes ?? 0, booksDone: stats?.booksDone ?? 0 }), [stats?.trustedMinutes, stats?.booksDone]);
  const map = useMemo(() => (stats ? outdoorMap(ctx, stats.forest, thisMonth) : null), [stats, ctx, thisMonth]);
  if (!stats || !map) return <div className="splash">Yükleniyor…</div>;

  const space: SpaceId = view === 'outdoor' ? 'garden' : view;
  const saved = stats.spaces[space] ?? emptyLayout(space);
  const layout = draft ?? saved;
  const editing = draft != null;
  // Bugün dikilen ve henüz büyümesi gösterilmeyen son ağaç
  const growId = stats.forest.filter((t) => !t.dry && t.date === toLocalDate() && !grown.includes(t.id)).at(-1)?.id ?? null;
  const markGrown = (id: string | null) => {
    if (!id) return;
    const next = [...grown, id].slice(-50);
    setGrown(next);
    write(GROWN_KEY, JSON.stringify(next));
  };

  const go = (to: SpaceId | 'outdoor') => {
    const v: View = to === 'garden' || to === 'outdoor' ? 'outdoor' : to;
    if (editing) return;
    sfx.door();
    setFading(true);
    setTimeout(() => {
      setFrom(view === 'outdoor' ? 'garden' : view);
      setView(v);
      setFocus(null);
      setFading(false);
    }, 220);
  };

  // ---------- Envanter ----------
  const usedIn = (l: SpaceLayout, id: string) => l.items.filter((p) => p.item === id).length;
  const usedElsewhere = (id: string) =>
    (['room', 'library', 'garden'] as SpaceId[]).filter((s) => s !== space).reduce((n, s) => n + usedIn(stats.spaces[s] ?? emptyLayout(s), id), 0);
  const available = (it: Item) => ownedCount(it, stats.owned, stats.unlock) - usedElsewhere(it.id) - usedIn(layout, it.id) - (held?.item === it.id ? 1 : 0);
  const inventory = ITEMS.filter((it) => !!it.placement && fitsSpace(it, space))
    .map((it) => ({ it, n: available(it) }))
    .filter((x) => x.n > 0);
  const coverings = (cat: 'zemin' | 'duvar') => ITEMS.filter((it) => it.category === cat && ownedCount(it, stats.owned, stats.unlock) > 0);

  const startEdit = () => {
    setDraft(structuredClone(saved));
    setSelected(null);
    setHeld(null);
    setEditError(null);
    if (view === 'outdoor') setFocus({ x: 6, y: 5 });
  };
  const cancelEdit = () => {
    setDraft(null);
    setHeld(null);
    setSelected(null);
    setEditError(null);
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setEditError(null);
    try {
      await saveSpace(space, draft);
      sfx.place();
      cancelEdit();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const drop = (t: Tile) => {
    if (!held || !draft) return;
    const p: PlacedItem = { item: held.item, x: t.x, y: t.y, rot: held.rot };
    if (canPlaceAt(space, draft, ctx, p)) {
      setDraft({ ...draft, items: [...draft.items, p] });
      setSelected(draft.items.length);
      setHeld(null);
      setEditError(null);
      sfx.place();
    } else if (held.from) {
      // Geçersiz yere bırakılan eşya eski yerine döner
      setDraft({ ...draft, items: [...draft.items, held.from] });
      setSelected(draft.items.length);
      setHeld(null);
      setEditError('Buraya konamaz, eski yerine döndü.');
    } else setEditError('Buraya konamaz: karo dolu ya da alanın dışında.');
  };
  const pick = (i: number) => {
    if (!draft) return;
    const p = draft.items[i];
    setDraft({ ...draft, items: draft.items.filter((_, k) => k !== i) });
    setHeld({ item: p.item, rot: p.rot, from: p });
    setSelected(null);
  };
  /** Envanterden bir eşyayı eline al */
  const hold = (it: Item) => {
    setHeld({ item: it.id, rot: it.rotations?.[0] ?? 0 });
    setSelected(null);
    setEditError(null);
  };
  const rotations = (id: string) => itemById(id)?.rotations ?? [0];
  const nextRot = (id: string, rot: number) => {
    const r = rotations(id);
    return r[(r.indexOf(rot) + 1) % r.length];
  };
  const rotate = () => {
    if (held) return setHeld({ ...held, rot: nextRot(held.item, held.rot) });
    if (selected == null || !draft) return;
    const p = draft.items[selected];
    const q = { ...p, rot: nextRot(p.item, p.rot) };
    if (canPlaceAt(space, draft, ctx, q, selected)) {
      setDraft({ ...draft, items: draft.items.map((x, k) => (k === selected ? q : x)) });
      setEditError(null);
    } else setEditError('Döndürünce sığmıyor.');
  };
  const stash = () => {
    if (held) return setHeld(null);
    if (selected == null || !draft) return;
    setDraft({ ...draft, items: draft.items.filter((_, k) => k !== selected) });
    setSelected(null);
  };

  const lands = stats.lands;
  const toNext = lands.next ? lands.next.hours * 60 - stats.trustedMinutes : 0;
  const selItem = selected != null && draft ? itemById(draft.items[selected]?.item ?? '') : held ? itemById(held.item) : undefined;
  const equipped = stats.equipped;
  const character = itemById(equipped.character)?.model ?? 'character-female-b';
  const accessory = equipped.accessory ? (itemById(equipped.accessory) ?? null) : null;
  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name ?? 'Ders';

  const fallback = (
    <section className="card">
      <h2>🌳 Ormanın</h2>
      <p className="muted small">Bu cihaz 3D dünyayı gösteremiyor; ağaçların aylara göre burada.</p>
      {map.regions.map((r) => (
        <div key={r.month} className="flat-region">
          <strong>{formatMonth(r.month)}</strong>
          <div className="flat-trees">{r.trees.map((t) => <span key={t.id} title={`${t.name} · ${t.minutes} dk`}>{t.icon}</span>)}</div>
        </div>
      ))}
    </section>
  );

  return (
    <div className="stack world-page">
      <div className="world-tabs" role="tablist" aria-label="Dünyamda nerede">
        <button role="tab" aria-selected={view === 'room'} className={view === 'room' ? 'on' : ''} onClick={() => go('room')} disabled={editing}>
          🏠 Odam
        </button>
        {stats.libraryOpen && (
          <button role="tab" aria-selected={view === 'library'} className={view === 'library' ? 'on' : ''} onClick={() => go('library')} disabled={editing}>
            📚 Kütüphane
          </button>
        )}
        <button role="tab" aria-selected={view === 'outdoor'} className={view === 'outdoor' ? 'on' : ''} onClick={() => go('outdoor')} disabled={editing}>
          🌳 Bahçe ve orman
        </button>
      </div>

      {can3D ? (
        <div className={`world-wrap${fading ? ' fading' : ''}${editing ? ' editing' : ''}`} data-tour="world">
          <Suspense fallback={<div className="world-loading">🏡 Dünyan hazırlanıyor…</div>}>
            <WorldView
              key={view}
              kind={view}
              layout={layout}
              ctx={ctx}
              map={view === 'outdoor' ? map : null}
              creatures={stats.creatures}
              phase={phase}
              shadows={shadows}
              character={character}
              accessory={accessory}
              start={START[view][from] ?? START[view].start}
              focus={focus}
              growId={view === 'outdoor' && !editing ? growId : null}
              onGrown={() => markGrown(growId)}
              editing={editing}
              held={held}
              selected={selected}
              onPick={pick}
              onDrop={drop}
              onSelect={setSelected}
              onDoor={(to) => go(to)}
              onOpen={() => setShelf(true)}
              onTree={(t) => {
                sfx.pop();
                setTree(t);
              }}
            />
          </Suspense>
          <div className="world-top" hidden={editing}>
            {!editing && <span className="world-chip">💎 {stats.crystals}</span>}
            {!editing && view === 'outdoor' && <span className="world-chip">🌳 {stats.treeCount}</span>}
            <span className="grow" />
            <button
              className="world-chip"
              aria-label={sound ? 'Sesi kapat' : 'Sesi aç'}
              onClick={() => {
                setSoundOn(!sound);
                setSound(!sound);
              }}
            >
              {sound ? '🔊' : '🔇'}
            </button>
            <button
              className={`world-chip${shadows ? ' on' : ''}`}
              aria-pressed={shadows}
              title="Gölgeler (telefonda kapalı daha akıcı)"
              onClick={() => {
                write(GFX_KEY, shadows ? 'off' : 'on');
                setShadows(!shadows);
              }}
            >
              🌗
            </button>
          </div>
          {!editing && (
            <div className="world-actions" data-tour="edit">
              <button className="btn" onClick={startEdit}>
                ✏️ Düzenle
              </button>
              <button className="btn" onClick={goShop}>
                🛍️ Dükkân
              </button>
              {view === 'outdoor' && (
                <button
                  className="btn"
                  onClick={() => {
                    if (ses.running) ses.pause('game').catch(() => {});
                    setExploring(true);
                  }}
                >
                  🚶 Yakından gez
                </button>
              )}
            </div>
          )}
          {editing && (
            <>
              <div className="edit-bar">
                <strong className="grow">✏️ {view === 'outdoor' ? 'Bahçeni' : view === 'library' ? 'Kütüphaneni' : 'Odanı'} düzenle</strong>
                <button className="btn sm" onClick={cancelEdit} disabled={saving}>
                  Vazgeç
                </button>
                <button className="btn sm primary" onClick={save} disabled={saving || !!held}>
                  {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </div>
              <div className="edit-drawer" role="region" aria-label="Envanter">
                {editError ? (
                  <p className="edit-msg error-ink small">{editError}</p>
                ) : (
                  <p className="edit-msg muted small">{held ? 'Bırakmak istediğin karoya dokun' : 'Eşyayı sürükleyip taşı ya da aşağıdan seç'}</p>
                )}
                {(held || selItem) && (
                  <div className="edit-tools">
                    <span className="grow">
                      {selItem?.icon} <strong>{selItem?.name}</strong>
                    </span>
                    {selItem && (selItem.rotations?.length ?? 1) > 1 && (
                      <button className="btn sm" onClick={rotate} aria-label="Döndür">
                        ↻ Döndür
                      </button>
                    )}
                    <button className="btn sm ghost" onClick={stash}>
                      📦 Envantere koy
                    </button>
                  </div>
                )}
                {view !== 'outdoor' && (
                  <div className="cover-row">
                    {(['zemin', 'duvar'] as const).map((cat) => (
                      <span key={cat} className="cover-group">
                        <span className="muted small">{cat === 'zemin' ? 'Zemin' : 'Duvar'}</span>
                        {coverings(cat).map((it) => {
                          const slot = cat === 'zemin' ? 'floor' : 'wall';
                          const on = (layout[slot] ?? (cat === 'zemin' ? 'zemin:ahsap' : 'duvar:krem')) === it.id;
                          return (
                            <button key={it.id} className={`swatch${on ? ' on' : ''}`} title={it.name} aria-label={it.name} aria-pressed={on} style={{ background: it.color }} onClick={() => setDraft({ ...layout, [slot]: it.id })} />
                          );
                        })}
                      </span>
                    ))}
                  </div>
                )}
                <div className="inventory">
                  {inventory.length === 0 ? (
                    <p className="muted small">
                      Envanterin boş. <button className="link" onClick={goShop}>Dükkândan</button> eşya alabilirsin.
                    </p>
                  ) : (
                    inventory.map(({ it, n }) => (
                      <button
                        key={it.id}
                        className={`inv-item${held?.item === it.id && !held.from ? ' on' : ''}`}
                        // Basınca eline alınır: farede sahneye sürükleyip bırakılır, dokunmatikte sonra karoya dokunulur
                        onPointerDown={() => hold(it)}
                        onClick={() => hold(it)}
                      >
                        <span aria-hidden>{it.icon}</span>
                        <span className="inv-name">{it.name}</span>
                        {n > 1 && n < 1000 && <span className="inv-n">×{n}</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
          {!editing && view !== 'outdoor' && <span className="world-hint">Bir yere dokun, oraya yürüsün · kapıdan {view === 'room' ? 'bahçeye çık' : 'odana dön'}</span>}
        </div>
      ) : (
        fallback
      )}

      {!editing && view === 'outdoor' && (
        <section className="card regions">
          <div className="card-head">
            <h2>🗺️ Bölgeler</h2>
            <span className="muted small">{stats.treeCount} ağaç</span>
          </div>
          <div className="album-months">
            <button className="chip" onClick={() => setFocus({ x: 6, y: 5 })}>
              🏡 Bahçe
            </button>
            {map.regions.map((r) => (
              <button key={r.month} className="chip" onClick={() => setFocus({ x: r.ox + Math.floor(r.size / 2), y: Math.floor(r.size / 2) })}>
                🌲 {formatMonth(r.month)} · {r.trees.filter((t) => !t.dry).length}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card lands" data-tour="lands">
        <div className="card-head">
          <h2>
            {lands.current.icon} {lands.current.name}
          </h2>
          <span className="muted small">{lands.unlocked.length}/{CFG.world.garden.lands.length} arazi</span>
        </div>
        {lands.next ? (
          <>
            <p className="muted small">
              {lands.next.icon} <strong className="ink">{lands.next.name}</strong> için sayaçla {formatMinutes(toNext)} daha çalış. Dünyan yalnızca çalıştıkça büyür.
            </p>
            <div className="pbar" aria-hidden>
              <span style={{ width: `${Math.min(100, ((stats.trustedMinutes - lands.current.hours * 60) / ((lands.next.hours - lands.current.hours) * 60)) * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="muted small">Bütün arazileri açtın! Ormanın her ay büyümeye devam ediyor.</p>
        )}
        <p className="small">
          Ormana gelenler: {stats.creatures.length ? stats.creatures.map((c) => c.icon).join(' ') : <span className="muted">3 ağaç dikince ilk kelebekler gelir.</span>}
        </p>
      </section>

      {tree && (
        <Sheet title={`${tree.icon} ${tree.name}`} onClose={() => setTree(null)}>
          {tree.dry ? (
            <p>
              {formatShort(tree.date)} günü başlayan bir seans {tree.minutes} dakikada yarıda kaldı. Kuru ağaç ormanında anı olarak duruyor.
            </p>
          ) : (
            <>
              <p className="tree-sheet-head">
                <strong>{courseName(tree.course_id)}</strong> · {formatMinutes(tree.minutes)} · {formatShort(tree.date)}
              </p>
              {tree.note && <p className="muted">“{tree.note}”</p>}
              <p className="muted small">
                Ağacın türü seansın süresine göre: {CFG.world.trees.map((k) => `${k.icon} ${k.min ? `${k.min}+` : '0+'} dk`).join(' · ')}
              </p>
            </>
          )}
        </Sheet>
      )}

      {shelf && <ShelfView books={reading.books} onClose={() => setShelf(false)} />}

      {exploring && map && (
        <div className="explore-host">
          <Suspense fallback={<div className="explore explore-loading">🚶 Bahçe hazırlanıyor…</div>}>
            <Explore
              map={map}
              garden={stats.spaces.garden ?? emptyLayout('garden')}
              ctx={ctx}
              creatures={stats.creatures}
              today={toLocalDate()}
              equipped={equipped}
              characters={ITEMS.filter((i) => i.category === 'karakter' && owns(i, stats.owned, stats.unlock))}
              onEquip={equip}
              perks={perksOf(stats.level.index)}
              starsGot={stats.starsToday}
              onStar={collectStar}
              onTree={(t) => setTree(t)}
              onClose={() => {
                setExploring(false);
                refresh();
              }}
              paused={!!tree}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

