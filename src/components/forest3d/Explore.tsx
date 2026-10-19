// "Yakından gez": çocuk kendi avatarıyla seçili odada (oda, kütüphane, eklenen oda ya da teras) üçüncü şahıs
// kamerayla yürür. Sahne oda görünümüyle aynıdır (world3d/WorldScene, aynı tek oda planı); yalnızca kamera ve
// kontroller farklı. Her gün saklanan yıldızlar odanın boş karolarında toplanır.
// Bir eşyaya yaklaşınca adı çıkar; bir eşyaya (ya da düğmeye, E'ye) dokununca alttaki çubukta seçenekleri açılır:
// Kullan (otur, yat, sallan, aç-kapa, raflar; yanında olmak gerekir), Taşı (eşya karakterin önünde yeşil/kırmızı
// hayalet olarak gezer, "Bırak" ile öndeki karoya konur; explore.ts → carrySpot), Döndür, Kaldır. 🎒 odanın
// envanterini açar (seçilen eşya aynı şekilde önünde taşınır), 🛍️ gezintiyi kapatıp dükkânı açar.
// Karaktere (ya da 🙂'ye) dokununca karakter düğmeleri: dans, el salla, yanına hayvan al, kıyafet, görünüş. Kayıtlar
// Dünyam sayfasının işleriyle (World.tsx) yapılır. Seviye atladıkça yeni yetenekler açılır (level.ts). Dokunmatikte
// sol altta joystick + zıpla, boş yerde sürükleyerek etrafa bakılır; klavyede WASD/oklar, Shift koş, boşluk zıpla
// (basılı tut: süzül), E bak, Esc çık.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { ExtrudeGeometry, InstancedMesh, Object3D, Shape, Vector3, type Group, type PointLight } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { AvatarLook } from '../../lib/avatar';
import { has, itemById, type Item } from '../../lib/catalog';
import { CFG, type MapDef } from '../../lib/config';
import InventoryDrawer, { type InvEntry } from '../InventoryDrawer';
import type { Tab as LookTab } from '../avatar/AvatarEditor';
import Companions from '../world3d/Companion';
import { dayPhase } from '../../lib/dayPhase';
import { carrySpot, dailyStars, moveDir, resolveMove, STAR_REACH } from '../../lib/explore';
import type { Perks } from '../../lib/level';
import { setSoundOn, sfx, soundOn } from '../../lib/sfx';
import type { Book } from '../../lib/types';
import {
  canPlaceAt,
  canRotate,
  fitsSpace,
  footSize,
  isOn,
  itemActions,
  nextRot,
  powerKey,
  removeItemAt,
  seatOf,
  wallRot,
  type ActionId,
  type PlacedItem,
  type Pose,
  type SpaceId,
  type SpaceLayout,
  type Step,
  type Tile,
} from '../../lib/world';
import { canStep, regionOf, worldBlocked, type Region, type WorldPlan } from '../../lib/worldPlan';
import AvatarModel, { type AvatarAnim } from '../avatar/AvatarModel';
import { applyPose, blendApply, blendStart, newBlend } from '../world3d/Avatar';
import { damp, dampAngle } from '../world3d/motion';
import { FootTiles, ItemModel } from '../world3d/items';
import type { Quality } from '../../lib/gfx';
import Atmosphere, { shadowsFor } from '../world3d/Atmosphere';
import { Blob } from '../world3d/Blob';
import Effects from '../world3d/Effects';
import { QualityContext } from '../world3d/gfx';
import { isTap, LIGHT } from '../world3d/light';
import type { TvData } from '../world3d/art';
import WorldScene from '../world3d/WorldScene';

const WALK = 2.2;
const RUN = 4;
const GRAVITY = 14;
const JUMP_V = 5;

/** Bir eşyanın "yanında" sayılma uzaklığı (ayak izinin kenarından); dokununca seçenekler için biraz daha uzak */
const ITEM_REACH = 0.8;
const TAP_REACH = 1.6;

type ItemRef = { space: SpaceId; index: number };

export interface ExploreProps {
  plan: WorldPlan;
  /** Grafik kalitesi (gölge, son işlem) */
  quality: Quality;
  map: MapDef;
  layouts: Partial<Record<SpaceId, SpaceLayout>>;
  creatures: typeof CFG.world.creatures;
  today: string;
  /** Karakterin odadaki karosu (oda görünümünde kaldığı yer) */
  start: Tile;
  books: Book[];
  reading: Book[];
  /** TV kanalları (dünya görünümüyle aynı); karakterin elindeki ikram */
  channels: Record<string, number>;
  holding: string | null;
  tv: TvData;
  /** Üstte bir pencere açıkken karakter durur, tuşlar dinlenmez */
  paused: boolean;
  onClose: () => void;
  look: AvatarLook;
  perks: Perks;
  /** Bugün toplanan yıldızlar (sırası) */
  starsGot: number[];
  onStar: (i: number) => Promise<void>;
  /** Eşya işleri (World.tsx): eylemler (pozlar hariç), TV kanalı, döndür ve taşı (hata metni döner), kaldır */
  onAction: (r: ItemRef, id: ActionId) => void;
  onChannel: (r: ItemRef) => void;
  onRotate: (r: ItemRef) => string | null;
  onRemove: (r: ItemRef) => void;
  onMove: (r: ItemRef, to: Tile, rot: number) => string | null;
  /** Dünya sayfasının kısa bildirimi (kaydedilemedi, envantere döndü…) */
  toast: string | null;
  /** Yanına alınan evcil hayvanlar */
  pets: string[];
  /** Envanter (World.tsx): odaya konabilecek boştaki eşyalar, sahip olunan adet, kaplama, envanterden koy */
  inventoryFor: (sp: SpaceId) => InvEntry[];
  owned: (it: Item) => number;
  onCover: (sp: SpaceId, slot: 'floor' | 'wall', id: string) => void;
  onPlace: (sp: SpaceId, p: PlacedItem) => string | null;
  onShop: () => void;
  /** Dükkândan "Hemen yerleştir": eşya karakterin önünde taşınır (n her istekte artar) */
  carryNew: { item: string; n: number } | null;
  /** Karakter menüsünden: hayvan seçimi ya da görünüş düzenleyici (sayfa açar) */
  onMe: (k: 'pets' | LookTab) => void;
}

