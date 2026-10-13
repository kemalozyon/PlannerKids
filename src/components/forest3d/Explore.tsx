// "Yakından gez": çocuk kendi avatarıyla bütün dünyada (ev, bahçe, orman yolu, ay bahçeleri) üçüncü şahıs
// kamerayla yürür. Sahne dünya görünümüyle aynıdır (world3d/WorldScene, aynı dünya planı); yalnızca kamera ve
// kontroller farklı. Alanlar arasında yalnızca kapılardan geçilir; eve girince çatı kalkar. Bir ağaca yaklaşınca o günün özeti çıkar, "Bak" ile gün kartı açılır; her gün saklanan yıldızlar
// toplanır. Seviye atladıkça yeni yetenekler açılır (level.ts). Dokunmatikte sol altta joystick + zıpla, boş
// yerde sürükleyerek etrafa bakılır; klavyede WASD/oklar, Shift koş, boşluk zıpla (basılı tut: süzül), E bak, Esc çık.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { ExtrudeGeometry, InstancedMesh, Object3D, Shape, Vector3, type DirectionalLight, type Group, type PointLight } from 'three';
import type { AvatarLook } from '../../lib/avatar';
import { CFG, type MapDef } from '../../lib/config';
import { dayPhase } from '../../lib/dayPhase';
import { formatMinutes, formatShort } from '../../lib/date';
import { dailyStars, moveDir, nearest, resolveMove, STAR_REACH } from '../../lib/explore';
import type { Perks } from '../../lib/level';
import { setSoundOn, sfx, soundOn } from '../../lib/sfx';
import type { Book } from '../../lib/types';
import { isIndoor, isMonthSpace, key, plotOf, type DayTree, type SpaceId, type SpaceLayout, type Step, type Tile } from '../../lib/world';
import { canStep, regionAt, worldBlocked, type RegionId, type WorldPlan } from '../../lib/worldPlan';
import AvatarModel, { type AvatarAnim } from '../avatar/AvatarModel';
import { LIGHT } from '../world3d/light';
import type { TvData } from '../world3d/art';
import WorldScene from '../world3d/WorldScene';

const WALK = 2.2;
const RUN = 4;
const GRAVITY = 14;
const JUMP_V = 5;
/** Bir ağacın "yanında" sayılma uzaklığı */
const REACH = 1.3;

/** Bu kadar karo uzaktaki alanlar sade çizilir */
const NEAR = 22;
const NO_CHANNELS: Record<string, number> = {};

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
  /** Işık/TV/ateş (dünya görünümüyle aynı) */
  power: Record<string, boolean>;
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
}

type Near = { key: string; x: number; z: number; tree: DayTree };

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
}

export default function Explore(props: ExploreProps) {
  const { plan, map, layouts, forest, today, paused, onTree, onClose, perks } = props;
  const size = { w: plan.w, h: plan.h };
  const blocked = useMemo(() => worldBlocked(plan, layouts), [plan, layouts]);
  const step = useMemo<Step>(() => (a, b) => canStep(plan, a, b), [plan]);
  // Yıldızlar dışarıda saklanır (ev içinde değil)
  const stars = useMemo(() => {
    const out = new Set(blocked);
    for (const r of plan.regions) if (isIndoor(r.id as SpaceId)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.add(key(x, y));
    return dailyStars(today, 'world', size, out);
  }, [today, plan, blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  const trees = useMemo<Near[]>(() => {
    const out: Near[] = [];
    for (const r of plan.regions) {
      if (!isMonthSpace(r.id) || r.locked) continue;
      const month = r.id.slice(2);
      for (const t of forest) {
        if (t.month !== month) continue;
        const p = plotOf(month, Number(t.date.slice(8, 10)));
        out.push({ key: t.id, x: r.x + p.x + 0.5, z: r.y + p.y + 0.5, tree: t });
      }
    }
    return out;
  }, [plan, forest]);
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
    onTree(n.tree);
  }, [onTree]);

  const onNear = useCallback((n: Near | null) => {
    nearRef.current = n;
    setNear(n);
    if (n) sfx.pop();
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
        onClose();
        return;
      }
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
  const inside = here === 'room' || here === 'library';

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
            night={phase === 'gece' || phase === 'aksam'}
            near={nearRegions}
            labels={false}
            growId={null}
            onGrown={() => {}}
            books={props.books}
            reading={props.reading}
            phase={phase}
            power={props.power}
            channels={NO_CHANNELS}
            tv={props.tv}
            center={center}
          />
          {stars.map((s, i) => !got.has(i) && <Star key={i} x={s.x} z={s.z} i={i} />)}
          <Player look={props.look} player={player} ctl={ctl} blocked={blocked} step={step} size={size} perks={perks} onTile={onTile} />
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

      {msg && !near && <div className="explore-msg">{msg}</div>}
      {near && (
        <div className="explore-msg near" role="status">
          {near.tree.dry ? near.tree.icon : near.tree.species.icon} <strong>{formatShort(near.tree.date)}</strong> · {formatMinutes(near.tree.minutes)} · {near.tree.name}
        </div>
      )}
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
      {near && (
        <button className="explore-act" onClick={act}>
          👀 O güne bak
          <span className="explore-key">E</span>
        </button>
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

/** Avatar: kontrollere göre yürür, koşar, zıplar, süzülür; engellere çarpar, kıyıdan düşmez. */
function Player({
  look,
  player,
  ctl,
  blocked,
  step,
  size,
  perks,
  onTile,
}: {
  look: AvatarLook;
  player: MutableRefObject<PlayerState>;
  ctl: MutableRefObject<Ctl>;
  blocked: Set<string>;
  step: Step;
  size: { w: number; h: number };
  perks: Perks;
  onTile: (t: Tile) => void;
}) {
  const group = useRef<Group>(null);
  const tile = useRef('');
  const anim = useRef<AvatarAnim>({ state: 'wave' });
  const waveUntil = useRef(performance.now() + 1300);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = group.current;
    if (!g) return;
    const c = ctl.current;
    const p = player.current;
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
      <AvatarModel look={look} anim={anim} live />
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
