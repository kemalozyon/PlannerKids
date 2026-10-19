// Kısa efektler (lib/fx.ts → emitFx): eşya kaldırılınca toz bulutu ("puf"), konunca küçük pırıltılar, alımda konfeti,
// suya girince su sıçraması, ışınlanınca yükselen ışık sütunu. Tek bir
// instanced mesh; efekt sürerken kare ister, bitince sahne yine "istek üzerine" çizilir. Azaltılmış harekette yok.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import { onFx, type FxEvent } from '../../lib/fx';
import { reducedMotion } from './motion';

const N = 128;

interface Part {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  born: number;
  life: number;
  /** Yerçekimi (konfeti, su damlası düşer) */
  g: number;
  color: Color;
}

/** Her efektin parçacık ayarı */
const KINDS: Record<FxEvent['kind'], { n: (w: number, h: number) => number; colors: string[]; life: number; g: number; spread: number; up: [number, number]; size: [number, number] }> = {
  puff: { n: (w, h) => 14 + Math.round(w * h * 2), colors: ['#ffffff', '#f1ece2', '#e2dccf'], life: 0.7, g: 0, spread: 1, up: [0.6, 0.8], size: [0.12, 0.12] },
  sparkle: { n: () => 10, colors: ['#fff3b0', '#ffd23f', '#ffffff', '#b6f3ff'], life: 0.7, g: 0, spread: 1, up: [1.4, 1.2], size: [0.04, 0.04] },
  confetti: { n: () => 34, colors: ['#ff4f8b', '#ffd23f', '#4fd8ff', '#7ee08a', '#9b6cf0', '#ff8a3d'], life: 1.3, g: 7, spread: 1.4, up: [3.2, 1.6], size: [0.035, 0.03] },
  splash: { n: () => 22, colors: ['#ffffff', '#cfefff', '#7fd3ff', '#4fb4f0'], life: 0.8, g: 9, spread: 0.9, up: [2.4, 1.4], size: [0.04, 0.04] },
  beam: { n: () => 30, colors: ['#b6f3ff', '#7fe9ff', '#ffffff', '#d9b6ff'], life: 0.9, g: -1.5, spread: 0.12, up: [1.2, 1.6], size: [0.035, 0.03] },
};

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
        const k = KINDS[e.kind];
        const n = k.n(w, h);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random();
          // Işık sütunu: parçacıklar tabandan tepeye sırayla doğar
          const lift = e.kind === 'beam' ? (i / n) * 1.6 : Math.random() * 0.3;
          parts.current.push({
            x: e.x + (Math.random() - 0.5) * w * 0.8 * k.spread,
            y: (e.y ?? 0) + 0.1 + lift,
            z: e.z + (Math.random() - 0.5) * h * 0.8 * k.spread,
            vx: Math.cos(a) * (0.6 + r) * k.spread,
            vy: k.up[0] + Math.random() * k.up[1],
            vz: Math.sin(a) * (0.6 + r) * k.spread,
            size: k.size[0] + Math.random() * k.size[1],
            born: clock.current,
            life: k.life,
            g: k.g,
            color: new Color(k.colors[i % k.colors.length]),
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
    parts.current = parts.current.filter((p) => t - p.born < p.life);
    const list = parts.current;
    for (let i = 0; i < N; i++) {
      const p = list[i];
      if (!p) {
        tmp.scale.setScalar(0);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        continue;
      }
      const age = (t - p.born) / p.life;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      // Sürtünme: hızla yayılıp yavaşlar
      p.vx *= Math.exp(-dt * 4);
      p.vz *= Math.exp(-dt * 4);
      p.vy = p.g ? p.vy - p.g * dt : p.vy * Math.exp(-dt * 3);
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
