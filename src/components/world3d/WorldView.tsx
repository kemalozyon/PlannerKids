// Odanın 3D görünümü (Habbo gibi): seçilen oda koyu boşlukta yüzen bir ada (WorldScene). Ortografik kamera hep
// aynı izometrik açıdan (güneydoğudan) bakar; yakınlaştırma ve kaydırma var, oda açılınca bütünü ekrana sığar.
// Sahne yalnızca bir şey değişince çizilir (frameloop="demand").
//
// Oynarken: bir karoya dokununca karakter A* ile oraya yürür (uzun yolda koşar). Kapıya dokununca kapıya yürür,
// sayfa kapının götürdüğü odayı açar. Kitaplığa ya da kitaba dokununca yanına gidip penceresini açar.
// Bir eşyaya dokununca eşya havalanır ve sayfa alttaki panelde eşyanın seçeneklerini gösterir; karakter yerinden
// kıpırdamaz. Yalnızca bir kullanım eylemi seçilince (reach) yanına yürür, varınca sayfa eylemi yapar. Oturunca
// karakter eşyanın üstüne geçer; boş bir yere dokununca kalkar. Karaktere dokununca sayfa karakter panelini açar.
// Yerleştirirken (envanter açık ya da eşya taşınırken: `edit`) odanın ızgarası görünür, elde tutulan eşya imleçle
// gezer ve karoya (duvar süsü duvara) bırakılır. İmleç yalnızca düzenleme katmanını (EditOverlay) yeniden çizer;
// oda (WorldScene, memo) yerinde kalır.
// Oyun eşyaları: havuz suyuna giren karakter yüzer; atlama tahtasından suya atlar (dive); ışınlayıcıya girince
// küçülüp eşinde belirir (teleport; eşi başka odadaysa sayfa o odayı açar); yürüyen bant duran karakteri taşır;
// topun üstüne yürüyünce top yuvarlanır (onKick); müzik karosuna basınca nota çalar. Konuşma balonları DOM'da
// (drei <Html> yok): AvatarAnchor her karede başın ekrandaki yerini `anchor` kutusuna yazar.
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { MOUSE, TOUCH, Vector3 } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { AvatarLook } from '../../lib/avatar';
import { has, itemById } from '../../lib/catalog';
import { CFG, type FixedTile, type MapDef } from '../../lib/config';
import type { DayPhase } from '../../lib/dayPhase';
import type { Book } from '../../lib/types';
import { emitFx } from '../../lib/fx';
import { sfx } from '../../lib/sfx';
import {
  approachTile,
  blockedTiles,
  canPlaceAt,
  colorOf,
  conveyStep,
  diveSpot,
  footprint,
  swimTiles,
  teleportExit,
  findPath,
  isIndoor,
  powerKey,
  seatOf,
  smoothPath,
  snapToSurface,
  supportOf,
  wallRot,
  type SpaceId,
  type SpaceLayout,
  type Tile,
  type WorldCtx,
} from '../../lib/world';
import { canStep, regionOf, worldBlocked, type Region, type WorldPlan } from '../../lib/worldPlan';
import { modelUrl } from '../forest3d/models';
import Companions from './Companion';
import type { BoardCard, TvData } from './art';
import Avatar, { pathSpeed, type Walker } from './Avatar';
import { footCenter, FootTiles, GridLines, HoverTile, ItemModel, OnSurface, surfaceTop } from './items';
import { avatarSpot } from './avatarSpot';
import type { Quality } from '../../lib/gfx';
import Atmosphere, { shadowsFor } from './Atmosphere';
import { QualityContext } from './gfx';
import { isTap } from './light';
import { WALL_H } from './Room';
import WorldScene from './WorldScene';

// Son işlem (~100 KB gzip) yalnızca yüksek grafikte gerekir: düşük/orta açılışta indirilmez
const Effects = lazy(() => import('./Effects'));

/** Kameranın yönü: güneydoğudan (arka duvarlar kuzey ve batı) */
const AZ = Math.PI / 4;
/** Kameranın konumu hedefe göre; eğikliği: yatay / dikey */
const CAM_OFF: [number, number, number] = [18, 20, 18];
const TILT = Math.hypot(CAM_OFF[0], CAM_OFF[2]) / CAM_OFF[1];
/** Habbo'nun boşluğu (tuval yüklenirken de) */
export const VOID_BG = '#141d2b';

