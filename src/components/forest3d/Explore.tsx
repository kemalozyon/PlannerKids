// "Yakından gez": çocuk kendi avatarıyla bütün dünyada (ev, bahçe, orman yolu, ay bahçeleri) üçüncü şahıs
// kamerayla yürür. Sahne dünya görünümüyle aynıdır (world3d/WorldScene, aynı dünya planı); yalnızca kamera ve
// kontroller farklı. Alanlar arasında yalnızca kapılardan geçilir; eve girince çatı kalkar. Bir ağaca yaklaşınca o
// günün özeti çıkar, "Bak" ile gün kartı açılır; her gün saklanan yıldızlar toplanır.
// Bir eşyaya yaklaşınca adı çıkar; ona (ya da düğmeye, E'ye) dokununca dört seçenek: Kullan (otur, yat, sallan,
// aç-kapa, raflar), Taşı (eşya karakterin önünde yeşil/kırmızı hayalet olarak gezer, "Bırak" ile öndeki karoya
// konur; explore.ts → carrySpot), Döndür, Kaldır. Kayıtlar dünya sayfasının işleriyle (World.tsx) yapılır. Seviye atladıkça yeni yetenekler açılır (level.ts). Dokunmatikte sol altta joystick + zıpla, boş
// yerde sürükleyerek etrafa bakılır; klavyede WASD/oklar, Shift koş, boşluk zıpla (basılı tut: süzül), E bak, Esc çık.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { ExtrudeGeometry, InstancedMesh, Object3D, Shape, Vector3, type DirectionalLight, type Group, type PointLight } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { AvatarLook } from '../../lib/avatar';
import { has, itemById, type Item } from '../../lib/catalog';
import { CFG, type MapDef } from '../../lib/config';
import { dayPhase } from '../../lib/dayPhase';
import { formatMinutes, formatShort } from '../../lib/date';
import { carrySpot, dailyStars, moveDir, nearest, resolveMove, STAR_REACH } from '../../lib/explore';
import type { Perks } from '../../lib/level';
import { setSoundOn, sfx, soundOn } from '../../lib/sfx';
import type { Book } from '../../lib/types';
import {
  canPlaceAt,
  canRotate,
  footSize,
  isIndoor,
  isMonthSpace,
  isOn,
  itemActions,
  key,
  nextRot,
  plotOf,
  powerKey,
  removeItemAt,
  seatOf,
  wallRot,
  type ActionId,
  type DayTree,
  type Pose,
  type SpaceId,
  type SpaceLayout,
  type Step,
  type Tile,
} from '../../lib/world';
import { canStep, regionAt, regionOf, worldBlocked, type Region, type RegionId, type WorldPlan } from '../../lib/worldPlan';
import AvatarModel, { type AvatarAnim } from '../avatar/AvatarModel';
import { applyPose } from '../world3d/Avatar';
import { FootTiles, ItemModel } from '../world3d/items';
import { isTap, LIGHT } from '../world3d/light';
import type { TvData } from '../world3d/art';
import WorldScene from '../world3d/WorldScene';

const WALK = 2.2;
const RUN = 4;
const GRAVITY = 14;
const JUMP_V = 5;
/** Bir ağacın "yanında" sayılma uzaklığı */
const REACH = 1.3;

/** Bir eşyanın "yanında" sayılma uzaklığı (ayak izinin kenarından); dokununca seçenekler için biraz daha uzak */
const ITEM_REACH = 0.8;
const TAP_REACH = 1.6;

/** Bu kadar karo uzaktaki alanlar sade çizilir */
const NEAR = 22;
const NOOP = () => {};

type ItemRef = { space: SpaceId; index: number };

export interface ExploreProps {
  plan: WorldPlan;
  map: MapDef;
  layouts: Partial<Record<SpaceId, SpaceLayout>>;
  /** Bütün ağaçlar */
  forest: DayTree[];
  creatures: typeof CFG.world.creatures;
  today: string;
  /** Karakterin dünyadaki karosu (dünya görünümünde kaldığı yer) */
  start: Tile;
  books: Book[];
  reading: Book[];
  /** TV kanalları (dünya görünümüyle aynı); karakterin elindeki ikram */
  channels: Record<string, number>;
  holding: string | null;
  tv: TvData;
  /** Üstte bir pencere açıkken karakter durur, tuşlar dinlenmez */
  paused: boolean;
  onTree: (t: DayTree) => void;
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
}

