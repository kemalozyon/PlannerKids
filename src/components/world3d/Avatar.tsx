// Dünyadaki karakter: tıklanan karoya A* ile bulunan yolu (world.ts → findPath) karo karo yürür; uzun yolda
// koşar (yol ~4 sn sürsün). Sahne "istek üzerine" çizildiğinden (frameloop="demand") yürürken her karede yeni bir
// kare ister. Karo değişince haber verir (bulunduğu alan, kamera, kayıtlı konum).
// Poz (otur, yat, sallan): karakter eşyanın üstüne geçer; yatarken gövde yatar, salıncakta sarkaç gibi sallanır.
// Hareket (karakter menüsü: dans, el salla) dururken oynar; yürümeye başlayınca biter.
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef, type MutableRefObject } from 'react';
import type { Group } from 'three';
import type { AvatarLook } from '../../lib/avatar';
import type { Pose } from '../../lib/world';
import AvatarModel, { HIP_Y, type AvatarAnim } from '../avatar/AvatarModel';
import { isTap } from './light';
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

export const WALK_SPEED = 3.6; // karo/sn
const RUN_FROM = 5;

/** Yolun hızı: kısa yolda yürür, uzun yolda koşar (en fazla ~4 sn sürsün) */
export const pathSpeed = (tiles: number) => Math.min(12, Math.max(WALK_SPEED, tiles / 4));

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

  useFrame(({ clock }, rawDt) => {
    const g = group.current;
    const n = inner.current;
    if (!g || !n) return;
    const dt = Math.min(rawDt, 0.05);
    const w = walker.current;
    const P = w.pose;
    if (P && !w.path.length) {
      anim.current.state = P.kind;
      applyPose(g, n, P, clock.elapsedTime);
      if (P.kind === 'swing') invalidate();
      return;
    }
    n.position.set(0, 0, 0);
    n.rotation.set(0, 0, 0);
    const next = w.path[0];
    if (next) w.emote = null;
    if (next) {
      const dx = next.x - w.x;
      const dz = next.z - w.z;
      const d = Math.hypot(dx, dz);
      const speed = w.speed ?? WALK_SPEED;
      const step = speed * dt;
      if (d <= step) {
        w.x = next.x;
        w.z = next.z;
        w.path.shift();
      } else {
        w.x += (dx / d) * step;
        w.z += (dz / d) * step;
      }
      let diff = Math.atan2(dx, dz) - w.face;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      w.face += diff * Math.min(1, dt * 14);
      anim.current.state = speed >= RUN_FROM ? 'run' : 'walk';
      invalidate();
    } else {
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
    const tx = Math.floor(w.x);
    const tz = Math.floor(w.z);
    if (onTile && tile.current !== `${tx},${tz}`) {
      tile.current = `${tx},${tz}`;
      onTile(tx, tz);
    }
  });

  return (
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
  );
}
