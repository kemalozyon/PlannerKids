// Dünyadaki karakter: tıklanan karoya A* ile bulunan yolu (world.ts → findPath) karo karo yürür; uzun yolda
// koşar (yol ~4 sn sürsün). Sahne "istek üzerine" çizildiğinden (frameloop="demand") yürürken her karede yeni bir
// kare ister. Karo değişince haber verir (bulunduğu alan, kamera, kayıtlı konum).
// Poz (otur, yat, sallan): karakter eşyanın üstüne geçer; yatarken gövde yatar, salıncakta sarkaç gibi sallanır.
// Hareket (karakter menüsü: dans, el salla) dururken oynar; yürümeye başlayınca biter.
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef, type MutableRefObject } from 'react';
import { Euler, Vector3, type Group } from 'three';
import type { AvatarLook } from '../../lib/avatar';
import type { Pose } from '../../lib/world';
import AvatarModel, { HIP_Y, type AvatarAnim } from '../avatar/AvatarModel';
import { isTap } from './light';
import { Blob } from './Blob';
import { angleDiff, dampAngle, easeInOut } from './motion';
import { swingAngle, SWING_ROPE } from './Proc';

/** Karakterin yeri (dünya koordinatı, karo merkezleri) ve kalan yolu */
export interface Walker {
  x: number;
  z: number;
  face: number;
  path: { x: number; z: number }[];
  /** Yol bitince bir kez çağrılır (kitaplık, ağaç, eşya) */
  onArrive: (() => void) | null;
  /** Bu yolun hızı (karo/sn); verilmezse yürüme hızı */
  speed?: number;
  /** Eşyanın üstünde: otur, yat, sallan (dünya konumu); kalkınca `back` karosuna iner */
  pose?: { kind: Pose; x: number; z: number; y: number; face: number; back: { x: number; z: number } } | null;
  /** Dururken oynayan hareket; `until` (saat, sn) gelince biter, yoksa durdurulana kadar sürer */
  emote?: { kind: 'dance' | 'wave'; until?: number } | null;
}

/** Pozu çizer (dünya görünümü ve gezinti): dış grup eşyanın üstünde, iç grup yatarken yatar, salıncakta sallanır */
export function applyPose(g: Group, n: Group, P: { kind: Pose; x: number; z: number; y: number; face: number }, time: number) {
  g.position.set(P.x, P.kind === 'lie' ? P.y + 0.12 : P.y - HIP_Y, P.z);
  g.rotation.y = P.face;
  if (P.kind === 'lie') {
    n.position.set(0, 0, 0.6);
    n.rotation.set(-Math.PI / 2, 0, 0);
  } else if (P.kind === 'swing') {
    // Sarkaç: ip kirişten sarkar, oturak öne arkaya gider
    const a = swingAngle(time);
    n.position.set(0, (1 - Math.cos(a)) * SWING_ROPE, Math.sin(a) * SWING_ROPE);
    n.rotation.set(-a, 0, 0);
  } else {
    n.position.set(0, 0, 0);
    n.rotation.set(0, 0, 0);
  }
}

/** Poz geçişi: oturunca/kalkınca karakter eski yerinden yenisine kayar (ışınlanmaz) */
export interface PoseBlend {
  key: string;
  k: number;
  p: Vector3;
  f: number;
  np: Vector3;
  nr: Euler;
}
const BLEND_S = 0.35;
export const newBlend = (): PoseBlend => ({ key: '', k: 1, p: new Vector3(), f: 0, np: new Vector3(), nr: new Euler() });
/** Pozun kimliği değiştiyse (oturdu, kalktı, başka eşyaya geçti) şimdiki duruşu başlangıç olarak saklar */
export function blendStart(b: PoseBlend, key: string, g: Group, n: Group) {
  if (b.key === key) return;
  b.key = key;
  b.k = 0;
  b.p.copy(g.position);
  b.f = g.rotation.y;
  b.np.copy(n.position);
  b.nr.copy(n.rotation);
}
/** Hedef duruş yazıldıktan sonra çağrılır: geçiş sürüyorsa başlangıçla hedef arasında karıştırır. Sürüyorsa true */
export function blendApply(b: PoseBlend, g: Group, n: Group, dt: number): boolean {
  if (b.k >= 1) return false;
  b.k = Math.min(1, b.k + dt / BLEND_S);
  const e = easeInOut(b.k);
  g.position.lerpVectors(b.p, g.position, e);
  // Oturağa inerken hafif yay çizer (önce biraz kalkar)
  g.position.y += Math.sin(e * Math.PI) * 0.12;
  g.rotation.y = b.f + angleDiff(b.f, g.rotation.y) * e;
  n.position.lerpVectors(b.np, n.position, e);
  n.rotation.set(b.nr.x + (n.rotation.x - b.nr.x) * e, b.nr.y + (n.rotation.y - b.nr.y) * e, b.nr.z + (n.rotation.z - b.nr.z) * e);
  return true;
}