/** Bırakılacak yer: karo; masa üstünde çeyreği de */
export type Spot = Tile & { sub?: number };

export type ItemRef = { space: SpaceId; index: number };

export interface WorldViewProps {
  plan: WorldPlan;
  map: MapDef;
  /** Kayıtlı (ayıklanmış) yerleşimler */
  layouts: Partial<Record<SpaceId, SpaceLayout>>;
  creatures: typeof CFG.world.creatures;
  phase: DayPhase;
  quality: Quality;
  look: AvatarLook;
  /** Mantar panodaki notlar */
  board?: BoardCard[];
  /** Karakterin başladığı karo */
  start: Tile;
  /** Bitirilen (eskiden yeniye) ve okunmakta olan kitaplar */
  books: Book[];
  reading: Book[];
  onBook: (b: Book) => void;
  /** Yerleştirilen alan ve taslağı (envanter açık ya da eşya taşınıyor) */
  edit: { space: SpaceId; layout: SpaceLayout } | null;
  /** Elde tutulan eşya (yerleştirme) */
  held: { item: string; rot: number } | null;
  onDrop: (spot: Spot) => void;
  /** Kapıya varıldı: kapının götürdüğü oda açılsın */
  onDoor: (d: FixedTile) => void;
  /** Bir eşyaya dokunuldu: seçenekler açılsın (karakter yürümez) */
  onUse: (space: SpaceId, index: number) => void;
  /** Kullanım eylemi için eşyanın yanına yürü: n her istekte artar; varınca onReached */
  reach: { space: SpaceId; index: number; n: number } | null;
  onReached: (r: ItemRef) => void;
  /** Karaktere dokunuldu */
  onAvatar: () => void;
  /** Dans et / el salla / dur (kind null): n her istekte artar */
  emote: { kind: 'dance' | 'wave' | null; n: number } | null;
  /** Yanına alınan evcil hayvanlar (peşinden gelir) */
  pets: string[];
  /** Boş bir yere dokunuldu (seçenekler kapanır) */
  onFloor: () => void;
  /** Seçenekleri açık eşya (biraz havalanır) */
  using: ItemRef | null;
  /** Otur / yat / sallan isteği: n her istekte artar */
  action: { space: SpaceId; index: number; n: number; stand?: boolean } | null;
  /** Karakter bir eşyanın üstüne geçti ya da kalktı */
  onPosed: (p: ItemRef | null) => void;
  /** Karakterin elindeki ikram (DISPENSE) */
  holding: string | null;
  channels: Record<string, number>;
  tv: TvData;
  /** Karakter yeni bir karoya geçince (konum saklanır) */
  onTile: (t: Tile) => void;
  /** Zarların son atışı (powerKey → değer, sayaç) */
  dice?: Record<string, { v: number; n: number }>;
  /** Işınlan: kabine gir, eşinde çık (n her istekte artar); eşi başka odadaysa onBeamed */
  teleport: { from: ItemRef; to: ItemRef; n: number } | null;
  onBeamed: (to: ItemRef) => void;
  /** Oda ışınlanarak açıldı: karakter büyüyerek belirir */
  beamIn?: boolean;
  /** Atlama tahtasından havuza atla (n her istekte artar) */
  dive: { space: SpaceId; index: number; n: number } | null;
  /** Karakter topun üstüne yürüdü: yönü (bir karo) */
  onKick: (r: ItemRef, dir: Tile) => void;
  /** Suya girdi / çıktı */
  onWater: (on: boolean) => void;
  /** Konuşma balonlarının kutusu: başın ekrandaki yerine taşınır */
  anchor?: MutableRefObject<HTMLDivElement | null>;
}