type Near = { kind: 'item'; key: string; space: SpaceId; index: number; item: Item };

/** Yakınlık için eşyanın dünyadaki ayak izi dikdörtgeni (duvar eşyası duvarın dibinde ince bir şerit) */
interface Spot {
  key: string;
  space: SpaceId;
  index: number;
  item: Item;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Noktanın dikdörtgene uzaklığı (içindeyse 0) */
const rectDist = (s: Spot, x: number, z: number) => Math.hypot(Math.max(s.x0 - x, 0, x - s.x1), Math.max(s.z0 - z, 0, z - s.z1));

/** Kontrol durumu: her karede okunur, React state'i değil (yeniden çizim olmasın) */
interface Ctl {
  jx: number;
  jy: number;
  joy: boolean;
  keys: Set<string>;
  jump: boolean;
  /** Zıpla basılı (süzülme) */
  jumpHeld: boolean;
  yaw: number;
  pitch: number;
  dist: number;
  lastLook: number;
  paused: boolean;
}

interface PlayerState {
  x: number;
  z: number;
  y: number;
  vy: number;
  /** Karakterin baktığı yön (rotation.y) */
  face: number;
  /** Havadayken kalan zıplama (çift zıplama) */
  jumps: number;
  /** Eşyanın üstünde: otur, yat, sallan (dünya konumu); hareket edince `back`'e iner */
  pose?: { kind: Pose; x: number; z: number; y: number; face: number; back: { x: number; z: number } } | null;
  /** Dururken oynayan hareket (karakter menüsü); `until` (performance.now) gelince biter; hareket edince biter */
  emote?: { kind: 'dance' | 'wave'; until?: number } | null;
}

export default function Explore(props: ExploreProps) {
  const { plan, map, today, paused, onClose, perks } = props;
  const size = { w: plan.w, h: plan.h };
  // Seçenekleri açık eşya, oturulan eşya, elde taşınan eşya (index null: envanterden; önündeki karo: spot)
  const [sel, setSel] = useState<ItemRef | null>(null);
  const [posed, setPosed] = useState<ItemRef | null>(null);
  const [carry, setCarry] = useState<{ space: SpaceId; index: number | null; item: Item; rot: number } | null>(null);
  const [spot, setSpot] = useState<Tile | null>(null);
  // Envanter çekmecesi, karakter düğmeleri
  const [bag, setBag] = useState(false);
  const [me, setMe] = useState(false);
  // Taşınan eşya (ve üstündekiler) yerinden kalkmış görünür; yürüyüşü engellemez
  const layouts = useMemo(
    () =>
      carry && carry.index != null && props.layouts[carry.space]
        ? { ...props.layouts, [carry.space]: removeItemAt(props.layouts[carry.space]!, carry.index) }
        : props.layouts,
    [props.layouts, carry],
  );
  const blocked = useMemo(() => worldBlocked(plan, layouts), [plan, layouts]);
  const step = useMemo<Step>(() => (a, b) => canStep(plan, a, b), [plan]);
  const room = plan.regions[0];
  // Yıldızlar odanın boş karolarında saklanır (kayıtlı yerleşimden: elde taşınan eşya yıldızları oynatmasın)
  const stars = useMemo(() => dailyStars(today, room.id, size, worldBlocked(plan, props.layouts)), [today, plan, props.layouts]); // eslint-disable-line react-hooks/exhaustive-deps
  // Eşyaların ayak izleri (yürünen halı/yol yakınlıkta sayılmaz: üstünde durulur)
  const spots = useMemo<Spot[]>(() => {
    const out: Spot[] = [];
    for (const r of plan.regions) {
      const l = layouts[r.id as SpaceId];
      l?.items.forEach((p, index) => {
        const item = itemById(p.item);
        if (!item || has(item, 'WALK_THROUGH') || !(item.model || item.art || item.proc)) return;
        const base = { key: powerKey(r.id as SpaceId, p), space: r.id as SpaceId, index, item };
        if (item.placement === 'wall') {
          const n = item.w ?? 1;
          out.push(p.y === -1 ? { ...base, x0: r.x + p.x, x1: r.x + p.x + n, z0: r.y, z1: r.y + 0.2 } : { ...base, x0: r.x, x1: r.x + 0.2, z0: r.y + p.y, z1: r.y + p.y + n });
        } else {
          const [w, h] = footSize(item, p.rot);
          out.push({ ...base, x0: r.x + p.x, x1: r.x + p.x + w, z0: r.y + p.y, z1: r.y + p.y + h });
        }
      });
    }
    return out;
  }, [plan, layouts]);
  const start = useMemo(() => ({ x: props.start.x + 0.5, z: props.start.y + 0.5 }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [center, setCenter] = useState<Tile>(props.start);
  const onTile = useCallback((t: Tile) => setCenter((c) => (Math.abs(c.x - t.x) + Math.abs(c.y - t.y) > 3 ? t : c)), []);

  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  const [sound, setSound] = useState(soundOn);
  const [near, setNear] = useState<Near | null>(null);
  const [msg, setMsg] = useState<string | null>('Joystick ile yürü · boş yerde sürükleyip etrafına bak');
  const [party, setParty] = useState(false);
  const [pendingStars, setPendingStars] = useState<number[]>([]);

  const ctl = useRef<Ctl>({ jx: 0, jy: 0, joy: false, keys: new Set(), jump: false, jumpHeld: false, yaw: 0, pitch: 0.5, dist: 5.4, lastLook: 0, paused });
  // Kapının önünden başla; kamera önden (güneyden) bakar
  const player = useRef<PlayerState>({ x: start.x, z: start.z, y: 0, vy: 0, face: Math.PI, jumps: 0 });
  const nearRef = useRef<Near | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const got = useMemo(() => new Set([...props.starsGot, ...pendingStars]), [props.starsGot, pendingStars]);

  useEffect(() => {
    ctl.current.paused = paused;
    if (paused) {
      ctl.current.keys.clear();
      ctl.current.jx = ctl.current.jy = 0;
    }
  }, [paused]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    msgTimer.current = setTimeout(() => setMsg(null), 3500);
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.cursor = '';
      clearInterval(id);
      clearTimeout(msgTimer.current);
    };
  }, []);

  const act = useCallback(() => {
    const n = nearRef.current;
    if (!n) return;
    sfx.pop();
    setSel({ space: n.space, index: n.index });
  }, []);

  const onNear = useCallback((n: Near | null) => {
    nearRef.current = n;
    setNear(n);
    if (n) sfx.pop();
  }, []);

  // ---------- Eşyalar ----------
  /** Dokunulan eşya: seçenek balonu açılır (kullanmak için yanına yürümek gerekir) */
  const onItem = useCallback((kind: 'down' | 'click', space: SpaceId, index: number, e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (kind === 'down' || !isTap(e as ThreeEvent<MouseEvent>)) return;
    e.stopPropagation();
    sfx.pop();
    setMe(false);
    setBag(false);
    setSel({ space, index });
  }, []);
  const selSpot = sel ? spots.find((x) => x.space === sel.space && x.index === sel.index) : undefined;
  const nearSel = () => {
    const p = player.current;
    return !selSpot || rectDist(selSpot, p.x, p.z) <= TAP_REACH;
  };
  const say = (text: string) => {
    clearTimeout(msgTimer.current);
    setMsg(text);
    msgTimer.current = setTimeout(() => setMsg(null), 2600);
  };
  /** Eşyanın üstünden kalk */
  const standUp = useCallback(() => {
    const p = player.current;
    if (!p.pose) return;
    p.x = p.pose.back.x;
    p.z = p.pose.back.z;
    p.pose = null;
    setPosed(null);
  }, []);
  const selPlaced = sel ? props.layouts[sel.space]?.items[sel.index] : undefined;
  const selItem = selPlaced ? itemById(selPlaced.item) : undefined;
  const selKey = sel && selPlaced ? powerKey(sel.space, selPlaced) : '';
  const selOn = selItem && selPlaced ? isOn(selItem, selPlaced) : false;
  const selPosed = !!posed && !!sel && posed.space === sel.space && posed.index === sel.index;
  const selActions = selItem && selPlaced ? itemActions(selItem, selPlaced, { posed: selPosed, today }) : [];
  const runSel = (id: ActionId) => {
    if (!sel || !selItem || !selPlaced) return;
    if (id === 'stand') return standUp();
    if (!nearSel()) return say(`Önce ${selItem.name} yanına yürü.`);
    player.current.emote = null;
    if (id === 'sit' || id === 'lie' || id === 'swing') {
      const r = regionOf(plan, sel.space);
      const seat = seatOf(selItem, selPlaced);
      if (!r || !seat) return;
      const p = player.current;
      p.pose = { ...seat, x: r.x + seat.x, z: r.y + seat.z, back: { x: p.x, z: p.z } };
      p.y = 0;
      p.vy = 0;
      setPosed(sel);
      sfx.pop();
      return;
    }
    props.onAction(sel, id);
  };
  const startCarry = () => {
    if (!sel || !selItem || !selPlaced) return;
    standUp();
    setCarry({ space: sel.space, index: sel.index, item: selItem, rot: selPlaced.rot });
    setSel(null);
    say(selItem.placement === 'wall' ? 'Duvarın dibine gel, duvara bak, sonra Bırak.' : 'Yürü ve dön: eşya önünde gelir. Yeşilken Bırak.');
  };
  const carryRegion = carry ? regionOf(plan, carry.space) : null;
  const carryP = carry && spot ? { item: carry.item.id, x: spot.x, y: spot.y, rot: carry.item.placement === 'wall' ? wallRot(spot.x, spot.y) : carry.rot } : null;
  const carryOk = !!carry && !!carryP && canPlaceAt(carry.space, layouts[carry.space] ?? { items: [] }, plan.ctx, carryP);
  const dropCarry = () => {
    if (!carry || !carryP) return;
    if (carry.index == null) {
      // Envanterden: Habbo gibi çit, yol elde kalır
      const left = props.inventoryFor(carry.space).find((x) => x.it.id === carry.item.id)?.n ?? 0;
      const err = props.onPlace(carry.space, carryP);
      if (err) return say(err);
      if (carry.item.repeat && left > 1) return;
    } else {
      const err = props.onMove({ space: carry.space, index: carry.index }, { x: carryP.x, y: carryP.y }, carryP.rot);
      if (err) return say(err);
    }
    setCarry(null);
    setSpot(null);
  };
  // Envanter: gezilen oda
  const bagSpace: SpaceId = room.id;
  /** Envanterden ya da dükkândan gelen eşyayı karakterin önünde taşı */
  const carryFresh = (it: Item) => {
    if (!fitsSpace(it, bagSpace, plan.ctx)) return say(it.placement === 'outdoor' ? `${it.name} terasa konur.` : `${it.name} evin içine konur.`);
    standUp();
    setSel(null);
    setMe(false);
    setBag(false);
    setCarry({ space: bagSpace, index: null, item: it, rot: it.rotations?.[0] ?? 0 });
    say(it.placement === 'wall' ? 'Duvarın dibine gel, duvara bak, sonra Bırak.' : 'Yürü ve dön: eşya önünde gelir. Yeşilken Bırak.');
  };
  // Dükkândan "Hemen yerleştir"
  useEffect(() => {
    const c = props.carryNew;
    const it = c && itemById(c.item);
    if (it) carryFresh(it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.carryNew?.n]);
  /** Karakter menüsü: dans et, el salla, dur */
  const emote = (kind: 'dance' | 'wave' | null) => {
    standUp();
    player.current.emote = kind ? { kind, until: kind === 'wave' ? performance.now() + 2500 : undefined } : null;
    setMe(false);
  };
  const leader = useCallback(() => {
    const p = player.current;
    return p.pose ? { x: p.pose.back.x, z: p.pose.back.z, face: p.pose.face } : { x: p.x, z: p.z, face: p.face };
  }, []);
  const selected = useMemo(() => sel ?? null, [sel]);

  const collect = useCallback(
    (i: number) => {
      if (got.has(i)) return;
      setPendingStars((p) => [...p, i]);
      sfx.star();
      if (got.size + 1 >= stars.length) {
        setTimeout(() => sfx.plant(), 250);
        setParty(true);
        setTimeout(() => setParty(false), 3500);
      }
      props.onStar(i).catch(() => setPendingStars((p) => p.filter((x) => x !== i)));
    },
    [got, stars, props],
  );

  // Klavye
  useEffect(() => {
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    const down = (e: KeyboardEvent) => {
      const c = ctl.current;
      if (paused) return;
      if (e.code === 'Escape') {
        if (me) setMe(false);
        else if (bag) setBag(false);
        else if (sel) setSel(null);
        else if (carry) setCarry(null);
        else onClose();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) c.jump = true;
        c.jumpHeld = true;
      } else if (e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) {
          if (carry) dropCarry();
          else act();
        }
      } else if (MOVE.has(e.code)) {
        e.preventDefault();
        c.keys.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => {
      ctl.current.keys.delete(e.code);
      if (e.code === 'Space') ctl.current.jumpHeld = false;
    };
    const blur = () => ctl.current.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  });

  // Boş yerde sürükleme kamerayı çevirir (joystick kendi parmağını yakalar)
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const lookDown = (e: RPointerEvent) => {
    if ((e.target as Element).tagName !== 'CANVAS' || look.current) return;
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: RPointerEvent) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    const c = ctl.current;
    c.yaw -= (e.clientX - l.x) * 0.008;
    c.pitch = Math.min(1.1, Math.max(0.12, c.pitch + (e.clientY - l.y) * 0.005));
    c.lastLook = performance.now();
    l.x = e.clientX;
    l.y = e.clientY;
  };
  const lookUp = (e: RPointerEvent) => {
    if (look.current?.id === e.pointerId) look.current = null;
  };

  const L = LIGHT[phase];
  const sunAt = useCallback(() => ({ x: player.current.x, z: player.current.z }), []);

  return (
    <div
      className={`explore phase-${phase}`}
      style={{ background: L.horizon }}
      role="dialog"
      aria-label="Dünyanda gezinti"
      onPointerDown={lookDown}
      onPointerMove={lookMove}
      onPointerUp={lookUp}
      onPointerCancel={lookUp}
      onWheel={(e) => {
        ctl.current.dist = Math.min(8, Math.max(2.8, ctl.current.dist + e.deltaY * 0.004));
      }}
    >
      <Canvas
        shadows={shadowsFor(props.quality)}
        dpr={[1, props.quality === 'dusuk' ? 1.5 : 1.75]}
        gl={{ antialias: props.quality !== 'yuksek' }}
        camera={{ fov: 55, near: 0.1, far: 160, position: [start.x, 4, start.z + 6] }}
      >
        <Atmosphere phase={phase} quality={props.quality} mode="third" target={sunAt} />
        <QualityContext.Provider value={props.quality}>
          <Suspense fallback={null}>
            <WorldScene
              plan={plan}
              map={map}
              layouts={layouts}
              creatures={props.creatures}
              night={phase === 'gece' || phase === 'aksam'}
              books={props.books}
              reading={props.reading}
              phase={phase}
              channels={props.channels}
              tv={props.tv}
              center={center}
              selected={selected}
              posed={posed}
              onItem={carry ? undefined : onItem}
            />
            {carry && carryRegion && carryP && (
              <group position={[carryRegion.x, 0, carryRegion.y]}>
                <FootTiles item={carry.item} x={carryP.x} y={carryP.y} rot={carryP.rot} ok={carryOk} />
                <Suspense fallback={null}>
                  <ItemModel item={carry.item} x={carryP.x} y={carryP.y} rot={carryP.rot} ghost={carryOk ? 'ok' : 'bad'} lift={0.05} />
                </Suspense>
              </group>
            )}
            {stars.map((s, i) => !got.has(i) && <Star key={i} x={s.x} z={s.z} i={i} />)}
            <Player
              look={props.look}
              holding={props.holding}
              player={player}
              ctl={ctl}
              blocked={blocked}
              step={step}
              size={size}
              perks={perks}
              onTile={onTile}
              onStand={standUp}
              onTap={() => {
                sfx.pop();
                setSel(null);
                setBag(false);
                setMe((m) => !m);
              }}
            />
            <Companions pets={props.pets} at={leader} />
          </Suspense>
          {perks.trail && <Trail player={player} />}
          <Lantern player={player} night={phase === 'gece' || phase === 'aksam'} />
          {props.quality === 'yuksek' && <Effects night={phase === 'gece' || phase === 'aksam'} />}
          <FollowCam player={player} ctl={ctl} />
          <Brain player={player} spots={carry ? NO_SPOTS : spots} stars={stars} got={got} onNear={onNear} onStar={collect} />
          {carry && carryRegion && <Carry player={player} carry={carry} region={carryRegion} onSpot={setSpot} />}
        </QualityContext.Provider>
      </Canvas>

      <div className="explore-top">
        <button className="explore-chip" aria-label="Gezintiden çık" onClick={onClose}>
          ✕
        </button>
        {stars.length > 0 && (
          <span className="explore-chip" aria-label={`Bugün ${got.size} / ${stars.length} yıldız`}>
            ⭐ {got.size}/{stars.length}
          </span>
        )}
        <span className="grow" />
        <button
          className={`explore-chip${me ? ' on' : ''}`}
          aria-label="Karakterim"
          onClick={() => {
            setSel(null);
            setBag(false);
            setMe(!me);
          }}
        >
          🙂
        </button>
        <button
          className={`explore-chip${bag ? ' on' : ''}`}
          aria-label="Envanter"
          onClick={() => {
            setSel(null);
            setMe(false);
            setCarry(null);
            setBag(!bag);
          }}
        >
          🎒
        </button>
        <button className="explore-chip" aria-label="Dükkân" onClick={props.onShop}>
          🛍️
        </button>
        <button
          className="explore-chip"
          aria-label={sound ? 'Sesi kapat' : 'Sesi aç'}
          onClick={() => {
            setSoundOn(!sound);
            setSound(!sound);
          }}
        >
          {sound ? '🔊' : '🔇'}
        </button>
      </div>

      {props.toast ? (
        <div className="explore-msg" role="status">
          {props.toast}
        </div>
      ) : msg && (!near || carry) ? (
        <div className="explore-msg">{msg}</div>
      ) : near && !sel ? (
        <div className="explore-msg near" role="status">
          {near.item.icon} <strong>{near.item.name}</strong> · dokun
        </div>
      ) : null}
      {party && (
        <div className="explore-party" role="status">
          <span>⭐</span>
          <strong>Bugünün yıldızlarının hepsini topladın!</strong>
          <span className="muted small">Yarın yeni yıldızlar saklanacak. Yıldızlar koleksiyonunda birikir.</span>
        </div>
      )}

      <Joystick ctl={ctl} />
      <button
        className="explore-round explore-jump"
        aria-label="Zıpla"
        onPointerDown={(e) => {
          e.preventDefault();
          ctl.current.jump = true;
          ctl.current.jumpHeld = true;
        }}
        onPointerUp={() => (ctl.current.jumpHeld = false)}
        onPointerCancel={() => (ctl.current.jumpHeld = false)}
        onPointerLeave={() => (ctl.current.jumpHeld = false)}
      >
        ⤴
      </button>
      {near && !sel && !carry && !bag && !me && (
        <button className="explore-act" onClick={act}>
          {near.item.icon} Seçenekler
          <span className="explore-key">E</span>
        </button>
      )}
      {sel && selItem && !carry && (
        <div className="explore-bar explore-dock" role="region" aria-label={selItem.name}>
          <div className="dock-head">
            <span className="grow dock-text">
              {selItem.icon} <strong>{selItem.name}</strong>
            </span>
            <button className="pop-x" onClick={() => setSel(null)} aria-label="Kapat">
              ✕
            </button>
          </div>
          {(selActions.length > 0 || (selItem.fx === 'tv' && selOn)) && (
            <div className="dock-btns">
              {selActions.map((a, k) => (
                <button key={a.id} className={`btn sm${k === 0 ? ' primary' : ''}`} onClick={() => runSel(a.id)}>
                  {a.label}
                </button>
              ))}
              {selItem.fx === 'tv' && selOn && (
                <button className="btn sm" onClick={() => props.onChannel(sel)}>
                  🔁 {(props.channels[selKey] ?? 0) === 0 ? 'Ormanım' : 'Çalışmam'}
                </button>
              )}
            </div>
          )}
          <div className="dock-btns edit">
            <button className="btn sm" onClick={startCarry}>
              ✋ Taşı
            </button>
            {canRotate(selItem) && (
              <button
                className="btn sm"
                onClick={() => {
                  const err = props.onRotate(sel);
                  if (err) say(err);
                }}
              >
                ↻ Döndür
              </button>
            )}
            <button
              className="btn sm"
              onClick={() => {
                standUp();
                props.onRemove(sel);
                setSel(null);
              }}
            >
              📦 Kaldır
            </button>
          </div>
        </div>
      )}
      {me && (
        <div className="explore-bar explore-dock" role="region" aria-label="Karakterin">
          <div className="dock-head">
            <span className="grow dock-text">
              🙂 <strong>Ben</strong>
            </span>
            <button className="pop-x" onClick={() => setMe(false)} aria-label="Kapat">
              ✕
            </button>
          </div>
          <div className="dock-btns">
            {player.current.emote?.kind === 'dance' ? (
              <button className="btn sm primary" onClick={() => emote(null)}>
                ⏹ Dur
              </button>
            ) : (
              <button className="btn sm primary" onClick={() => emote('dance')}>
                💃 Dans et
              </button>
            )}
            <button className="btn sm" onClick={() => emote('wave')}>
              👋 El salla
            </button>
            <button
              className="btn sm"
              onClick={() => {
                setMe(false);
                props.onMe('pets');
              }}
            >
              🐾 Hayvanımı yanıma al
            </button>
          </div>
          <div className="dock-btns edit">
            <button
              className="btn sm"
              onClick={() => {
                setMe(false);
                props.onMe('top');
              }}
            >
              👕 Kıyafet değiştir
            </button>
            <button
              className="btn sm"
              onClick={() => {
                setMe(false);
                props.onMe('govde');
              }}
            >
              🙂 Görünüşüm
            </button>
          </div>
        </div>
      )}
      {bag && !carry && (
        <InventoryDrawer
          space={bagSpace}
          layout={props.layouts[bagSpace]}
          ctx={plan.ctx}
          items={props.inventoryFor(bagSpace)}
          owned={props.owned}
          onHold={carryFresh}
          onCover={(slot, id) => props.onCover(bagSpace, slot, id)}
          onClose={() => setBag(false)}
          onShop={props.onShop}
          tools={
            <span className="grow">
              🎒 <strong>Envanter</strong> <span className="muted small">· bir eşya seç: önünde taşırsın</span>
            </span>
          }
        />
      )}
      {carry && (
        <div className="explore-bar" role="toolbar" aria-label={carry.item.name}>
          <span className="use-name">
            ✋ <strong>{carry.item.name}</strong> <span className="muted small">· {carryOk ? 'buraya konur' : carry.item.placement === 'wall' && !spot ? 'duvara bak' : 'buraya konamaz'}</span>
          </span>
          {canRotate(carry.item) && (
            <button className="btn sm" onClick={() => setCarry({ ...carry, rot: nextRot(carry.item, carry.rot) })}>
              ↻ Döndür
            </button>
          )}
          <button className="btn sm primary" onClick={dropCarry} disabled={!carryOk}>
            ✓ Bırak
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              setCarry(null);
              setSpot(null);
            }}
          >
            ✕ Vazgeç
          </button>
        </div>
      )}
    </div>
  );
}

