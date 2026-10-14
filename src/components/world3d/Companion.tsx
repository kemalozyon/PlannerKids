// Yanına alınan evcil hayvanlar (equipped.pets): karakterin biraz arkasında, yanında yürür. Karakter durunca
// durur, uzaklaşınca koşarak yetişir; çok geride kalırsa (kapıdan geçti, ışınlandı) yanına atlar. Sahne "istek
// üzerine" çizildiğinden yürürken kare ister. Dünya görünümü ve gezinti kullanır (`at` karakterin yerini verir).
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { itemById } from '../../lib/catalog';
import { modelUrl } from '../forest3d/models';

export type Leader = () => { x: number; z: number; face: number; y?: number };

export default function Companions({ pets, at }: { pets: string[]; at: Leader }) {
  return (
    <>
      {pets.map((id, i) => {
        const it = itemById(id);
        return it?.model ? (
          <Suspense key={id} fallback={null}>
            <Pet model={it.model} fly={!!it.fly} side={i === 0 ? 1 : -1} at={at} />
          </Suspense>
        ) : null;
      })}
    </>
  );
}

function Pet({ model, fly, side, at }: { model: string; fly: boolean; side: number; at: Leader }) {
  const { scene, animations } = useGLTF(modelUrl(model));
  const obj = useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse((c) => (c.castShadow = true));
    return o;
  }, [scene]);
  const group = useRef<Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const [moving, setMoving] = useState(false);
  const invalidate = useThree((s) => s.invalidate);
  const pos = useRef<{ x: number; z: number; face: number } | null>(null);
  useEffect(() => {
    const walk = names.find((n) => /walk|run|fly/i.test(n)) ?? names[0];
    const idle = names.find((n) => /idle/i.test(n)) ?? names[0];
    const a = actions[moving ? walk : idle];
    a?.reset().fadeIn(0.2).play();
    invalidate();
    return () => {
      a?.fadeOut(0.2);
    };
  }, [moving, actions, names, invalidate]);
  useFrame(({ clock }, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const L = at();
    // Hedef: karakterin arka çaprazı
    const tx = L.x - Math.sin(L.face) * 0.7 + Math.cos(L.face) * 0.55 * side;
    const tz = L.z - Math.cos(L.face) * 0.7 - Math.sin(L.face) * 0.55 * side;
    const p = (pos.current ??= { x: tx, z: tz, face: L.face });
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    let go = false;
    if (d > 6) {
      p.x = tx;
      p.z = tz;
    } else if (d > 0.2) {
      const step = Math.min(d, dt * Math.max(2.5, d * 3.2));
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      let diff = Math.atan2(dx, dz) - p.face;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.face += diff * Math.min(1, dt * 10);
      go = true;
    }
    if (go !== moving) setMoving(go);
    if (go) invalidate();
    g.position.set(p.x, (L.y ?? 0) + (fly ? 0.9 + Math.sin(clock.elapsedTime * 3) * 0.12 : 0.02), p.z);
    g.rotation.y = p.face;
  });
  return (
    <group ref={group} scale={fly ? 0.3 : 0.42}>
      <primitive object={obj} />
    </group>
  );
}
