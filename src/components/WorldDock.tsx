// Dünyam'ın alttaki paneli (Habbo'nun alt çubuğu gibi; baloncuk ve dükkân penceresi yerine). Üstte o an ne
// yapılıyorsa o: seçili eşyanın adı, özellikleri ve düğmeleri (kullan · ✋ Taşı · ↻ Döndür · 📦 Kaldır), karakterin
// düğmeleri, elde tutulan eşya (↻ Döndür · ✕ Vazgeç) ya da ↶ Geri al. Altta sekmeler: 🎒 Envanter (odaya
// konabilecek eşyalar), 🛍️ Dükkân (katalog), 🎨 Oda (zemin/duvar, şekil, oda ekle/değiştir, yakından gez).
import { lazy, Suspense, type ReactNode } from 'react';
import { behaviorText, itemById, RARITY, type Item } from '../lib/catalog';
import { canRotate, isOn, isRoom, isTerrace, itemActions, nextRot, powerKey, type ActionId, type PlacedItem, type SpaceId, type SpaceLayout, type WorldCtx } from '../lib/world';
import type { UserRoom } from '../lib/types';
import type { Tab as LookTab } from './avatar/AvatarEditor';
import InventoryDrawer, { CoverRow, type InvEntry } from './InventoryDrawer';
import { ItemIcon } from './ItemCard';
import type { ItemRef } from './world3d/WorldView';

const ShopPanel = lazy(() => import('../pages/Shop'));

export type DockTab = 'inv' | 'shop' | 'room';

const TABS: [DockTab, string][] = [
  ['inv', '🎒 Envanter'],
  ['shop', '🛍️ Dükkân'],
  ['room', '🎨 Oda'],
];

export interface WorldDockProps {
  space: SpaceId;
  ctx: WorldCtx;
  layout: SpaceLayout | undefined;
  tab: DockTab | null;
  onTab: (t: DockTab | null) => void;
  /** Seçili eşya (dokunulan) */
  using: ItemRef | null;
  onCloseUse: () => void;
  /** Karakterin oturduğu eşya (Kalk düğmesi için) */
  posedAt: ItemRef | null;
  channels: Record<string, number>;
  onAction: (id: ActionId) => void;
  onChannel: (r: ItemRef) => void;
  onMove: (r: ItemRef) => void;
  onRotate: (r: ItemRef) => void;
  onRemove: (r: ItemRef) => void;
  /** Karakter paneli */
  me: boolean;
  dancing: boolean;
  onCloseMe: () => void;
  onEmote: (kind: 'dance' | 'wave' | null) => void;
  onPets: () => void;
  onLook: (t: LookTab) => void;
  /** Elde tutulan eşya (taşınan ya da envanterden alınan) */
  held: { item: string; rot: number; from?: PlacedItem } | null;
  onRotateHeld: (rot: number) => void;
  onCancelHeld: () => void;
  undo: { label: string; n: number } | null;
  onUndo: () => void;
  /** Envanter: bu odaya konabilecek, boşta duran eşyalar */
  items: InvEntry[];
  owned: (it: Item) => number;
  onHold: (it: Item) => void;
  onCover: (slot: 'floor' | 'wall', id: string) => void;
  goCollection: () => void;
  /** Dükkândan "Hemen yerleştir" */
  onPlace: (id: string) => void;
  /** Seçili oda eklenen bir odaysa */
  room: UserRoom | undefined;
  canAdd: boolean;
  onAddRoom: () => void;
  onEditRoom: () => void;
  onBlocks: () => void;
  onExplore: () => void;
}

