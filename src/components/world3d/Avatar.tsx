// Dünyadaki karakter: tıklanan karoya A* ile bulunan yolu (world.ts → findPath) karo karo yürür.
// Sahne "istek üzerine" çizildiğinden (frameloop="demand") yürürken her karede yeni bir kare ister.
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { Group } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Item } from '../../lib/catalog';
import { Accessory } from '../forest3d/Accessory';
import { modelUrl } from '../forest3d/models';

/** Karakterin yeri (dünya koordinatı, karo merkezleri) ve kalan yolu */
export interface Walker {
  x: number;
  z: number;
  face: number;
  path: { x: number; z: number }[];
  /** Yol bitince bir kez çağrılır (kapı, kitaplık, ağaç) */
  onArrive: (() => void) | null;
}

const SPEED = 2.6; // karo/sn
const SCALE = 1.1;

export default function Avatar({ model, accessory, walker }: { model: string; accessory: Item | null; walker: MutableRefObject<Walker> }) {
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
  const invalidate = useThree((s) => s.invalidate);

  const play = (name: string) => {
    if (playing.current === name) return;
    const next = actions[name] ?? actions.idle;
    if (!next) return;
    if (playing.current) actions[playing.current]?.fadeOut(0.15);
    next.reset().fadeIn(0.15).play();
    playing.current = name;
  };

  useEffect(() => {
    play('idle');
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const w = walker.current;
    const next = w.path[0];
    if (next) {
      const dx = next.x - w.x;
      const dz = next.z - w.z;
      const d = Math.hypot(dx, dz);
      const step = SPEED * dt;
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
      play('walk');
      invalidate();
    } else {
      play('idle');
      if (w.onArrive) {
        const f = w.onArrive;
        w.onArrive = null;
        f();
      }
      // Durunca birkaç kare daha: yürüme → durma geçişi yumuşak bitsin
      if (playing.current === 'idle' && (actions.walk?.getEffectiveWeight() ?? 0) > 0.01) invalidate();
    }
    g.position.set(w.x, 0.02, w.z);
    g.rotation.y = w.face;
  });

  return (
    <group ref={group} scale={SCALE}>
      <primitive object={obj} />
      {accessory && <Accessory item={accessory} body={obj} />}
    </group>
  );
}
