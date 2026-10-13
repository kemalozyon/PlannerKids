// Ormanda gezinti: çocuk kendi karakteriyle ayın adasında üçüncü şahıs kamerayla yürür. Ağaçların yanına
// gidip o günü açar, hayvanları sever (bir süre peşinden gelirler), günün yıldızlarını toplar, dükkândan
// aldığı yapı ve süsleri adasına yerleştirir. Seviye atladıkça yeni yetenekler açılır (level.ts).
// Dokunmatikte sol altta joystick + zıpla, boş yerde sürükleyerek etrafa bakılır; klavyede WASD/oklar,
// Shift koş, boşluk zıpla (basılı tut: süzül), E etkileşim, Esc çık.
import { Html, useAnimations, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { Color, ExtrudeGeometry, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Shape, Vector3, type Group, type PointLight } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { itemById, type Item } from '../../lib/catalog';
import { formatShort } from '../../lib/date';
import { canPlace, dailyStars, moveDir, nearest, obstacles, resolveMove, STAR_REACH, type Circle } from '../../lib/explore';
import { BIOMES, cellPosition, dayPhase, islandLayout, islandProgress, wiltSpots } from '../../lib/island';
import type { Perks } from '../../lib/level';
import { setSoundOn, sfx, soundOn } from '../../lib/sfx';
import type { Equipped, ForestTree, OwnedItem } from '../../lib/types';
import { REVIVE_MIN, type Wilt } from '../../lib/wilt';
import { modelUrl, preloadNature, useModel } from './models';
import { LIGHT, PET_OF, PlacedModel, Sparkles, treeTop, World, type PetState, type PlacedThing } from './world';

/** İlk gezintide karakter seçimi bir kez gösterilir */
const SEEN_KEY = 'ct-explore-v2';
/** Karakterin boyu ≈ 0.9 birim (bir ızgara karesi 1 birim) */
const AVATAR_SCALE = 1.25;
const WALK = 2.2;
const RUN = 4;
const GRAVITY = 14;
const JUMP_V = 5;
/** Bir şeyin "yanında" sayılma uzaklığı */
const REACH = 1.35;
/** Sevilen hayvan bu kadar süre peşinden gelir (ms) */
const FOLLOW_MS = 20_000;

export interface ExploreProps {
  month: string;
  trees: ForestTree[];
  wilts: Wilt[];
  totalMinutes: number;
  /** Bugünün tarihi (solgun fidan ve yıldızlar için) */
  today: string;
  /** Yıldızlar ve yerleştirme yalnızca bu ayın adasında */
  current: boolean;
  minutesOf: (date: string) => number;
  /** Üstte bir pencere açıkken karakter durur, tuşlar dinlenmez */
  paused: boolean;
  onTree: (t: ForestTree) => void;
  onWilt: (w: Wilt) => void;
  onClose: () => void;
  /** Görünüş ve sahip olunan karakterler (seçim için) */
  equipped: Equipped;
  characters: Item[];
  onEquip: (e: Equipped) => Promise<void>;
  perks: Perks;
  crystals: number;
  /** Bugün toplanan yıldızlar (sırası) */
  starsGot: number[];
  onStar: (i: number) => Promise<void>;
  /** Bu ayın adasındaki yapılar ve süsler */
  placed: PlacedThing[];
  /** Adada olmayan, yerleştirilebilecek eşyalar */
  inventory: { owned: OwnedItem; item: Item }[];
  onPlace: (ownedId: string, x: number, z: number, rot: number) => Promise<void>;
  onMovePlaced: (id: string, x: number, z: number, rot: number) => Promise<void>;
  onRemovePlaced: (id: string) => Promise<void>;
  onShop: () => void;
}

type Near =
  | { kind: 'tree'; key: string; x: number; z: number; tree: ForestTree }
  | { kind: 'wilt'; key: string; x: number; z: number; w: Wilt }
  | { kind: 'pet'; key: string; x: number; z: number; id: string }
  | { kind: 'placed'; key: string; x: number; z: number; t: PlacedThing };

/** Yerleştirilen (ya da taşınan) eşya */
interface Placing {
  item: Item;
  ownedId: string;
  /** Taşınıyorsa yerleşimin kimliği */
  moveId?: string;
  rot: number;
}

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
  picking: boolean;
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
}

