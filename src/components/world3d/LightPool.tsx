// Lambaların gerçek ışığı: sahnede her zaman tam MAX_LIGHTS nokta ışığı durur (sayı değişmez → malzemeler yeniden
// derlenmez, aç-kapa takılmaz). Her ışık merkeze en yakın açık lambalardan birine bağlanır; lamba değişince önce
// söner, yerine geçer, sonra yumuşakça yanar. Ateş (şömine, kamp ateşi) titrer.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { PointLight } from 'three';
import { damp } from './motion';

export interface Lamp {
  /** Eşyanın kimliği (powerKey) */
  k: string;
  x: number;
  y: number;
  z: number;
  color: string;
  fire: boolean;
}

export const MAX_LIGHTS = 4;

export default function LightPool({ lamps }: { lamps: Lamp[] }) {
  return (
    <>
      {Array.from({ length: MAX_LIGHTS }, (_, i) => (
        <PoolLight key={i} lamp={lamps[i] ?? null} />
      ))}
    </>
  );
}

function PoolLight({ lamp }: { lamp: Lamp | null }) {
  const ref = useRef<PointLight>(null);
  const cur = useRef<string | null>(null);
  const level = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  // Lamba değişince (aç-kapa, yaklaşma) geçiş başlasın
  useEffect(() => invalidate(), [lamp?.k, lamp?.color, invalidate]);
  useFrame(({ clock }, rawDt) => {
    const l = ref.current;
    if (!l) return;
    const dt = Math.min(rawDt, 0.05);
    const want = lamp?.k ?? null;
    // Başka lambaya geçecekse önce söner, sonra yerine geçip yanar
    if (want !== cur.current && level.current < 0.04) {
      cur.current = want;
      level.current = 0;
      if (lamp) {
        l.position.set(lamp.x, lamp.y, lamp.z);
        l.color.set(lamp.color);
        l.distance = lamp.fire ? 5 : 4.5;
      }
    }
    const target = want && want === cur.current ? 1 : 0;
    const prev = level.current;
    level.current = damp(level.current, target, target ? 5 : 9, dt);
    if (Math.abs(level.current - target) < 0.003) level.current = target;
    if (lamp && cur.current === want) l.color.set(lamp.color);
    const fire = !!lamp?.fire && cur.current === want;
    const flicker = fire ? 1.15 + Math.sin(clock.elapsedTime * 13) * 0.16 + Math.sin(clock.elapsedTime * 7.3) * 0.12 : 1;
    l.intensity = level.current * 2.6 * flicker;
    if (level.current !== prev || level.current !== target || want !== cur.current) invalidate();
  });
  return <pointLight ref={ref} intensity={0} distance={4.5} decay={1.5} position={[0, -50, 0]} />;
}