type TreeNear = { kind: 'tree'; key: string; x: number; z: number; tree: DayTree };
type Near = TreeNear | { kind: 'item'; key: string; space: SpaceId; index: number; item: Item };

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
}

export default function Explore(props: ExploreProps) {
  const { plan, map, forest, today, paused, onTree, onClose, perks } = props;
  const size = { w: plan.w, h: plan.h };
  // Seçenekleri açık eşya, oturulan eşya, elde taşınan eşya (önündeki karo: spot)
  const [sel, setSel] = useState<ItemRef | null>(null);
  const [posed, setPosed] = useState<ItemRef | null>(null);
  const [carry, setCarry] = useState<{ space: SpaceId; index: number; item: Item; rot: number } | null>(null);
  const [spot, setSpot] = useState<Tile | null>(null);
  // Taşınan eşya (ve üstündekiler) yerinden kalkmış görünür; yürüyüşü engellemez
  const layouts = useMemo(
    () => (carry && props.layouts[carry.space] ? { ...props.layouts, [carry.space]: removeItemAt(props.layouts[carry.space]!, carry.index) } : props.layouts),
    [props.layouts, carry],
  );
  const blocked = useMemo(() => worldBlocked(plan, layouts), [plan, layouts]);
  const step = useMemo<Step>(() => (a, b) => canStep(plan, a, b), [plan]);
  // Yıldızlar dışarıda saklanır (ev içinde değil)
  const stars = useMemo(() => {
    // Kayıtlı yerleşimden (elde taşınan eşya yıldızları oynatmasın)
    const out = worldBlocked(plan, props.layouts);
    for (const r of plan.regions) if (isIndoor(r.id as SpaceId)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.add(key(x, y));
    return dailyStars(today, 'world', size, out);
  }, [today, plan, props.layouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const trees = useMemo<TreeNear[]>(() => {
    const out: TreeNear[] = [];
    for (const r of plan.regions) {
      if (!isMonthSpace(r.id) || r.locked) continue;
      const month = r.id.slice(2);
      for (const t of forest) {
        if (t.month !== month) continue;
        const p = plotOf(month, Number(t.date.slice(8, 10)));
        out.push({ kind: 'tree', key: t.id, x: r.x + p.x + 0.5, z: r.y + p.y + 0.5, tree: t });
      }
    }
    return out;
  }, [plan, forest]);
  // Eşyaların ayak izleri (yürünen halı/yol yakınlıkta sayılmaz: üstünde durulur)
  const spots = useMemo<Spot[]>(() => {
    const out: Spot[] = [];
    for (const r of plan.regions) {
      if (r.id === 'trail' || r.locked) continue;
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
  const [here, setHere] = useState<RegionId | null>(() => regionAt(plan, props.start)?.id ?? null);
  const [center, setCenter] = useState<Tile>(props.start);
  const nearRegions = useMemo(() => {
    const out = new Set<RegionId>();
    for (const r of plan.regions) {
      const dx = Math.max(r.x - center.x, 0, center.x - (r.x + r.w));
      const dy = Math.max(r.y - center.y, 0, center.y - (r.y + r.h));
      if (Math.hypot(dx, dy) < NEAR) out.add(r.id);
    }
    return out;
  }, [plan, center]);
  const onTile = useCallback(
    (t: Tile) => {
      setHere(regionAt(plan, t)?.id ?? null);
      setCenter((c) => (Math.abs(c.x - t.x) + Math.abs(c.y - t.y) > 3 ? t : c));
    },
    [plan],
  );

  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  const [sound, setSound] = useState(soundOn);
  const [near, setNear] = useState<Near | null>(null);
  const selRef = useRef<ItemRef | null>(null);
  selRef.current = sel;
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
    if (n.kind === 'tree') onTree(n.tree);
    else setSel({ space: n.space, index: n.index });
  }, [onTree]);

  const onNear = useCallback((n: Near | null) => {
    nearRef.current = n;
    setNear(n);
    if (n) sfx.pop();
    // Seçili eşyadan uzaklaşınca seçenekler kapanır
    const s = selRef.current;
    if (s && !(n?.kind === 'item' && n.space === s.space && n.index === s.index)) setSel(null);
  }, []);

  // ---------- Eşyalar ----------
  /** Dokunulan eşya: yakındaysa seçenekler, uzaktaysa ipucu */
  const onItem = useCallback(
    (kind: 'down' | 'click', space: SpaceId, index: number, e: ThreeEvent<PointerEvent | MouseEvent>) => {
      if (kind === 'down' || !isTap(e as ThreeEvent<MouseEvent>)) return;
      e.stopPropagation();
      const s = spots.find((x) => x.space === space && x.index === index);
      const p = player.current;
      if (s && rectDist(s, p.x, p.z) > TAP_REACH) return say('Önce yanına yürü.');
      sfx.pop();
      setSel({ space, index });
    },
    [spots], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
    const err = props.onMove({ space: carry.space, index: carry.index }, { x: carryP.x, y: carryP.y }, carryP.rot);
    if (err) return say(err);
    setCarry(null);
    setSpot(null);
  };
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
        onClose();
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
  const inside = !!here && isIndoor(here);

  return (
    <div
      className={`explore phase-${phase}`}
      style={{ background: L.sky }}
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
      <Canvas shadows dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }} camera={{ fov: 55, near: 0.1, far: 160, position: [start.x, 4, start.z + 6] }}>
        <hemisphereLight args={[L.sky2, L.ground, L.hemiI]} />
        <Sun player={player} color={L.sun} intensity={L.sunI} />
        <fog attach="fog" args={[L.fog, 18, 60]} />
        <Suspense fallback={null}>
          <WorldScene
            plan={plan}
            map={map}
            layouts={layouts}
            forest={forest}
            creatures={props.creatures}
            open={inside}
            here={here}
            night={phase === 'gece' || phase === 'aksam'}
            near={nearRegions}
            labels={false}
            growId={null}
            onGrown={NOOP}
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
          <Player look={props.look} holding={props.holding} player={player} ctl={ctl} blocked={blocked} step={step} size={size} perks={perks} onTile={onTile} onStand={standUp} />
        </Suspense>
        {perks.trail && <Trail player={player} />}
        <Lantern player={player} night={phase === 'gece' || phase === 'aksam'} />
        <FollowCam player={player} ctl={ctl} />
        <Brain player={player} trees={trees} spots={carry ? NO_SPOTS : spots} stars={stars} got={got} onNear={onNear} onStar={collect} />
        {carry && carryRegion && <Carry player={player} carry={carry} region={carryRegion} onSpot={setSpot} />}
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
      ) : near?.kind === 'tree' ? (
        <div className="explore-msg near" role="status">
          {near.tree.dry ? near.tree.icon : near.tree.species.icon} <strong>{formatShort(near.tree.date)}</strong> · {formatMinutes(near.tree.minutes)} · {near.tree.name}
        </div>
      ) : near?.kind === 'item' && !sel ? (
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
      {near && !sel && !carry && (
        <button className="explore-act" onClick={act}>
          {near.kind === 'tree' ? '👀 O güne bak' : `${near.item.icon} Seçenekler`}
          <span className="explore-key">E</span>
        </button>
      )}
      {sel && selItem && !carry && (
        <div className="explore-bar" role="toolbar" aria-label={selItem.name}>
          <span className="use-name">
            {selItem.icon} <strong>{selItem.name}</strong>
          </span>
          {selActions.length ? (
            selActions.map((a, k) => (
              <button key={a.id} className={`btn sm${k === 0 ? ' primary' : ''}`} onClick={() => runSel(a.id)}>
                {a.label}
              </button>
            ))
          ) : (
            <button className="btn sm primary" disabled>
              ▶ Kullan
            </button>
          )}
          <button className="btn sm" onClick={startCarry}>
            ✋ Taşı
          </button>
          <button
            className="btn sm"
            disabled={!canRotate(selItem)}
            onClick={() => {
              const err = props.onRotate(sel);
              if (err) say(err);
            }}
          >
            ↻ Döndür
          </button>
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
          {selItem.fx === 'tv' && selOn && (
            <button className="btn sm" onClick={() => props.onChannel(sel)}>
              🔁 {(props.channels[selKey] ?? 0) === 0 ? 'Ormanım' : 'Çalışmam'}
            </button>
          )}
          <button className="btn sm ghost" onClick={() => setSel(null)} aria-label="Kapat">
            ✕
          </button>
        </div>
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
  trees,
  spots,
  stars,
  got,
  onNear,
  onStar,
}: {
  player: MutableRefObject<PlayerState>;
  trees: TreeNear[];
  spots: Spot[];
  stars: { x: number; z: number }[];
  got: Set<number>;
  onNear: (n: Near | null) => void;
  onStar: (i: number) => void;
}) {
  const last = useRef('');
  useFrame(() => {
    const p = player.current;
    const tree = nearest([p.x, p.z], trees, REACH);
    let item: Spot | null = null;
    let itemD = ITEM_REACH;
    for (const s of spots) {
      const d = rectDist(s, p.x, p.z);
      if (d <= itemD) {
        item = s;
        itemD = d;
      }
    }
    const treeD = tree ? Math.hypot(tree.x - p.x, tree.z - p.z) - 0.5 : Infinity;
    const n: Near | null = item && itemD <= treeD ? { kind: 'item', key: item.key, space: item.space, index: item.index, item: item.item } : tree;
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
}) {
  const group = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const tile = useRef('');
  const anim = useRef<AvatarAnim>({ state: 'wave' });
  const waveUntil = useRef(performance.now() + 1300);

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
        anim.current.state = p.pose.kind;
        applyPose(g, n, p.pose, clock.elapsedTime);
        return;
      }
      c.jump = false;
      onStand();
    }
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
    if (mag > 0.05) {
      const speed = (run ? RUN * perks.runBoost : WALK) * Math.max(0.35, mag);
      const [x, z] = resolveMove([p.x, p.z], [p.x + dx * speed * dt, p.z + dz * speed * dt], blocked, size.w, size.h, step);
      p.x = x;
      p.z = z;
      let diff = Math.atan2(dx, dz) - p.face;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.face += diff * Math.min(1, dt * 12);
      // İleri yürürken kamera yavaşça arkaya geçer (çocuk kamerayı hiç çevirmese de kaybolmasın)
      if (iy > 0 && performance.now() - c.lastLook > 800) {
        let cd = p.face + Math.PI - c.yaw;
        cd = Math.atan2(Math.sin(cd), Math.cos(cd));
        c.yaw += cd * Math.min(1, dt * 1.4 * iy);
      }
    }
    const grounded = p.y <= 0.001;
    if (grounded) p.jumps = perks.doubleJump ? 1 : 0;
    if (c.jump) {
      c.jump = false;
      if (!c.paused && (grounded || p.jumps > 0)) {
        if (!grounded) p.jumps--;
        p.vy = grounded ? JUMP_V : JUMP_V * 0.85;
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
      if (p.y === 0) p.vy = 0;
    }
    anim.current.state =
      performance.now() < waveUntil.current ? 'wave' : p.y > 0.05 ? (gliding ? 'glide' : p.vy > 0 ? 'jump' : 'fall') : mag > 0.05 ? (run ? 'run' : 'walk') : 'idle';
    g.position.set(p.x, p.y + 0.02, p.z);
    g.rotation.y = p.face;
    const t = { x: Math.floor(p.x), y: Math.floor(p.z) };
    if (tile.current !== `${t.x},${t.y}`) {
      tile.current = `${t.x},${t.y}`;
      onTile(t);
    }
  });

  return (
    <group ref={group}>
      <group ref={inner}>
        <AvatarModel look={look} anim={anim} live holding={holding} />
      </group>
    </group>
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

/** Güneş gölgesi karakteri izler (dünya geniş) */
function Sun({ player, color, intensity }: { player: MutableRefObject<PlayerState>; color: string; intensity: number }) {
  const ref = useRef<DirectionalLight>(null);
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    const p = player.current;
    l.position.set(p.x + 12, 20, p.z + 8);
    l.target.position.set(p.x, 0, p.z);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={ref}
      intensity={intensity}
      color={color}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-24}
      shadow-camera-right={24}
      shadow-camera-top={24}
      shadow-camera-bottom={-24}
    />
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
    target.set(p.x, p.y + 0.7, p.z);
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
      <div className="joy-knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}
