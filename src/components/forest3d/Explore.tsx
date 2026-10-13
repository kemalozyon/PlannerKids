// "Yakından gez": çocuk kendi karakteriyle bahçesinde ve ormanında üçüncü şahıs kamerayla yürür. Sahne dünya
// görünümüyle aynıdır (world3d/Outdoor, aynı karo ızgarası); burada yalnızca kamera ve kontroller farklı.
// Ağacın yanına gidince o seansı açar, her gün bahçeye saklanan yıldızları toplar. Seviye atladıkça yeni
// yetenekler açılır (level.ts). Dokunmatikte sol altta joystick + zıpla, boş yerde sürükleyerek etrafa bakılır;
// klavyede WASD/oklar, Shift koş, boşluk zıpla (basılı tut: süzül), E bak, Esc çık.
import { useAnimations, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { ExtrudeGeometry, InstancedMesh, Object3D, Shape, Vector3, type Group, type PointLight } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { itemById, type Item } from '../../lib/catalog';
import { dayPhase } from '../../lib/dayPhase';
import { formatShort } from '../../lib/date';
import { dailyStars, moveDir, nearest, resolveMove, STAR_REACH } from '../../lib/explore';
import type { Perks } from '../../lib/level';
import { setSoundOn, sfx, soundOn } from '../../lib/sfx';
import type { Equipped } from '../../lib/types';
import { fixedTiles, outdoorBlocked, type OutdoorMap, type SpaceLayout, type WorldCtx, type WorldTree } from '../../lib/world';
import type { CFG } from '../../lib/config';
import { ItemModel } from '../world3d/items';
import { LIGHT } from '../world3d/light';
import Outdoor from '../world3d/Outdoor';
import { Accessory } from './Accessory';
import { modelUrl } from './models';

/** İlk gezintide karakter seçimi bir kez gösterilir */
const SEEN_KEY = 'ct-explore-v3';
const AVATAR_SCALE = 1.1;
const WALK = 2.2;
const RUN = 4;
const GRAVITY = 14;
const JUMP_V = 5;
/** Bir ağacın "yanında" sayılma uzaklığı */
const REACH = 1.2;

export interface ExploreProps {
  map: OutdoorMap;
  garden: SpaceLayout;
  ctx: WorldCtx;
  creatures: typeof CFG.world.creatures;
  today: string;
  /** Üstte bir pencere açıkken karakter durur, tuşlar dinlenmez */
  paused: boolean;
  onTree: (t: WorldTree) => void;
  onClose: () => void;
  /** Görünüş ve sahip olunan karakterler (seçim için) */
  equipped: Equipped;
  characters: Item[];
  onEquip: (e: Equipped) => Promise<void>;
  perks: Perks;
  /** Bugün toplanan yıldızlar (sırası) */
  starsGot: number[];
  onStar: (i: number) => Promise<void>;
}

type Near = { key: string; x: number; z: number; tree: WorldTree };

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
  const { map, garden, ctx, today, paused, onTree, onClose, equipped, characters, perks } = props;
  const blocked = useMemo(() => outdoorBlocked(map, garden, ctx), [map, garden, ctx]);
  const fixed = useMemo(() => fixedTiles('garden', ctx), [ctx]);
  const size = { w: map.width, h: map.height };
  const stars = useMemo(() => dailyStars(today, map, blocked), [today, map, blocked]);
  const trees = useMemo<Near[]>(
    () =>
      map.regions.flatMap((r) =>
        r.trees.flatMap((t) => {
          const s = r.spots.get(t.id);
          return s ? [{ key: t.id, x: r.ox + s.x + 0.5, z: r.oy + s.y + 0.5, tree: t }] : [];
        }),
      ),
    [map],
  );
  const accessory = equipped.accessory ? (itemById(equipped.accessory) ?? null) : null;

  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  const [sound, setSound] = useState(soundOn);
  const [avatar, setAvatar] = useState(() => (characters.some((c) => c.id === equipped.character) ? equipped.character : characters[0]?.id));
  const [picking, setPicking] = useState(firstTime);
  const [near, setNear] = useState<Near | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [party, setParty] = useState(false);
  const [pendingStars, setPendingStars] = useState<number[]>([]);

  const ctl = useRef<Ctl>({ jx: 0, jy: 0, joy: false, keys: new Set(), jump: false, jumpHeld: false, yaw: 0, pitch: 0.5, dist: 5.4, lastLook: 0, paused, picking });
  // Evin kapısının önünden başla; kamera önden (güneyden) eve doğru bakar
  const player = useRef<PlayerState>({ x: 2.5, z: 5.5, y: 0, vy: 0, face: Math.PI, jumps: 0 });
  const nearRef = useRef<Near | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const got = useMemo(() => new Set([...props.starsGot, ...pendingStars]), [props.starsGot, pendingStars]);

  useEffect(() => {
    // Bir pencere açıkken karakter durur
    const stop = paused || picking;
    ctl.current.paused = stop;
    ctl.current.picking = picking;
    if (stop) {
      ctl.current.keys.clear();
      ctl.current.jx = ctl.current.jy = 0;
    }
  }, [paused, picking]);

  const flash = useCallback((m: string, ms = 2600) => {
    setMsg(m);
    clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), ms);
  }, []);

  useEffect(() => {
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
    if (!n) return;
    sfx.pop();
    onTree(n.tree);
  }, [onTree]);

  const onNear = useCallback((n: Near | null) => {
    nearRef.current = n;
    setNear(n);
  }, []);

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
        if (c.picking) setPicking(false);
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
        if (!e.repeat) act();
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

  return (
    <div
      className={`explore phase-${phase}`}
      style={{ background: L.sky }}
      role="dialog"
      aria-label="Bahçende ve ormanında gezinti"
      onPointerDown={lookDown}
      onPointerMove={lookMove}
      onPointerUp={lookUp}
      onPointerCancel={lookUp}
      onWheel={(e) => {
        ctl.current.dist = Math.min(8, Math.max(2.8, ctl.current.dist + e.deltaY * 0.004));
      }}
    >
      <Canvas shadows dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }} camera={{ fov: 55, near: 0.1, far: 160, position: [2.5, 4, 9] }}>
        <hemisphereLight args={[L.sky2, L.ground, L.hemiI]} />
        <directionalLight position={[12, 20, 8]} intensity={L.sunI} color={L.sun} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} />
        <fog attach="fog" args={[L.fog, 18, 60]} />
        <Suspense fallback={null}>
          <Outdoor map={map} fixed={fixed} growId={null} onGrown={() => {}} onTree={(t) => onTree(t)} onHouse={() => {}} creatures={props.creatures} labels={false} />
          {garden.items.map((it, i) => {
            const item = itemById(it.item);
            return item?.model ? <ItemModel key={i} item={item} x={it.x} y={it.y} rot={it.rot} /> : null;
          })}
          {stars.map((s, i) => !got.has(i) && <Star key={i} x={s.x} z={s.z} i={i} />)}
        </Suspense>
        <Suspense fallback={null}>
          {avatarItem && <Player key={avatarItem.id} model={avatarItem.model!} accessory={accessory} player={player} ctl={ctl} blocked={blocked} size={size} perks={perks} />}
        </Suspense>
        {perks.trail && <Trail player={player} />}
        <Lantern player={player} night={phase === 'gece' || phase === 'aksam'} />
        <FollowCam player={player} ctl={ctl} />
        <Brain player={player} trees={trees} stars={stars} got={got} onNear={onNear} onStar={collect} />
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
      {near && !picking && !msg && (
        <div className="explore-msg near" role="status">
          {near.tree.icon} {near.tree.name} · {formatShort(near.tree.date)} · {near.tree.minutes} dk
        </div>
      )}
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
        </div>
      ) : (
        <>
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
          {near && (
            <button className="explore-act" onClick={act}>
              👀 Bak
              <span className="explore-key">E</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Her karede: en yakın ağaç ve yıldız toplama. React'e yalnızca değişince haber verir. */
function Brain({
  player,
  trees,
  stars,
  got,
  onNear,
  onStar,
}: {
  player: MutableRefObject<PlayerState>;
  trees: Near[];
  stars: { x: number; z: number }[];
  got: Set<number>;
  onNear: (n: Near | null) => void;
  onStar: (i: number) => void;
}) {
  const last = useRef('');
  useFrame(() => {
    const p = player.current;
    const n = nearest([p.x, p.z], trees, REACH);
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

/** Seçilen karakter: kontrollere göre yürür, koşar, zıplar; engellere çarpar, kıyıdan düşmez. */
function Player({
  model,
  accessory,
  player,
  ctl,
  blocked,
  size,
  perks,
}: {
  model: string;
  accessory: Item | null;
  player: MutableRefObject<PlayerState>;
  ctl: MutableRefObject<Ctl>;
  blocked: Set<string>;
  size: { w: number; h: number };
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
      const [x, z] = resolveMove([p.x, p.z], [p.x + dx * speed * dt, p.z + dz * speed * dt], blocked, size.w, size.h);
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
