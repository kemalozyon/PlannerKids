// Bahçem sayfasının 3D görünümü: seçilen ayın ağaç bahçesi (Outdoor.tsx → MonthGarden) tek başına, sabit
// izometrik açıdan. Süslenmez: eşya yok, yalnızca her çalışılan günün ağacı, gün taşları ve canlılar. Ağacına
// Elmas düşmüş günlerin üstünde 💎 parlar; ağaca (ya da boş ekim yerine) dokununca sayfa o günün kartını açar.
import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import { MOUSE, TOUCH, Vector3 } from 'three';
import { CFG } from '../../lib/config';
import type { DayPhase } from '../../lib/dayPhase';
import type { Quality } from '../../lib/gfx';
import type { DayTree } from '../../lib/world';
import Atmosphere, { shadowsFor } from './Atmosphere';
import { QualityContext } from './gfx';
import { LIGHT } from './light';
import { Creatures, MonthGarden } from './Outdoor';

const G = CFG.world.monthGarden;
const OFF = new Vector3(18, 20, 18);

export default function GardenView({
  month,
  trees,
  locked,
  today,
  phase,
  quality,
  creatures,
  gems,
  growId,
  onGrown,
  onTree,
  onPlot,
}: {
  month: string;
  trees: DayTree[];
  locked: boolean;
  today: string;
  phase: DayPhase;
  quality: Quality;
  creatures: typeof CFG.world.creatures;
  gems: Map<number, number>;
  growId: string | null;
  onGrown: () => void;
  onTree: (t: DayTree) => void;
  onPlot: (day: number) => void;
}) {
  return (
    <Canvas
      orthographic
      frameloop="demand"
      shadows={shadowsFor(quality)}
      dpr={[1, quality === 'dusuk' ? 1.5 : 1.75]}
      camera={{ position: [G.w / 2 + OFF.x, OFF.y, G.h / 2 + OFF.z], zoom: 30, near: -60, far: 320 }}
      style={{ background: LIGHT[phase].horizon, touchAction: 'none' }}
      aria-label="Ağaç bahçen"
    >
      <Atmosphere phase={phase} quality={quality} mode="iso" />
      <QualityContext.Provider value={quality}>
        <Suspense fallback={null}>
          <MonthGarden
            month={month}
            trees={trees}
            locked={locked}
            today={today}
            growId={growId}
            onGrown={onGrown}
            onTree={(t) => onTree(t)}
            onGate={() => {}}
            labels={false}
            gems={gems}
            onPlot={onPlot}
          />
          {!locked && <Creatures list={creatures.slice(0, 3)} area={{ x0: 0.6, x1: G.w - 0.6, y0: 0.6, y1: G.h - 0.6 }} />}
        </Suspense>
      </QualityContext.Provider>
      <Fit />
    </Canvas>
  );
}

/** Bahçenin bütünü ekrana sığar; kaydırma ve yakınlaştırma var, döndürme yok */
function Fit() {
  const { camera, size, invalidate } = useThree();
  const fit = Math.min(size.width / ((G.w + G.h) * 0.72 + 1.5), size.height / ((G.w + G.h) * 0.41 + 2.6));
  useEffect(() => {
    camera.zoom = fit;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, fit, invalidate]);
  return (
    <OrbitControls
      makeDefault
      target={[G.w / 2, 0.4, G.h / 2]}
      enableRotate={false}
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning={false}
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
      minZoom={fit * 0.8}
      maxZoom={fit * 3}
    />
  );
}