export default function WorldView(props: WorldViewProps) {
  return (
    <Canvas
      orthographic
      frameloop="demand"
      shadows={shadowsFor(props.quality)}
      dpr={[1, props.quality === 'dusuk' ? 1.5 : 1.75]}
      gl={{ antialias: props.quality !== 'yuksek' }}
      camera={{ position: [20, 22, 20], zoom: 40, near: -60, far: 320 }}
      style={{ background: VOID_BG, touchAction: 'none' }}
      aria-label="Odan"
    >
      {/* Koyu boşluk ve gün evresinin ışığı; güneş gölgesi kamera hedefini izler */}
      <Atmosphere phase={props.phase} quality={props.quality} mode="iso" backdrop="void" />
      <QualityContext.Provider value={props.quality}>
        <Suspense fallback={null}>
          {/* Oda değişince sahne baştan kurulur (kamera yeni odaya sığar, karakter kapıda başlar) */}
          <Scene key={props.plan.regions[0].id} {...props} />
        </Suspense>
      </QualityContext.Provider>
      {props.quality === 'yuksek' && (
        <Suspense fallback={null}>
          <Effects night={props.phase === 'gece' || props.phase === 'aksam'} />
        </Suspense>
      )}
    </Canvas>
  );
}

const head = new Vector3();
/** Konuşma balonlarının kutusunu karakterin başının ekrandaki yerine taşır (her çizilen karede; React state yok) */
function AvatarAnchor({ el }: { el: MutableRefObject<HTMLDivElement | null> }) {
  useFrame(({ camera, size }) => {
    const d = el.current;
    if (!d) return;
    head.set(avatarSpot.x, avatarSpot.y + avatarSpot.head, avatarSpot.z).project(camera);
    d.style.transform = `translate(${((head.x + 1) / 2) * size.width}px, ${((1 - head.y) / 2) * size.height}px)`;
  });
  return null;
}

/** Her çizimde değişmeyen bir fonksiyon; çağrılınca en son hâlini çalıştırır (memo'lu sahne yeniden çizilmesin) */
function useStable<A extends unknown[], R>(f: (...a: A) => R): (...a: A) => R {
  const ref = useRef(f);
  ref.current = f;
  return useCallback((...a: A) => ref.current(...a), []);
}