const firstTime = () => {
  try {
    return !localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
};

export default function Explore(props: ExploreProps) {
  const { month, trees, wilts, totalMinutes, today, current, minutesOf, paused, onTree, onWilt, onClose, equipped, characters, perks, placed, inventory } = props;
  const progress = useMemo(() => islandProgress(totalMinutes), [totalMinutes]);
  const R = progress.radius;
  const layout = useMemo(() => islandLayout(month, progress), [month, progress]);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const spotsOf = (list: PlacedThing[]) => list.map((t) => ({ x: t.p.x, z: t.p.z, r: t.item.r ?? 0.4, walk: t.item.walk }));
  const obs = useMemo(() => obstacles(trees, layout, spotsOf(placed.filter((t) => t.p.id !== placing?.moveId))), [trees, layout, placed, placing?.moveId]);
  // Yerleştirirken başka hiçbir şeyin üstüne binmesin (yollar ve çiçekler dahil)
  const taken = useMemo(
    () => [...obstacles(trees, layout), ...spotsOf(placed.filter((t) => t.p.id !== placing?.moveId)).map((s) => ({ x: s.x, z: s.z, r: s.r * 0.8 }))],
    [trees, layout, placed, placing?.moveId],
  );
  const spots = useMemo(() => wiltSpots(wilts, layout, R), [wilts, layout, R]);
  const stars = useMemo(() => (current ? dailyStars(today, trees, layout, R) : []), [current, today, trees, layout, R]);
  const companions = useMemo(() => equipped.pets.map(itemById).filter((i): i is Item => !!i?.model), [equipped.pets]);
  const accessory = equipped.accessory ? itemById(equipped.accessory) ?? null : null;

  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  const [sound, setSound] = useState(soundOn);
  const [avatar, setAvatar] = useState(() => (characters.some((c) => c.id === equipped.character) ? equipped.character : characters[0]?.id));
  const [picking, setPicking] = useState(firstTime);
  const [near, setNear] = useState<Near | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [party, setParty] = useState(false);
  const [panel, setPanel] = useState<'none' | 'bag' | 'edit'>('none');
  const [ghostOk, setGhostOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingStars, setPendingStars] = useState<number[]>([]);
  const [bursts, setBursts] = useState<{ x: number; z: number; at: number }[]>([]);

  const ctl = useRef<Ctl>({ jx: 0, jy: 0, joy: false, keys: new Set(), jump: false, jumpHeld: false, yaw: 0, pitch: 0.5, dist: 5.4, lastLook: 0, paused, picking });
  const player = useRef<PlayerState>({ x: 0, z: R - 1.8, y: 0, vy: 0, face: Math.PI, jumps: 0 });
  const pets = useRef(new Map<string, PetState>());
  const nearRef = useRef<Near | null>(null);
  const ghost = useRef({ x: 0, z: 0 });
  const msgTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const got = useMemo(() => new Set([...props.starsGot, ...pendingStars]), [props.starsGot, pendingStars]);

  useEffect(() => {
    // Bir pencere ya da panel açıkken karakter durur
    const stop = paused || picking || panel !== 'none';
    ctl.current.paused = stop;
    ctl.current.picking = picking;
    if (stop) {
      ctl.current.keys.clear();
      ctl.current.jx = ctl.current.jy = 0;
    }
  }, [paused, picking, panel]);

  const flash = useCallback((m: string, ms = 2600) => {
    setMsg(m);
    clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), ms);
  }, []);

  useEffect(() => {
    preloadNature();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.cursor = '';
      clearInterval(id);
      clearTimeout(msgTimer.current);
    };
  }, []);

  const act = useCallback(() => {
    const n = nearRef.current;
    if (!n || placing) return;
    if (n.kind === 'tree') {
      sfx.pop();
      onTree(n.tree);
    } else if (n.kind === 'wilt') {
      if (n.w.revived) sfx.pop();
      else sfx.sad();
      onWilt(n.w);
    } else if (n.kind === 'placed') {
      if (current) setPanel('edit');
    } else {
      const p = pets.current.get(n.id);
      if (!p) return;
      p.poke();
      p.followUntil = Math.max(p.followUntil, performance.now() + FOLLOW_MS);
      const name = PET_OF[n.id as keyof typeof PET_OF]?.name ?? itemById(n.id)?.name;
      const icon = BIOMES.find((b) => b.id === n.id)?.icon ?? itemById(n.id)?.icon ?? '';
      flash(companions.some((c) => c.id === n.id) ? `${icon} ${name} seni çok seviyor!` : `${icon} ${name} peşinden geliyor!`);
    }
  }, [onTree, onWilt, flash, placing, current, companions]);

  const onNear = useCallback((n: Near | null) => {
    nearRef.current = n;
    setNear(n);
  }, []);

  const collect = useCallback(
    (i: number) => {
      if (got.has(i)) return;
      setPendingStars((p) => [...p, i]);
      sfx.star();
      const st = stars[i];
      setBursts((b) => [...b.slice(-4), { x: st.x, z: st.z, at: performance.now() }]);
      if (got.size + 1 >= stars.length) {
        setTimeout(() => sfx.plant(), 250);
        setParty(true);
        setTimeout(() => setParty(false), 3500);
      }
      props.onStar(i).catch(() => setPendingStars((p) => p.filter((x) => x !== i)));
    },
    [got, stars, props],
  );

  const confirmPlace = async () => {
    if (!placing || !ghostOk || busy) return;
    setBusy(true);
    const { x, z } = ghost.current;
    try {
      if (placing.moveId) await props.onMovePlaced(placing.moveId, x, z, placing.rot);
      else await props.onPlace(placing.ownedId, x, z, placing.rot);
      sfx.plant();
      setBursts((b) => [...b.slice(-4), { x, z, at: performance.now() }]);
      flash(`${placing.item.icon} ${placing.item.name} adana yerleşti!`);
      setPlacing(null);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Klavye
  useEffect(() => {
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    const down = (e: KeyboardEvent) => {
      const c = ctl.current;
      if (paused) return;
      if (e.code === 'Escape') {
        if (c.picking) setPicking(false);
        else if (panel !== 'none') setPanel('none');
        else if (placing) setPlacing(null);
        else onClose();
        return;
      }
      if (c.paused) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) c.jump = true;
        c.jumpHeld = true;
      } else if (e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) {
          if (placing) void confirmPlace();
          else act();
        }
      } else if (e.code === 'KeyR' && placing) {
        setPlacing({ ...placing, rot: placing.rot + Math.PI / 4 });
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
    if (c.picking) return;
    c.yaw -= (e.clientX - l.x) * 0.008;
    c.pitch = Math.min(1.1, Math.max(0.12, c.pitch + (e.clientY - l.y) * 0.005));
    c.lastLook = performance.now();
    l.x = e.clientX;
    l.y = e.clientY;
  };
  const lookUp = (e: RPointerEvent) => {
    if (look.current?.id === e.pointerId) look.current = null;
  };

  const choose = (step: number) => {
    const i = Math.max(0, characters.findIndex((c) => c.id === avatar));
    setAvatar(characters[(i + step + characters.length) % characters.length].id);
    sfx.pop();
  };
  const startWalking = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* yok say */
    }
    setPicking(false);
    if (avatar !== equipped.character) props.onEquip({ ...equipped, character: avatar }).catch(() => {});
    flash('Joystick ile yürü · boş yerde sürükleyip etrafına bak', 3500);
  };

  const L = LIGHT[phase];
  const avatarItem = itemById(avatar) ?? characters[0];
  const bag = useMemo(() => {
    const m = new Map<string, { item: Item; owned: OwnedItem[] }>();
    inventory.forEach(({ owned, item }) => {
      if (!m.has(item.id)) m.set(item.id, { item, owned: [] });
      m.get(item.id)!.owned.push(owned);
    });
    return [...m.values()];
  }, [inventory]);
  const editing = near?.kind === 'placed' ? near.t : null;

  return (
    <div
      className={`explore phase-${phase}`}
      style={{ background: L.sky }}
      role="dialog"
      aria-label="Ormanda gezinti"
      onPointerDown={lookDown}
      onPointerMove={lookMove}
      onPointerUp={lookUp}
      onPointerCancel={lookUp}
      onWheel={(e) => {
        ctl.current.dist = Math.min(8, Math.max(2.8, ctl.current.dist + e.deltaY * 0.004));
      }}
    >
      <Canvas shadows dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }} camera={{ fov: 55, near: 0.1, far: 120, position: [0, 4, R + 3] }}>
        <Suspense fallback={null}>
          <World
            month={month}
            trees={trees}
            wilts={wilts}
            progress={progress}
            phase={phase}
            onTree={onTree}
            onWilt={onWilt}
            pets={pets}
            player={player}
            placed={placed}
            companions={companions}
            hidePlacement={placing?.moveId}
          />
          {stars.map((s, i) => !got.has(i) && <Star key={i} x={s.x} z={s.z} i={i} />)}
        </Suspense>
        <Suspense fallback={null}>
          {avatarItem && <Player key={avatarItem.id} model={avatarItem.model!} accessory={accessory} player={player} ctl={ctl} obs={obs} radius={R} perks={perks} />}
        </Suspense>
        {placing && (
          <Suspense fallback={null}>
            <Ghost placing={placing} player={player} radius={R} taken={taken} out={ghost} onOk={setGhostOk} />
          </Suspense>
        )}
        {perks.trail && <Trail player={player} />}
        <Lantern player={player} night={phase === 'gece' || phase === 'aksam'} />
        <FollowCam player={player} ctl={ctl} />
        <Brain player={player} trees={trees} spots={spots} pets={pets} placed={placed} stars={stars} got={got} onNear={onNear} onStar={collect} />
        {near && !picking && !placing && <Bubble near={near} pets={pets} today={today} minutesOf={minutesOf} />}
        {bursts.map((b) => (
          <Sparkles key={b.at} x={b.x} z={b.z} at={b.at} y={0.6} />
        ))}
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
        <button className="explore-chip" aria-label={`${props.crystals} Elmas — dükkâna git`} onClick={props.onShop}>
          💎 {props.crystals}
        </button>
        <span className="grow" />
        {current && !picking && (
          <button className="explore-chip" aria-label="Eşyalarım — adaya yerleştir" onClick={() => setPanel(panel === 'bag' ? 'none' : 'bag')}>
            🔨
          </button>
        )}
        {!picking && characters.length > 1 && (
          <button className="explore-chip" aria-label="Karakterini değiştir" onClick={() => setPicking(true)}>
            👕
          </button>
        )}
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

      {msg && !picking && <div className="explore-msg">{msg}</div>}
      {party && (
        <div className="explore-party" role="status">
          <span>⭐</span>
          <strong>Bugünün yıldızlarının hepsini topladın!</strong>
          <span className="muted small">Yarın yeni yıldızlar saklanacak. Yıldızlar koleksiyonunda birikir.</span>
        </div>
      )}

      {picking ? (
        <div className="avatar-pick">
          <strong>Karakterini seç</strong>
          <div className="avatar-row">
            <button className="explore-round" aria-label="Önceki karakter" onClick={() => choose(-1)}>
              ‹
            </button>
            <span className="muted">
              {avatarItem?.name} · {characters.findIndex((c) => c.id === avatar) + 1}/{characters.length}
            </span>
            <button className="explore-round" aria-label="Sonraki karakter" onClick={() => choose(1)}>
              ›
            </button>
          </div>
          <button className="btn primary" onClick={startWalking}>
            Hadi gezelim!
          </button>
          <button className="link small" onClick={props.onShop}>
            Dükkânda daha fazla karakter var →
          </button>
        </div>
      ) : panel === 'bag' ? (
        <div className="explore-panel" role="dialog" aria-label="Eşyalarım">
          <div className="row">
            <strong className="grow">🔨 Adana yerleştir</strong>
            <button className="explore-round sm" aria-label="Kapat" onClick={() => setPanel('none')}>
              ✕
            </button>
          </div>
          {bag.length === 0 ? (
            <p className="muted small">
              Yerleştirecek eşyan yok. Dükkândan 💎 ile yapı, ⭐ ile süs alabilirsin.{' '}
              <button className="link" onClick={props.onShop}>
                Dükkâna git
              </button>
            </p>
          ) : (
            <div className="bag-grid">
              {bag.map(({ item, owned }) => (
                <button
                  key={item.id}
                  className="bag-item"
                  onClick={() => {
                    setPanel('none');
                    setPlacing({ item, ownedId: owned[0].id, rot: 0 });
                    flash('Yürü, yerini seç; sonra "Buraya koy"');
                  }}
                >
                  <span className="bag-icon">{item.icon}</span>
                  <span className="small">{item.name}</span>
                  {owned.length > 1 && <span className="bag-count">×{owned.length}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : panel === 'edit' && editing ? (
        <div className="explore-panel" role="dialog" aria-label={editing.item.name}>
          <div className="row">
            <strong className="grow">
              {editing.item.icon} {editing.item.name}
            </strong>
            <button className="explore-round sm" aria-label="Kapat" onClick={() => setPanel('none')}>
              ✕
            </button>
          </div>
          <div className="row gap">
            <button
              className="btn grow"
              onClick={() => {
                setPanel('none');
                setPlacing({ item: editing.item, ownedId: editing.p.owned_id, moveId: editing.p.id, rot: editing.p.rot });
              }}
            >
              ↔ Taşı
            </button>
            <button
              className="btn grow"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onRemovePlaced(editing.p.id);
                  setPanel('none');
                  flash(`${editing.item.icon} çantana geri döndü`);
                } catch (e) {
                  flash((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              🎒 Kaldır
            </button>
          </div>
        </div>
      ) : (
        <>
          <Joystick ctl={ctl} />
          {placing ? (
            <div className="place-bar">
              <button className="explore-round" aria-label="Çevir" onClick={() => setPlacing({ ...placing, rot: placing.rot + Math.PI / 4 })}>
                ↻
              </button>
              <button className="explore-act static" disabled={!ghostOk || busy} onClick={confirmPlace}>
                {ghostOk ? '✔ Buraya koy' : 'Buraya konamaz'}
              </button>
              <button className="explore-round" aria-label="Vazgeç" onClick={() => setPlacing(null)}>
                ✕
              </button>
            </div>
          ) : (
            <>
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
              {near && (near.kind !== 'placed' || current) && (
                <button className="explore-act" onClick={act}>
                  {near.kind === 'tree'
                    ? '👀 Bak'
                    : near.kind === 'pet'
                      ? '❤️ Sev'
                      : near.kind === 'placed'
                        ? '🔨 Düzenle'
                        : near.w.revived
                          ? '🌱 Bak'
                          : '💧 Bak'}
                  <span className="explore-key">E</span>
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Seçilen karakter: kontrollere göre yürür, koşar, zıplar; engellere çarpar, kıyıdan düşmez. */
function Player({
  model,
  accessory,
  player,
  ctl,
  obs,
  radius,
  perks,
}: {
  model: string;
  accessory: Item | null;
  player: MutableRefObject<PlayerState>;
  ctl: MutableRefObject<Ctl>;
  obs: Circle[];
  radius: number;
  perks: Perks;
}) {
  const { scene, animations } = useGLTF(modelUrl(model));
  const obj = useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse((c) => {
      c.castShadow = true;
    });
    return o;
  }, [scene]);
  const group = useRef<Group>(null);
  const { actions } = useAnimations(animations, group);
  const playing = useRef<string | null>(null);
  const emoteUntil = useRef(performance.now() + 1300);

  const play = (name: string) => {
    if (playing.current === name) return;
    const next = actions[name] ?? actions.idle;
    if (!next) return;
    if (playing.current) actions[playing.current]?.fadeOut(0.15);
    next.reset().fadeIn(0.15).play();
    playing.current = name;
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = group.current;
    if (!g) return;
    const c = ctl.current;
    const p = player.current;
    let ix = 0;
    let iy = 0;
    let run = false;
    if (!c.paused && !c.picking) {
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
      const [x, z] = resolveMove([p.x, p.z], [p.x + dx * speed * dt, p.z + dz * speed * dt], obs, radius);
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
      if (!c.paused && !c.picking && (grounded || p.jumps > 0)) {
        if (!grounded) p.jumps--;
        p.vy = grounded ? JUMP_V : JUMP_V * 0.85;
        sfx.jump();
      }
    }
    if (p.y > 0 || p.vy > 0) {
      p.vy -= GRAVITY * dt;
      // Süzülme: zıplama basılıyken yavaş iner
      if (perks.glide && c.jumpHeld && p.vy < -1.1) p.vy = -1.1;
      p.y = Math.max(0, p.y + p.vy * dt);
      if (p.y === 0) p.vy = 0;
    }
    if (c.picking || performance.now() < emoteUntil.current) play(c.picking && performance.now() > emoteUntil.current ? 'idle' : 'emote-yes');
    else if (p.y > 0.05) play(p.vy > 0 ? 'jump' : 'fall');
    else if (mag > 0.05) play(run ? 'sprint' : 'walk');
    else play('idle');
    g.position.set(p.x, p.y + 0.05, p.z);
    g.rotation.y = p.face;
  });

  return (
    <group ref={group} scale={AVATAR_SCALE}>
      <primitive object={obj} />
      {accessory && <Accessory item={accessory} body={obj} />}
    </group>
  );
}

/** Aksesuar karakterin başına (head kemiği) takılır; başla birlikte sallanır. */
function Accessory({ item, body }: { item: Item; body: Object3D }) {
  const head = useMemo(() => body.getObjectByName('head') ?? body, [body]);
  const glasses = item.model ? <GlassesOn head={head} model={item.model} /> : null;
  return glasses ?? <Crown head={head} />;
}

// Mini Characters'ta head kemiği başın altında: baş 0.38 yukarı uzanır, yüzün önü z ≈ 0.21
function GlassesOn({ head, model }: { head: Object3D; model: string }) {
  const obj = useModel(model);
  useEffect(() => {
    obj.position.set(0, 0.13, 0.15);
    head.add(obj);
    return () => {
      head.remove(obj);
    };
  }, [head, obj]);
  return null;
}

/** Efsane tacı: altın halka ve sivri uçlar */
function Crown({ head }: { head: Object3D }) {
  const crown = useMemo(() => {
    const g = new Object3D();
    const gold = new MeshBasicMaterial({ color: new Color('#ffcc33') });
    const ring = new Mesh(new ExtrudeGeometry(ringShape(), { depth: 0.06, bevelEnabled: false }), gold);
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new Mesh(new ExtrudeGeometry(spikeShape(), { depth: 0.02, bevelEnabled: false }), gold);
      spike.position.set(Math.cos(a) * 0.145, 0.06, Math.sin(a) * 0.145);
      spike.rotation.y = -a + Math.PI / 2;
      g.add(spike);
    }
    g.position.y = 0.37;
    return g;
  }, []);
  useEffect(() => {
    head.add(crown);
    return () => {
      head.remove(crown);
    };
  }, [head, crown]);
  return null;
}

function ringShape() {
  const s = new Shape();
  s.absarc(0, 0, 0.16, 0, Math.PI * 2, false);
  const hole = new Shape();
  hole.absarc(0, 0, 0.13, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

function spikeShape() {
  const s = new Shape();
  s.moveTo(-0.04, 0);
  s.lineTo(0, 0.09);
  s.lineTo(0.04, 0);
  s.closePath();
  return s;
}

/** Yerleştirilecek eşyanın karakterin önündeki önizlemesi; altındaki halka yeşil (konur) ya da kırmızı */
function Ghost({
  placing,
  player,
  radius,
  taken,
  out,
  onOk,
}: {
  placing: Placing;
  player: MutableRefObject<PlayerState>;
  radius: number;
  taken: Circle[];
  out: MutableRefObject<{ x: number; z: number }>;
  onOk: (ok: boolean) => void;
}) {
  const group = useRef<Group>(null);
  const ring = useRef<MeshBasicMaterial>(null);
  const last = useRef<boolean | null>(null);
  const r = placing.item.r ?? 0.4;
  useFrame(({ clock }) => {
    const p = player.current;
    const d = 0.8 + r;
    const x = p.x + Math.sin(p.face) * d;
    const z = p.z + Math.cos(p.face) * d;
    out.current = { x, z };
    const ok = canPlace(x, z, r, radius, taken);
    if (group.current) {
      group.current.position.set(x, 0.02 + Math.sin(clock.elapsedTime * 4) * 0.03, z);
    }
    ring.current?.color.set(ok ? '#5fd35f' : '#ff5a5a');
    if (ok !== last.current) {
      last.current = ok;
      onOk(ok);
    }
  });
  return (
    <group ref={group}>
      <PlacedModel item={placing.item} x={0} z={0} rot={placing.rot} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[r * 0.9, r * 0.9 + 0.08, 32]} />
        <meshBasicMaterial ref={ring} color="#5fd35f" transparent opacity={0.9} />
      </mesh>
    </group>
  );
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

/** Kamera karakteri arkadan ve yukarıdan yumuşakça izler; karakter seçilirken önden gösterir. */
function FollowCam({ player, ctl }: { player: MutableRefObject<PlayerState>; ctl: MutableRefObject<Ctl> }) {
  const { camera } = useThree();
  const want = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  const first = useRef(true);
  useFrame((_, dt) => {
    const c = ctl.current;
    const p = player.current;
    const [yaw, pitch, dist] = c.picking ? [p.face, 0.25, 3.3] : [c.yaw, c.pitch, c.dist];
    want.set(p.x + Math.sin(yaw) * Math.cos(pitch) * dist, p.y + 0.6 + Math.sin(pitch) * dist, p.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    const k = first.current ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    camera.position.lerp(want, k);
    target.set(p.x, p.y + (c.picking ? 0.45 : 0.7), p.z);
    camera.lookAt(target);
    first.current = false;
  });
  return null;
}

/** Her karede: en yakın ağaç/hayvan/fidan/yapı ve yıldız toplama. React'e yalnızca değişince haber verir. */
function Brain({
  player,
  trees,
  spots,
  pets,
  placed,
  stars,
  got,
  onNear,
  onStar,
}: {
  player: MutableRefObject<PlayerState>;
  trees: ForestTree[];
  spots: { w: Wilt; x: number; z: number }[];
  pets: MutableRefObject<Map<string, PetState>>;
  placed: PlacedThing[];
  stars: { x: number; z: number }[];
  got: Set<number>;
  onNear: (n: Near | null) => void;
  onStar: (i: number) => void;
}) {
  const fixed = useMemo<Near[]>(
    () => [
      ...trees.map((tree) => {
        const [x, z] = cellPosition(tree.cell);
        return { kind: 'tree' as const, key: tree.id, x, z, tree };
      }),
      ...spots.map(({ w, x, z }) => ({ kind: 'wilt' as const, key: w.item.id, x, z, w })),
      ...placed.map((t) => ({ kind: 'placed' as const, key: t.p.id, x: t.p.x, z: t.p.z, t })),
    ],
    [trees, spots, placed],
  );
  const last = useRef('');
  useFrame(() => {
    const p = player.current;
    const pos: [number, number] = [p.x, p.z];
    const all: Near[] = [...fixed];
    pets.current.forEach((s, id) => all.push({ kind: 'pet', key: id, x: s.x, z: s.z, id }));
    const n = nearest(pos, all, REACH);
    const key = n ? `${n.kind}:${n.key}` : '';
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

/** Yakındaki şeyin üstünde bilgi balonu */
function Bubble({ near, pets, today, minutesOf }: { near: Near; pets: MutableRefObject<Map<string, PetState>>; today: string; minutesOf: (d: string) => number }) {
  const ref = useRef<Group>(null);
  const petInfo = near.kind === 'pet' ? (PET_OF[near.id as keyof typeof PET_OF] ?? itemById(near.id)) : null;
  const y =
    near.kind === 'tree' ? treeTop(near.tree.stage) + 0.35 : near.kind === 'wilt' ? 0.95 : near.kind === 'placed' ? 1.4 : petInfo?.fly ? 1.9 : 1.05;
  useFrame(() => {
    if (!ref.current) return;
    const s = near.kind === 'pet' ? pets.current.get(near.id) : null;
    ref.current.position.set(s ? s.x : near.x, y, s ? s.z : near.z);
  });
  let text: string;
  if (near.kind === 'tree') text = `📅 ${formatShort(near.tree.date)} · ${minutesOf(near.tree.date)} dk`;
  else if (near.kind === 'pet') text = `${BIOMES.find((b) => b.id === near.id)?.icon ?? itemById(near.id)?.icon ?? ''} ${petInfo?.name ?? ''}`;
  else if (near.kind === 'placed') text = `${near.t.item.icon} ${near.t.item.name}`;
  else if (near.w.revived) text = '🌱 Bu fidanı kurtardın!';
  else if (near.w.item.date === today) text = `💧 ${Math.max(1, REVIVE_MIN - near.w.after)} dk daha çalış, yeşersin`;
  else text = '🥀 Bu fidan soldu';
  return (
    <group ref={ref} position={[near.x, y, near.z]}>
      <Html center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
        <span className="explore-bubble">{text}</span>
      </Html>
    </group>
  );
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