const NO_SPOTS: Spot[] = [];

/** Her karede: en yakın ağaç ya da eşya ve yıldız toplama. React'e yalnızca değişince haber verir. */
function Brain({
  player,
  spots,
  stars,
  got,
  onNear,
  onStar,
}: {
  player: MutableRefObject<PlayerState>;
  spots: Spot[];
  stars: { x: number; z: number }[];
  got: Set<number>;
  onNear: (n: Near | null) => void;
  onStar: (i: number) => void;
}) {
  const last = useRef('');
  useFrame(() => {
    const p = player.current;
    let item: Spot | null = null;
    let itemD = ITEM_REACH;
    for (const s of spots) {
      const d = rectDist(s, p.x, p.z);
      if (d <= itemD) {
        item = s;
        itemD = d;
      }
    }
    const n: Near | null = item ? { kind: 'item', key: item.key, space: item.space, index: item.index, item: item.item } : null;
    const key = n?.key ?? '';
    if (key !== last.current) {
      last.current = key;
      onNear(n);
    }
    stars.forEach((s, i) => {
      if (!got.has(i) && p.y < 1.2 && Math.hypot(s.x - p.x, s.z - p.z) < STAR_REACH) onStar(i);
    });
  });
  return null;
}

/** Avatar: kontrollere göre yürür, koşar, zıplar, süzülür; engellere çarpar, kıyıdan düşmez. */
function Player({
  look,
  holding,
  player,
  ctl,
  blocked,
  step,
  size,
  perks,
  onTile,
  onStand,
  onTap,
}: {
  look: AvatarLook;
  holding: string | null;
  player: MutableRefObject<PlayerState>;
  ctl: MutableRefObject<Ctl>;
  blocked: Set<string>;
  step: Step;
  size: { w: number; h: number };
  perks: Perks;
  onTile: (t: Tile) => void;
  /** Otururken hareket edilince kalkar */
  onStand: () => void;
  /** Karaktere dokunuldu (karakter menüsü) */
  onTap: () => void;
}) {
  const group = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const tile = useRef('');
  const anim = useRef<AvatarAnim>({ state: 'wave' });
  const waveUntil = useRef(performance.now() + 1300);
  /** Yatay hız (hızlanma/sürtünme), yerden ayrılınca kalan zıplama süresi, erken basılan zıplama, iniş ezilmesi */
  const vel = useRef({ x: 0, z: 0 });
  const coyote = useRef(0);
  const buffer = useRef(0);
  const squash = useRef(0);
  const blend = useRef(newBlend());
  const shadow = useRef<Group>(null);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = group.current;
    const n = inner.current;
    if (!g || !n) return;
    const c = ctl.current;
    const p = player.current;
    if (p.pose) {
      const k = c.keys;
      const moving = !c.paused && ((c.joy && Math.hypot(c.jx, c.jy) > 0.3) || [...k].some((x) => x !== 'ShiftLeft' && x !== 'ShiftRight') || c.jump);
      if (!moving) {
        blendStart(blend.current, `${p.pose.kind}:${p.pose.x},${p.pose.z}`, g, n);
        anim.current.state = p.pose.kind;
        applyPose(g, n, p.pose, clock.elapsedTime);
        blendApply(blend.current, g, n, dt);
        vel.current = { x: 0, z: 0 };
        return;
      }
      c.jump = false;
      onStand();
    }
    blendStart(blend.current, '', g, n);
    n.position.set(0, 0, 0);
    n.rotation.set(0, 0, 0);
    let ix = 0;
    let iy = 0;
    let run = false;
    if (!c.paused) {
      const k = c.keys;
      ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      iy = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      run = k.has('ShiftLeft') || k.has('ShiftRight');
      if (c.joy) {
        ix = c.jx;
        iy = c.jy;
        run = Math.hypot(ix, iy) > 0.85;
      }
    }
    const [dx, dz] = moveDir(ix, iy, c.yaw);
    const mag = Math.hypot(dx, dz);
    const grounded = p.y <= 0.001;
    // Hız girdiye yumuşakça yaklaşır: kalkışta hızlanır, bırakınca kısa kayıp durur (havada daha az kontrol)
    const top = mag > 0.05 ? (run ? RUN * perks.runBoost : WALK) * Math.max(0.35, mag) : 0;
    const wantX = mag > 0.05 ? (dx / mag) * top : 0;
    const wantZ = mag > 0.05 ? (dz / mag) * top : 0;
    const v = vel.current;
    const grip = grounded ? (mag > 0.05 ? 12 : 16) : 4;
    v.x = damp(v.x, wantX, grip, dt);
    v.z = damp(v.z, wantZ, grip, dt);
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.02) {
      const [x, z] = resolveMove([p.x, p.z], [p.x + v.x * dt, p.z + v.z * dt], blocked, size.w, size.h, step);
      // Duvara çarpınca o yöndeki hız biter
      if (dt > 0) {
        v.x = (x - p.x) / dt;
        v.z = (z - p.z) / dt;
      }
      p.x = x;
      p.z = z;
    } else {
      v.x = 0;
      v.z = 0;
    }
    if (mag > 0.05) {
      p.face = dampAngle(p.face, Math.atan2(dx, dz), 12, dt);
      // İleri yürürken kamera yavaşça arkaya geçer (çocuk kamerayı hiç çevirmese de kaybolmasın)
      if (iy > 0 && performance.now() - c.lastLook > 800) {
        let cd = p.face + Math.PI - c.yaw;
        cd = Math.atan2(Math.sin(cd), Math.cos(cd));
        c.yaw += cd * Math.min(1, dt * 1.4 * iy);
      }
    }
    if (mag > 0.05 || c.jump) p.emote = null;
    if (p.emote?.until != null && performance.now() > p.emote.until) p.emote = null;
    if (grounded) {
      p.jumps = perks.doubleJump ? 1 : 0;
      coyote.current = 0.1;
    } else coyote.current -= dt;
    // Zıplama tamponu: yere değmeden az önce basılan zıplama da sayılır
    if (c.jump) {
      c.jump = false;
      if (!c.paused) buffer.current = 0.12;
    } else buffer.current -= dt;
    if (buffer.current > 0) {
      const canGround = coyote.current > 0 && p.vy <= 0;
      if (canGround || (!grounded && p.jumps > 0 && buffer.current >= 0.11)) {
        if (!canGround) p.jumps--;
        p.vy = canGround ? JUMP_V : JUMP_V * 0.85;
        coyote.current = 0;
        buffer.current = 0;
        squash.current = -0.12;
        sfx.jump();
      }
    }
    let gliding = false;
    if (p.y > 0 || p.vy > 0) {
      p.vy -= GRAVITY * dt;
      // Süzülme: zıplama basılıyken yavaş iner
      if (perks.glide && c.jumpHeld && p.vy < -1.1) {
        p.vy = -1.1;
        gliding = true;
      }
      p.y = Math.max(0, p.y + p.vy * dt);
      if (p.y === 0) {
        // İniş: düşüş hızına göre kısa ezilme
        squash.current = Math.min(0.22, Math.abs(p.vy) * 0.025);
        p.vy = 0;
      }
    }
    squash.current = damp(squash.current, 0, 14, dt);
    anim.current.state =
      performance.now() < waveUntil.current ? 'wave' : p.y > 0.05 ? (gliding ? 'glide' : p.vy > 0 ? 'jump' : 'fall') : sp > 0.3 ? (sp > WALK * 1.25 ? 'run' : 'walk') : (p.emote?.kind ?? 'idle');
    anim.current.speed = sp;
    g.position.set(p.x, p.y + 0.02, p.z);
    g.rotation.y = p.face;
    blendApply(blend.current, g, n, dt);
    // Ezilme: inişte basık, kalkışta uzun (hacim korunur)
    const q = squash.current;
    n.scale.set(1 + q * 0.5, 1 - q, 1 + q * 0.5);
    // Leke gölge yerde kalır; zıpladıkça küçülür
    const sh = shadow.current;
    if (sh) {
      sh.position.set(g.position.x, 0, g.position.z);
      sh.scale.setScalar(Math.max(0.4, 1 - p.y * 0.35));
    }
    const t = { x: Math.floor(p.x), y: Math.floor(p.z) };
    if (tile.current !== `${t.x},${t.y}`) {
      tile.current = `${t.x},${t.y}`;
      onTile(t);
    }
  });

  return (
    <>
      <group ref={shadow}>
        <Blob size={0.75} />
      </group>
      <group
        ref={group}
        onClick={(e) => {
          if (!isTap(e)) return;
          e.stopPropagation();
          onTap();
        }}
      >
        <group ref={inner}>
          <AvatarModel look={look} anim={anim} live holding={holding} />
        </group>
      </group>
    </>
  );
}