function Scene(p: WorldViewProps) {
  const { plan } = p;
  const invalidate = useThree((s) => s.invalidate);
  const editR = p.edit ? regionOf(plan, p.edit.space) : null;
  const layouts = useMemo(() => (p.edit ? { ...p.layouts, [p.edit.space]: p.edit.layout } : p.layouts), [p.layouts, p.edit]);
  const blocked = useMemo(() => worldBlocked(plan, layouts), [plan, layouts]);
  const step = useMemo(() => (a: Tile, b: Tile) => canStep(plan, a, b), [plan]);
  const walker = useRef<Walker>({ x: p.start.x + 0.5, z: p.start.y + 0.5, face: Math.PI / 4, path: [], onArrive: null, beam: p.beamIn ? { phase: 'in' } : null });
  /** Kamera karakteri izlesin mi: oda ekrana sığıyorsa hayır (Habbo gibi sabit), yakınlaştırınca evet */
  const follow = useRef(false);
  const zoomedIn = useRef(false);
  const [center, setCenter] = useState<Tile>(() => ({ x: Math.floor(plan.w / 2), y: Math.floor(plan.h / 2) }));
  /** Kullanmak için karakterin yürüdüğü eşya (havalanık kalır) */
  const [aim, setAim] = useState<ItemRef | null>(null);
  /** Bırakmanın hemen ardından gelen "click" karakteri yürütmesin */
  const droppedAt = useRef(0);
  /** Düzenleme katmanının imleci (yalnızca o katman yeniden çizilir) */
  const hoverTo = useRef<((t: Spot | null) => void) | null>(null);

  const [posed, setPosed] = useState<{ space: SpaceId; index: number; key: string } | null>(null);
  const tileNow = (): Tile => ({ x: Math.floor(walker.current.x), y: Math.floor(walker.current.z) });
  /** Eşyanın üstündeyse kalk: yaklaştığı karoya iner */
  const standUp = () => {
    const P = walker.current.pose;
    if (!P) return;
    walker.current.x = P.back.x;
    walker.current.z = P.back.z;
    walker.current.pose = null;
    setPosed(null);
    p.onPosed(null);
    invalidate();
  };
  /** Yürüyen bantta art arda taşınma (sonsuz döngüde dursun) */
  const carried = useRef(0);
  /** Dünya karosuna yürü; varınca then(). Yol yoksa false */
  const walkTo = (to: Tile, then?: () => void): boolean => {
    standUp();
    carried.current = 0;
    walker.current.carried = false;
    const path = findPath(tileNow(), to, plan.w, plan.h, blocked, step);
    if (!path) return false;
    walker.current.path = smoothPath(tileNow(), path, blocked, step).map((t) => ({ x: t.x + 0.5, z: t.y + 0.5 }));
    walker.current.speed = pathSpeed(path.length);
    walker.current.onArrive = then ?? null;
    follow.current = zoomedIn.current;
    invalidate();
    return true;
  };
  const onWalk = useStable((to: Tile, then?: () => void) => {
    setAim(null);
    // Kapı karosu yürünür: oraya varınca (ya da yol yoksa hemen) kapı işi
    if (!walkTo(to, then)) then?.();
  });

  /** Eşyanın önüne yürü (dünya karosu); varınca then(). Yol yoksa false */
  const walkToItem = (space: SpaceId, i: number, then?: () => void): boolean => {
    const r = regionOf(plan, space);
    const it = layouts[space]?.items[i];
    const item = it && itemById(it.item);
    if (!r || !it || !item) return false;
    const near = approachTile(item, it, r.w, r.h, blockedTiles(space, layouts[space]!, plan.ctx));
    return walkTo(near ? { x: r.x + near.x, y: r.y + near.y } : { x: r.x + it.x, y: r.y + it.y }, then);
  };
  // Otur / yat / sallan
  useEffect(() => {
    const a = p.action;
    if (!a) return;
    if (a.stand) return standUp();
    const r = regionOf(plan, a.space);
    const it = layouts[a.space]?.items[a.index];
    const item = it && itemById(it.item);
    const seat = item && it ? seatOf(item, it) : null;
    if (!r || !seat || !it) return;
    walkToItem(a.space, a.index, () => {
      const w = walker.current;
      w.pose = { ...seat, x: r.x + seat.x, z: r.y + seat.z, back: { x: w.x, z: w.z } };
      setPosed({ space: a.space, index: a.index, key: powerKey(a.space, it) });
      p.onPosed({ space: a.space, index: a.index });
      invalidate();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.action?.n]);
  // Karakter menüsü: dans et, el salla, dur (oturuyorsa önce kalkar)
  useEffect(() => {
    const e = p.emote;
    if (!e) return;
    if (e.kind) standUp();
    walker.current.emote = e.kind ? { kind: e.kind } : null;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.emote?.n]);
  // Kullan: eşyanın yanına yürü (duvar eşyasında ya da yol yoksa hemen), varınca sayfa eylemi yapar
  useEffect(() => {
    const a = p.reach;
    if (!a) return;
    const it = layouts[a.space]?.items[a.index];
    const item = it && itemById(it.item);
    if (!it || !item) return;
    const ref = { space: a.space, index: a.index };
    const done = () => {
      setAim(null);
      p.onReached(ref);
    };
    setAim(ref);
    if (item.placement === 'wall' || !walkToItem(a.space, a.index, done)) done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.reach?.n]);
  // Işınlan: kabinin içine gir, küçülüp kaybol, eşinde belir (eşi başka odadaysa sayfa o odayı açar)
  useEffect(() => {
    const T = p.teleport;
    if (!T) return;
    const r = regionOf(plan, T.from.space);
    const it = layouts[T.from.space]?.items[T.from.index];
    const item = it && itemById(it.item);
    if (!r || !it || !item) return;
    const [cx, cz] = footCenter(item, it.x, it.y, it.rot);
    const w = walker.current;
    standUp();
    w.path = [{ x: r.x + cx, z: r.y + cz }];
    w.speed = 2;
    w.onArrive = () => {
      emitFx({ kind: 'beam', x: r.x + cx, z: r.y + cz });
      sfx.zap();
      w.beam = {
        phase: 'out',
        done: () => {
          const to = layouts[T.to.space]?.items[T.to.index];
          const toItem = to && itemById(to.item);
          if (T.to.space !== T.from.space || !to || !toItem) return p.onBeamed(T.to);
          const ex = teleportExit(toItem, to, r.w, r.h, blockedTiles(T.to.space, layouts[T.to.space]!, plan.ctx));
          w.x = r.x + ex.x;
          w.z = r.y + ex.z;
          emitFx({ kind: 'beam', x: w.x, z: w.z });
          w.beam = { phase: 'in', done: () => walkTo({ x: r.x + ex.out.x, y: r.y + ex.out.y }) };
          invalidate();
        },
      };
      invalidate();
    };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.teleport?.n]);
  // Atlama tahtası: arkasından yay çizerek havuza atla
  useEffect(() => {
    const D = p.dive;
    if (!D) return;
    const r = regionOf(plan, D.space);
    const spot = r && layouts[D.space] ? diveSpot(layouts[D.space]!, D.index) : null;
    if (!r || !spot) return;
    const w = walker.current;
    standUp();
    const to = { x: r.x + spot.land.x + 0.5, z: r.y + spot.land.y + 0.5 };
    w.path = [];
    w.hop = {
      from: { x: w.x, z: w.z },
      to,
      dur: 0.9,
      done: () => {
        emitFx({ kind: 'splash', x: to.x, z: to.z });
        sfx.splash();
        invalidate();
      },
    };
    sfx.jump();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dive?.n]);
  // Oturduğu eşya taşınır ya da kalkarsa karakter de kalkar
  useEffect(() => {
    if (!posed) return;
    const it = layouts[posed.space]?.items[posed.index];
    if (!it || powerKey(posed.space, it) !== posed.key) standUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layouts]);

  // Havuz suyu karoları (oda dünyada 0,0'da)
  const here = plan.regions[0];
  const swim = useMemo(() => swimTiles(layouts[here.id] ?? { items: [] }), [layouts, here.id]);
  const water = useStable((x: number, z: number) => swim.has(`${x - here.x},${z - here.y}`));
  const onWater = useStable((on: boolean) => {
    const w = walker.current;
    if (on) {
      emitFx({ kind: 'splash', x: w.x, z: w.z });
      sfx.splash();
    }
    p.onWater(on);
  });
  /** Karonun eşyaları (oda yerel koordinatı) */
  const itemsAt = (x: number, y: number) => {
    const l = layouts[here.id];
    const out: { i: number; item: NonNullable<ReturnType<typeof itemById>> }[] = [];
    l?.items.forEach((q, i) => {
      const item = itemById(q.item);
      if (item && item.placement !== 'wall' && footprint(item, q.x, q.y, q.rot).some((t) => t.x === x - here.x && t.y === y - here.y)) out.push({ i, item });
    });
    return out;
  };
  const onTile = (x: number, y: number) => {
    p.onTile({ x, y });
    const l = layouts[here.id];
    for (const { i, item } of itemsAt(x, y)) {
      // Top: yürüme yönünde yuvarlanır
      if (has(item, 'KICK')) {
        const f = walker.current.face;
        const dx = Math.sin(f);
        const dz = Math.cos(f);
        p.onKick({ space: here.id, index: i }, Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dz) });
      }
      // Müzik karosu: rengine göre nota
      if (has(item, 'PLAY_SOUND') && item.sound === 'nota' && l) {
        const q = l.items[i];
        sfx.note(item.palette?.indexOf(colorOf(item, q) ?? '') ?? 0);
      }
    }
  };
  // Yürüyen bant: karakter durunca bandın yönüne bir karo taşınır (zincirlenir; 40 adımda durur)
  const onStop = useStable((x: number, z: number) => {
    const l = layouts[here.id];
    const w = walker.current;
    if (!l || w.pose || carried.current >= 40) return;
    const to = conveyStep(here.id, l, plan.ctx, { x: x - here.x, y: z - here.y });
    if (!to) {
      carried.current = 0;
      return;
    }
    carried.current++;
    w.path = [{ x: here.x + to.x + 0.5, z: here.y + to.y + 0.5 }];
    w.speed = 1.6;
    w.carried = true;
    invalidate();
  });

  const heldItem = p.held ? itemById(p.held.item) : undefined;
  const heldWall = heldItem?.placement === 'wall';
  // Eşya ele alınınca modeli önceden yüklensin (önizleme takılmadan görünsün)
  useEffect(() => {
    if (heldItem?.model) useGLTF.preload(modelUrl(heldItem.model));
  }, [heldItem]);
  const local = (t: Tile): Tile => (editR ? { x: t.x - editR.x, y: t.y - editR.y } : t);
  const tileOf = (e: ThreeEvent<PointerEvent | MouseEvent>): Tile => ({ x: Math.floor(e.point.x), y: Math.floor(e.point.z) });
  /**
   * İmlecin bırakma yeri (alanın yerel karosu). Elde masa üstü eşyası varsa yakındaki yüzeye mıknatıslanır:
   * zemindeki imleç noktası her yüzeyin yüksekliğine kameraya doğru kaydırılır (eğik bakış).
   */
  const spotOf = (e: ThreeEvent<PointerEvent>): Spot => {
    const t = local(tileOf(e));
    if (!editR || !p.edit || !p.held || !heldItem || !has(heldItem, 'ON_SURFACE')) return t;
    const fx = e.point.x - editR.x;
    const fz = e.point.z - editR.y;
    const dx = Math.sin(AZ) * TILT;
    const dz = Math.cos(AZ) * TILT;
    const at = (q: { item: string }) => {
      const H = surfaceTop(itemById(q.item)!);
      return { x: fx + dx * H, y: fz + dz * H };
    };
    return snapToSurface(p.edit.space, p.edit.layout, plan.ctx, p.held, at) ?? t;
  };

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return;
    e.stopPropagation();
    // Elde eşya varken bırakma pointerup'ta olur
    if (p.held || performance.now() - droppedAt.current < 400) return;
    p.onFloor();
    setAim(null);
    walkTo(tileOf(e));
  };
  const release = (e: ThreeEvent<PointerEvent>, t: Spot) => {
    if (p.edit && p.held) {
      e.stopPropagation();
      droppedAt.current = performance.now();
      p.onDrop(t);
    }
  };

  const onItem = useStable((kind: 'down' | 'click', space: SpaceId, i: number, e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (kind === 'down') return;
    const it = layouts[space]?.items[i];
    const item = it && itemById(it.item);
    if (!it || !item || !isTap(e as ThreeEvent<MouseEvent>)) return;
    e.stopPropagation();
    if (p.held) return;
    // Karakter yürümez: seçenekler eşyanın yanında açılır
    setAim(null);
    p.onUse(space, i);
  });
  const onAvatar = useStable(() => {
    if (!p.held) p.onAvatar();
  });
  const leader = useStable(() => {
    const w = walker.current;
    const P = w.pose;
    return P && !w.path.length ? { x: P.back.x, z: P.back.z, face: P.face } : { x: w.x, z: w.z, face: w.face };
  });
  const onBook = useStable((b: Book) => p.onBook(b));
  const onDoor = useStable((d: FixedTile) => p.onDoor(d));
  const selected = p.using ?? aim;

  return (
    <>
      <Camera plan={plan} walker={walker} follow={follow} zoomedIn={zoomedIn} locked={!!p.held} onCenter={setCenter} />
      <WorldScene
        plan={plan}
        map={p.map}
        layouts={layouts}
        creatures={p.creatures}
        night={p.phase === 'gece' || p.phase === 'aksam'}
        books={p.books}
        reading={p.reading}
        selected={selected}
        phase={p.phase}
        channels={p.channels}
        dice={p.dice}
        tv={p.tv}
        board={p.board}
        posed={posed}
        center={center}
        onWalk={p.held ? undefined : onWalk}
        onBook={onBook}
        onDoor={p.held ? undefined : onDoor}
        onItem={onItem}
      />
      {editR && p.edit && (
        <group position={[editR.x, 0, editR.y]}>
          <EditOverlay region={editR} edit={p.edit} ctx={plan.ctx} held={p.held} hoverTo={hoverTo} onRelease={release} />
        </group>
      )}
      {/* Zemine dokunma/sürükleme yakalayıcı: bütün oda */}
      <mesh
        position={[plan.w / 2, 0.02, plan.h / 2]}
        rotation-x={-Math.PI / 2}
        onClick={onFloorClick}
        onPointerMove={(e) => p.edit && !heldWall && hoverTo.current?.(spotOf(e))}
        onPointerUp={(e) => !heldWall && release(e, spotOf(e))}
      >
        <planeGeometry args={[plan.w, plan.h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Avatar look={p.look} walker={walker} onTile={onTile} holding={p.holding} onTap={onAvatar} water={water} onWater={onWater} onStop={onStop} />
      {p.anchor && <AvatarAnchor el={p.anchor} />}
      <Companions pets={p.pets} at={leader} />
      {p.held && <HoldCursor />}
    </>
  );
}

/**
 * Yerleştirilen alanın içine çizilenler (alanın yerel koordinatında): ızgara, imleç karosu, elde tutulan eşyanın
 * yeşil/kırmızı önizlemesi, duvar süsü tutulurken duvar yakalayıcıları. İmleç state'i burada: imleç gezerken
 * yalnızca bu katman çizilir.
 */
function EditOverlay({
  region,
  edit,
  ctx,
  held,
  hoverTo,
  onRelease,
}: {
  region: Region;
  edit: { space: SpaceId; layout: SpaceLayout };
  ctx: WorldCtx;
  held: { item: string; rot: number } | null;
  hoverTo: MutableRefObject<((t: Spot | null) => void) | null>;
  onRelease: (e: ThreeEvent<PointerEvent>, t: Spot) => void;
}) {
  const [hover, setHover] = useState<Spot | null>(null);
  useEffect(() => {
    hoverTo.current = (t) => setHover((h) => (h && t && h.x === t.x && h.y === t.y && h.sub === t.sub ? h : t));
    return () => {
      hoverTo.current = null;
    };
  }, [hoverTo]);
  const heldItem = held ? itemById(held.item) : undefined;
  const heldWall = heldItem?.placement === 'wall';
  const indoor = isIndoor(region.id, ctx);
  const ghost =
    held && hover && (heldWall ? hover.x === -1 || hover.y === -1 : hover.x >= 0 && hover.y >= 0)
      ? { item: held.item, x: hover.x, y: hover.y, rot: heldWall ? wallRot(hover.x, hover.y) : held.rot, ...(hover.sub === undefined ? {} : { sub: hover.sub }) }
      : null;
  const ghostOk = ghost ? canPlaceAt(edit.space, edit.layout, ctx, ghost) : false;
  const support = ghost ? supportOf(edit.layout, ghost) : null;
  const supportItem = support != null ? itemById(edit.layout.items[support].item) : undefined;
  const model = ghost && heldItem && <ItemModel item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} sub={ghost.sub} ghost={ghostOk ? 'ok' : 'bad'} lift={0.05} />;
  const set = (t: Tile) => hoverTo.current?.(t);
  return (
    <>
      <GridLines w={region.w} h={region.h} color={indoor ? '#6b4a2f' : '#ffffff'} />
      {held && hover && !heldWall && hover.x >= 0 && hover.y >= 0 && hover.x < region.w && hover.y < region.h && <HoverTile x={hover.x} y={hover.y} />}
      {ghost && heldItem && (
        <>
          <FootTiles item={heldItem} x={ghost.x} y={ghost.y} rot={ghost.rot} ok={ghostOk} sub={ghost.sub} />
          <Suspense fallback={null}>{supportItem ? <OnSurface support={supportItem}>{model}</OnSurface> : model}</Suspense>
        </>
      )}
      {/* Duvar süsü tutulurken duvarlar yakalar: arka duvar y = -1, sol duvar x = -1 */}
      {indoor && heldWall && (
        <>
          <mesh
            position={[region.w / 2, WALL_H / 2, 0.05]}
            onPointerMove={(e) => set({ x: Math.floor(e.point.x - region.x), y: -1 })}
            onPointerUp={(e) => onRelease(e, { x: Math.floor(e.point.x - region.x), y: -1 })}
          >
            <planeGeometry args={[region.w, WALL_H]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh
            position={[0.05, WALL_H / 2, region.h / 2]}
            rotation-y={Math.PI / 2}
            onPointerMove={(e) => set({ x: -1, y: Math.floor(e.point.z - region.y) })}
            onPointerUp={(e) => onRelease(e, { x: -1, y: Math.floor(e.point.z - region.y) })}
          >
            <planeGeometry args={[region.h, WALL_H]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </>
  );
}

function HoldCursor() {
  useEffect(() => {
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = '';
    };
  }, []);
  return null;
}

/**
 * Habbo gibi sabit kamera: oda açılınca bütünü ekrana sığar ve odanın ortasına bakar; açı hep aynı (güneydoğu).
 * Sürükleme kaydırır, tekerlek/iki parmak yakınlaştırır. Yakınlaştırınca kamera karakteri izler (yürüyünce),
 * kullanıcı kaydırınca bırakır. Elde eşya varken kamera kilitli (sürükleme eşyayı gezdirir).
 */
function Camera({
  plan,
  walker,
  follow,
  zoomedIn,
  locked,
  onCenter,
}: {
  plan: WorldPlan;
  walker: MutableRefObject<Walker>;
  follow: MutableRefObject<boolean>;
  zoomedIn: MutableRefObject<boolean>;
  locked: boolean;
  onCenter: (t: Tile) => void;
}) {
  const { camera, size: screen, invalidate } = useThree();
  const controls = useRef<OrbitImpl>(null);
  const reported = useRef({ x: -99, y: -99 });
  const OFF = useMemo(() => new Vector3(...CAM_OFF), []);
  const tmp = useMemo(() => new Vector3(), []);
  // Odanın bütünü sığsın: izometrikte en (w + h)·0.71, boy (w + h)·0.41 + duvar
  const span = plan.w + plan.h;
  const fit = Math.min(screen.width / (span * 0.72 + 1.6), screen.height / (span * 0.41 + WALL_H * 0.82 + 1.4));

  // Başta (ve ekran boyu değişince: tam ekran) oda ortaya, bütünü görünür
  useEffect(() => {
    const c = controls.current;
    const target = new Vector3(plan.w / 2, 0.6, plan.h / 2);
    camera.position.copy(target).add(OFF);
    camera.zoom = fit;
    camera.updateProjectionMatrix();
    if (c) {
      c.target.copy(target);
      c.update();
    }
    follow.current = false;
    zoomedIn.current = false;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // Kullanıcı kamerayı tutunca izleme biter; yakınlaştırınca karakter yürüyünce izlenir (walkTo)
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const start = () => (follow.current = false);
    const clamp = () => {
      zoomedIn.current = camera.zoom > fit * 1.25;
      const t = c.target;
      const x = Math.min(plan.w, Math.max(0, t.x));
      const z = Math.min(plan.h, Math.max(0, t.z));
      if (x !== t.x || z !== t.z) {
        const d = new Vector3(x - t.x, 0, z - t.z);
        t.add(d);
        camera.position.add(d);
      }
      const r = reported.current;
      if (Math.abs(t.x - r.x) + Math.abs(t.z - r.y) > 3) {
        reported.current = { x: t.x, y: t.z };
        onCenter({ x: Math.floor(t.x), y: Math.floor(t.z) });
      }
    };
    c.addEventListener('start', start);
    c.addEventListener('change', clamp);
    return () => {
      c.removeEventListener('start', start);
      c.removeEventListener('change', clamp);
    };
  }, [camera, plan.w, plan.h, follow, zoomedIn, fit, onCenter]);

  // Karakteri yumuşakça izle (yalnızca yakınlaştırılmışken)
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !follow.current) return;
    const w = walker.current;
    tmp.set(w.x - c.target.x, 0, w.z - c.target.z);
    if (tmp.lengthSq() < 0.0004) return;
    tmp.multiplyScalar(1 - Math.exp(-Math.min(dt, 0.05) * 6));
    c.target.add(tmp);
    camera.position.add(tmp);
    c.update();
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!locked}
      enableRotate={false}
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning={false}
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
      minZoom={fit * 0.7}
      maxZoom={fit * 3.2}
    />
  );
}
