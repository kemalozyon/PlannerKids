// Kısa efektler (lib/fx.ts → emitFx): eşya kaldırılınca toz bulutu ("puf"), konunca küçük pırıltılar. Tek bir
// instanced mesh; efekt sürerken kare ister, bitince sahne yine "istek üzerine" çizilir. Azaltılmış harekette yok.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import { onFx, type FxEvent } from '../../lib/fx';
import { reducedMotion } from './motion';

const N = 96;
const LIFE = 0.7;

interface Part {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  born: number;
  color: Color;
}

const PUFF = ['#ffffff', '#f1ece2', '#e2dccf'];
const SPARK = ['#fff3b0', '#ffd23f', '#ffffff', '#b6f3ff'];

export default function Fx() {
  const mesh = useRef<InstancedMesh>(null);
  const parts = useRef<Part[]>([]);
  const clock = useRef(0);
  const tmp = useMemo(() => new Object3D(), []);
  const invalidate = useThree((s) => s.invalidate);
  // Renk tamponu baştan olsun (ilk efektte malzeme yeniden derlenmesin)
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const white = new Color('#ffffff');
    for (let i = 0; i < N; i++) {
      tmp.scale.setScalar(0);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, white);
    }
  }, [tmp]);
  useEffect(
    () =>
      onFx((e: FxEvent) => {
        if (reducedMotion()) return;
        const w = e.w ?? 1;
        const h = e.h ?? 1;
        const n = e.kind === 'puff' ? 14 + Math.round(w * h * 2) : 10;
        const list = e.kind === 'puff' ? PUFF : SPARK;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random();
          parts.current.push({
            x: e.x + (Math.random() - 0.5) * w * 0.8,
            y: (e.y ?? 0) + 0.1 + Math.random() * 0.3,
            z: e.z + (Math.random() - 0.5) * h * 0.8,
            vx: Math.cos(a) * (0.6 + r),
            vy: e.kind === 'puff' ? 0.6 + Math.random() * 0.8 : 1.4 + Math.random() * 1.2,
            vz: Math.sin(a) * (0.6 + r),
            size: e.kind === 'puff' ? 0.12 + Math.random() * 0.12 : 0.04 + Math.random() * 0.04,
            born: clock.current,
            color: new Color(list[i % list.length]),
          });
        }
        if (parts.current.length > N) parts.current.splice(0, parts.current.length - N);
        invalidate();
      }),
    [invalidate],
  );
  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    clock.current += dt;
    const t = clock.current;
    parts.current = parts.current.filter((p) => t - p.born < LIFE);
    const list = parts.current;
    for (let i = 0; i < N; i++) {
      const p = list[i];
      if (!p) {
        tmp.scale.setScalar(0);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        continue;
      }
      const age = (t - p.born) / LIFE;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      // Sürtünme: hızla yayılıp yavaşlar
      p.vx *= Math.exp(-dt * 4);
      p.vz *= Math.exp(-dt * 4);
      p.vy *= Math.exp(-dt * 3);
      tmp.position.set(p.x, p.y, p.z);
      tmp.scale.setScalar(p.size * (age < 0.2 ? age / 0.2 : 1 - (age - 0.2) / 0.8));
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, p.color);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.count = N;
    if (list.length) invalidate();
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}