export default function WorldDock(p: WorldDockProps) {
  const placed = p.using ? p.layout?.items[p.using.index] : undefined;
  const item = placed ? itemById(placed.item) : undefined;
  const heldItem = p.held ? itemById(p.held.item) : undefined;

  // Üst kısım: o an yapılan iş (eşya elde > seçili eşya > karakter > geri al)
  let top: ReactNode = null;
  if (p.held && heldItem) {
    top = (
      <div className="dock-row dock-held" role="toolbar" aria-label="Elindeki eşya">
        <ItemIcon item={heldItem} className="sm" />
        <span className="grow dock-text">
          <strong>{p.held.from ? `✋ ${heldItem.name}` : heldItem.name}</strong>
          <span className="muted small"> · {heldItem.placement === 'wall' ? 'asmak istediğin duvara' : 'koymak istediğin karoya'} dokun</span>
        </span>
        {canRotate(heldItem) && (
          <button className="btn sm" onClick={() => p.onRotateHeld(nextRot(heldItem, p.held!.rot))}>
            ↻ Döndür
          </button>
        )}
        <button className="btn sm ghost" onClick={p.onCancelHeld}>
          ✕ Vazgeç
        </button>
      </div>
    );
  } else if (p.using && placed && item) {
    top = <ItemInfo {...p} using={p.using} placed={placed} item={item} />;
  } else if (p.me) {
    top = (
      <div className="dock-info" role="region" aria-label="Karakterin">
        <div className="dock-head">
          <span className="dock-avatar" aria-hidden>
            🙂
          </span>
          <strong className="grow">Ben</strong>
          <button className="pop-x" onClick={p.onCloseMe} aria-label="Kapat">
            ✕
          </button>
        </div>
        <div className="dock-btns">
          {p.dancing ? (
            <button className="btn sm primary" onClick={() => p.onEmote(null)}>
              ⏹ Dur
            </button>
          ) : (
            <button className="btn sm primary" onClick={() => p.onEmote('dance')}>
              💃 Dans et
            </button>
          )}
          <button className="btn sm" onClick={() => p.onEmote('wave')}>
            👋 El salla
          </button>
          <button className="btn sm" onClick={p.onPets}>
            🐾 Hayvanımı yanıma al
          </button>
          <button className="btn sm" onClick={() => p.onLook('top')}>
            👕 Kıyafet değiştir
          </button>
          <button className="btn sm" onClick={() => p.onLook('govde')}>
            🙂 Görünüşüm
          </button>
        </div>
      </div>
    );
  } else if (p.undo) {
    top = (
      <div key={p.undo.n} className="dock-row dock-undo" role="status">
        <span className="grow dock-text">{p.undo.label}</span>
        <button className="btn sm" onClick={p.onUndo}>
          ↶ Geri al
        </button>
      </div>
    );
  }

  // Sekmenin içi (bir eşya seçiliyken ya da karakter paneli açıkken sekme içi gizli; elde eşya varken envanter kalır)
  const showTab = p.tab && !(p.using && !p.held) && !p.me;
  let body: ReactNode = null;
  if (showTab && p.tab === 'inv') {
    body = (
      <InventoryDrawer
        className="dock-inv"
        covers={false}
        space={p.space}
        layout={p.layout}
        ctx={p.ctx}
        items={p.items}
        owned={p.owned}
        held={p.held?.item}
        onHold={p.onHold}
        onCover={p.onCover}
        onShop={() => p.onTab('shop')}
      />
    );
  } else if (showTab && p.tab === 'shop') {
    body = (
      <Suspense fallback={<div className="dock-loading">🛍️ Dükkân açılıyor…</div>}>
        <ShopPanel goCollection={p.goCollection} onPlace={p.onPlace} />
      </Suspense>
    );
  } else if (showTab && p.tab === 'room') {
    const terrace = isTerrace(p.space, p.ctx);
    body = (
      <div className="dock-room">
        {!terrace && <CoverRow space={p.space} layout={p.layout} ctx={p.ctx} owned={p.owned} onCover={p.onCover} />}
        {terrace && <p className="muted small">Terasın zemini çim, duvarı yok: çit, çiçek, bostan, kamp ve heykel eşyaları buraya konur.</p>}
        <div className="dock-btns">
          {p.room && (
            <>
              <button className="btn sm" onClick={p.onBlocks}>
                🧱 Şekli karo karo çiz
              </button>
              <button className="btn sm" onClick={p.onEditRoom}>
                ✏️ Adı ve türü
              </button>
            </>
          )}
          {p.canAdd && (
            <button className="btn sm" onClick={p.onAddRoom}>
              ➕ Oda ekle
            </button>
          )}
          <button className="btn sm" onClick={p.onExplore}>
            🚶 Yakından gez
          </button>
        </div>
        {!isRoom(p.space) && <p className="muted small">Odan ve kütüphanen çalıştıkça büyür. Eklediğin odaların şeklini karo karo sen çizersin.</p>}
      </div>
    );
  }

  return (
    <div className="world-dock" data-tour="edit">
      {top}
      {body && <div className={`dock-body dock-${p.tab}`}>{body}</div>}
      <div className="dock-tabs" role="tablist" aria-label="Alttaki panel">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={p.tab === t} className={p.tab === t ? 'on' : ''} onClick={() => p.onTab(t)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Seçili eşyanın bilgisi (Habbo'nun bilgi kutusu gibi): resim, ad, nadirlik, ne yaptığı; altında düğmeler */
function ItemInfo(p: WorldDockProps & { using: ItemRef; placed: PlacedItem; item: Item }) {
  const { using, placed, item } = p;
  const posed = !!p.posedAt && p.posedAt.space === using.space && p.posedAt.index === using.index;
  const actions = itemActions(item, placed, { posed, today: p.ctx.today });
  const on = isOn(item, placed);
  const key = powerKey(using.space, placed);
  const what = behaviorText(item);
  return (
    <div className="dock-info" role="region" aria-label={item.name}>
      <div className="dock-head">
        <ItemIcon item={item} />
        <span className="grow dock-text">
          <strong>{item.name}</strong>{' '}
          <span className="rarity-tag" style={{ ['--rarity' as string]: RARITY[item.rarity].color }}>
            {RARITY[item.rarity].name}
          </span>
          {what && <span className="muted small dock-what">{what}</span>}
        </span>
        <button className="pop-x" onClick={p.onCloseUse} aria-label="Kapat">
          ✕
        </button>
      </div>
      {(actions.length > 0 || (item.fx === 'tv' && on)) && (
        <div className="dock-btns">
          {actions.map((a, k) => (
            <button key={a.id} className={`btn sm${k === 0 ? ' primary' : ''}`} onClick={() => p.onAction(a.id)}>
              {a.label}
            </button>
          ))}
          {item.fx === 'tv' && on && (
            <button className="btn sm" onClick={() => p.onChannel(using)}>
              🔁 {(p.channels[key] ?? 0) === 0 ? 'Ormanım' : 'Çalışmam'}
            </button>
          )}
        </div>
      )}
      <div className="dock-btns edit">
        <button className="btn sm" onClick={() => p.onMove(using)}>
          ✋ Taşı
        </button>
        {canRotate(item) && (
          <button className="btn sm" onClick={() => p.onRotate(using)}>
            ↻ Döndür
          </button>
        )}
        <button className="btn sm" onClick={() => p.onRemove(using)}>
          📦 Kaldır
        </button>
      </div>
    </div>
  );
}