export const WALK_SPEED = 3.6; // karo/sn
const RUN_FROM = 5;

/** Yolun hızı: kısa yolda yürür, uzun yolda koşar (~4 sn sürsün; çok hızlı koşu ayak kaydırır) */
export const pathSpeed = (tiles: number) => Math.min(9, Math.max(WALK_SPEED, tiles / 4));
/** Kalkışta hızlanma (karo/sn²) ve varışta yavaşlama */
const ACCEL = 22;
const DECEL = 16;

export default function Avatar({
  look,
  walker,
  onTile,
  holding,
  onTap,
}: {
  look: AvatarLook;
  walker: MutableRefObject<Walker>;
  onTile?: (x: number, y: number) => void;
  holding?: string | null;
  /** Karaktere dokunuldu (karakter menüsü) */
  onTap?: () => void;
}) {
  const tile = useRef('');
  const group = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const anim = useRef<AvatarAnim>({ state: 'idle' });
  const invalidate = useThree((s) => s.invalidate);

  const vel = useRef(0);
  const blend = useRef(newBlend());
  const shadow = useRef<Group>(null);

  useFrame(({ clock }, rawDt) => {
    const g = group.current;
    const n = inner.current;
    if (!g || !n) return;
    const dt = Math.min(rawDt, 0.05);
    const w = walker.current;
    const P = w.pose;
    if (P && !w.path.length) {
      blendStart(blend.current, `${P.kind}:${P.x},${P.z}`, g, n);
      anim.current.state = P.kind;
      applyPose(g, n, P, clock.elapsedTime);
      if (blendApply(blend.current, g, n, dt) || P.kind === 'swing') invalidate();
      shadow.current?.position.set(g.position.x, 0, g.position.z);
      vel.current = 0;
      return;
    }
    blendStart(blend.current, '', g, n);
    n.position.set(0, 0, 0);
    n.rotation.set(0, 0, 0);
    const next = w.path[0];
    if (next) w.emote = null;
    if (next) {
      const dx = next.x - w.x;
      const dz = next.z - w.z;
      const d = Math.hypot(dx, dz);
      // Kalan yol: hedefe yaklaşınca yavaşlar, kalkışta hızlanır
      let left = d;
      for (let i = 1; i < w.path.length; i++) left += Math.hypot(w.path[i].x - w.path[i - 1].x, w.path[i].z - w.path[i - 1].z);
      const top = w.speed ?? WALK_SPEED;
      const v = Math.min(top, vel.current + ACCEL * dt, Math.max(1.4, Math.sqrt(2 * DECEL * left)));
      vel.current = v;
      const step = v * dt;
      if (d <= step) {
        w.x = next.x;
        w.z = next.z;
        w.path.shift();
      } else {
        w.x += (dx / d) * step;
        w.z += (dz / d) * step;
      }
      if (d > 0.01) w.face = dampAngle(w.face, Math.atan2(dx, dz), 12, dt);
      anim.current.state = v >= RUN_FROM ? 'run' : 'walk';
      anim.current.speed = v;
      invalidate();
    } else {
      vel.current = 0;
      anim.current.speed = undefined;
      const E = w.emote;
      if (E && E.until == null) E.until = E.kind === 'wave' ? clock.elapsedTime + 2.5 : undefined;
      if (E && E.until != null && clock.elapsedTime > E.until) w.emote = null;
      anim.current.state = w.emote?.kind ?? 'idle';
      if (w.emote) invalidate();
      if (w.onArrive) {
        const f = w.onArrive;
        w.onArrive = null;
        f();
      }
    }
    g.position.set(w.x, 0.02, w.z);
    g.rotation.y = w.face;
    if (blendApply(blend.current, g, n, dt)) invalidate();
    shadow.current?.position.set(g.position.x, 0, g.position.z);
    const tx = Math.floor(w.x);
    const tz = Math.floor(w.z);
    if (onTile && tile.current !== `${tx},${tz}`) {
      tile.current = `${tx},${tz}`;
      onTile(tx, tz);
    }
  });

  return (
    <>
      <group ref={shadow}>
        <Blob size={0.75} />
      </group>
      <group
        ref={group}
        onClick={
          onTap &&
          ((e: ThreeEvent<MouseEvent>) => {
            if (!isTap(e)) return;
            e.stopPropagation();
            onTap();
          })
        }
      >
        <group ref={inner}>
          <AvatarModel look={look} anim={anim} holding={holding} />
        </group>
      </group>
    </>
  );
}