/** Elde taşınan eşyanın konacağı karo: her karede karakterin önü hesaplanır, değişince bildirilir */
function Carry({ player, carry, region, onSpot }: { player: MutableRefObject<PlayerState>; carry: { item: Item; rot: number }; region: Region; onSpot: (t: Tile | null) => void }) {
  const last = useRef<string | null>(null);
  useFrame(() => {
    const p = player.current;
    const t = carrySpot(carry.item, carry.rot, p.x, p.z, p.face, region);
    const k = t ? `${t.x},${t.y},${carry.rot}` : '';
    if (k !== last.current) {
      last.current = k;
      onSpot(t);
    }
  });
  return null;
}

/** Orman Bilgesi: yürürken arkada altın parıltılar */
function Trail({ player }: { player: MutableRefObject<PlayerState> }) {
  const N = 40;
  const mesh = useRef<InstancedMesh>(null);
  const parts = useMemo(() => Array.from({ length: N }, () => ({ x: 0, y: -10, z: 0, born: -10 })), []);
  const head = useRef(0);
  const last = useRef({ x: 0, z: 0 });
  const tmp = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const p = player.current;
    const t = clock.elapsedTime;
    if (Math.hypot(p.x - last.current.x, p.z - last.current.z) > 0.25) {
      last.current = { x: p.x, z: p.z };
      parts[head.current] = { x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + 0.15 + Math.random() * 0.3, z: p.z + (Math.random() - 0.5) * 0.3, born: t };
      head.current = (head.current + 1) % N;
    }
    if (!mesh.current) return;
    parts.forEach((q, i) => {
      const age = t - q.born;
      tmp.position.set(q.x, q.y + age * 0.4, q.z);
      tmp.scale.setScalar(Math.max(0, 1 - age / 1.2) * 0.05);
      tmp.updateMatrix();
      mesh.current!.setMatrixAt(i, tmp.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#ffd23f" toneMapped={false} />
    </instancedMesh>
  );
}

/** Karakterin önünü aydınlatan yumuşak ışık; akşam ve gece fener gibi daha güçlü */
function Lantern({ player, night }: { player: MutableRefObject<PlayerState>; night: boolean }) {
  const ref = useRef<PointLight>(null);
  const { camera } = useThree();
  useFrame(() => {
    const p = player.current;
    // Kameradan karaktere doğru, karakterin biraz önünde ve üstünde
    ref.current?.position.set((camera.position.x + p.x * 2) / 3, p.y + 1.4, (camera.position.z + p.z * 2) / 3);
  });
  return <pointLight ref={ref} color={night ? '#ffd9a0' : '#ffffff'} intensity={night ? 5 : 1.6} distance={night ? 6 : 4} decay={1.4} />;
}

/** Kamera karakteri arkadan ve yukarıdan yumuşakça izler. */
function FollowCam({ player, ctl }: { player: MutableRefObject<PlayerState>; ctl: MutableRefObject<Ctl> }) {
  const { camera } = useThree();
  const want = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  const first = useRef(true);
  useFrame((_, dt) => {
    const c = ctl.current;
    const p = player.current;
    const [yaw, pitch, dist] = [c.yaw, c.pitch, c.dist];
    want.set(p.x + Math.sin(yaw) * Math.cos(pitch) * dist, p.y + 0.6 + Math.sin(pitch) * dist, p.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    const k = first.current ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    camera.position.lerp(want, k);
    // Bakış noktası da yumuşak: zıplarken görüntü titremez (dikeyde daha yavaş)
    if (first.current) target.set(p.x, p.y + 0.7, p.z);
    else {
      const kd = Math.min(dt, 0.1);
      target.x = damp(target.x, p.x, 12, kd);
      target.z = damp(target.z, p.z, 12, kd);
      target.y = damp(target.y, p.y * 0.6 + 0.7, 5, kd);
    }
    camera.lookAt(target);
    first.current = false;
  });
  return null;
}

let starGeo: ExtrudeGeometry | null = null;
function starGeometry() {
  if (starGeo) return starGeo;
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.1 : 0.22;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  starGeo = new ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false });
  starGeo.center();
  return starGeo;
}

/** Toplanacak yıldız: döner ve süzülür */
function Star({ x, z, i }: { x: number; z: number; i: number }) {
  const ref = useRef<Group>(null);
  const geo = useMemo(starGeometry, []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.y = t * 2 + i;
    g.position.y = 0.55 + Math.sin(t * 3 + i) * 0.1;
  });
  return (
    <group ref={ref} position={[x, 0.55, z]}>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.6} flatShading />
      </mesh>
    </group>
  );
}

/** Sol alttaki sanal joystick. Parmağı yakalar; kamera sürüklemesiyle karışmaz. */
function Joystick({ ctl }: { ctl: MutableRefObject<Ctl> }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const id = useRef<number | null>(null);
  const update = (e: RPointerEvent) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const max = r.width / 2;
    let dx = e.clientX - (r.left + max);
    let dy = e.clientY - (r.top + max);
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx *= max / d;
      dy *= max / d;
    }
    ctl.current.jx = dx / max;
    ctl.current.jy = -dy / max;
    ctl.current.joy = true;
    setKnob([dx, dy]);
  };
  const end = (e: RPointerEvent) => {
    if (id.current !== e.pointerId) return;
    id.current = null;
    ctl.current.jx = ctl.current.jy = 0;
    ctl.current.joy = false;
    setKnob([0, 0]);
  };
  return (
    <div
      ref={base}
      className="joy"
      role="presentation"
      onPointerDown={(e) => {
        if (id.current !== null) return;
        e.preventDefault();
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => id.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className={`joy-knob${knob[0] || knob[1] ? ' held' : ''}`} style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}
