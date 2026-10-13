// Aylık ormanın 3D adası (izometrik, low-poly). Orman sayfası bunu tembel yükler (three.js büyük);
// WebGL yoksa ya da hata olursa 2D ızgaraya düşer. Sahnenin kendisi world.tsx'te (gezinti de onu kullanır).
import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import type { OrthographicCamera } from 'three';
import { dayPhase, islandProgress } from '../../lib/island';
import { setSoundOn, soundOn } from '../../lib/sfx';
import type { ForestTree } from '../../lib/types';
import type { Wilt } from '../../lib/wilt';
import { preloadNature } from './models';
import type { Item } from '../../lib/catalog';
import { LIGHT, World, type PlacedThing } from './world';


export interface IslandProps {
  month: string;
  trees: ForestTree[];
  /** Bu ayın solgun fidanları */
  wilts: Wilt[];
  /** Ayın sonuna kadar toplam çalışma (ada büyüklüğü ve biyomlar buna göre) */
  totalMinutes: number;
  /** 'tree': yeni ağaç için boş hücre seçiliyor · 'move': ağacın yeni yeri seçiliyor */
  placing: 'none' | 'tree' | 'move';
  movingId?: string;
  onCell: (cell: number) => void;
  onTree: (t: ForestTree) => void;
  onWilt: (w: Wilt) => void;
  /** Varsa adanın köşesinde "Ormanda gez" düğmesi çıkar */
  onExplore?: () => void;
  /** Adaya yerleştirilmiş yapılar ve süsler */
  placed?: PlacedThing[];
  /** Yanındaki evcil hayvanlar */
  companions?: Item[];
}

export default function Island3D(props: IslandProps) {
  const p = useMemo(() => islandProgress(props.totalMinutes), [props.totalMinutes]);
  const [phase, setPhase] = useState(() => dayPhase(new Date().getHours()));
  const [sound, setSound] = useState(soundOn);
  useEffect(() => {
    preloadNature();
    const id = setInterval(() => setPhase(dayPhase(new Date().getHours())), 60_000);
    return () => {
      clearInterval(id);
      document.body.style.cursor = '';
    };
  }, []);
  const L = LIGHT[phase];

  return (
    <div className={`island-wrap phase-${phase}${props.placing !== 'none' ? ' placing' : ''}`} style={{ background: L.sky }}>
      <Canvas
        orthographic
        shadows
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [14, 15, 14], zoom: 30, near: -100, far: 200 }}
        aria-label="Ormanının 3D adası"
      >
        <Scene {...props} progress={p} phase={phase} />
      </Canvas>
      <span className="island-chip left">{L.label}</span>
      <button
        className="island-chip right"
        aria-label={sound ? 'Sesi kapat' : 'Sesi aç'}
        onClick={() => {
          setSoundOn(!sound);
          setSound(!sound);
        }}
      >
        {sound ? '🔊' : '🔇'}
      </button>
      <span className={`island-hint${props.onExplore ? ' left' : ''}`}>Döndürmek için sürükle · yakınlaştırmak için iki parmak</span>
      {props.onExplore && (
        <button className="island-explore" onClick={props.onExplore}>
          🚶 Ormanda gez
        </button>
      )}
    </div>
  );
}

function Scene({ progress, phase, ...props }: IslandProps & { progress: ReturnType<typeof islandProgress>; phase: ReturnType<typeof dayPhase> }) {
  return (
    <>
      <CameraFit radius={progress.radius} />
      <OrbitControls enablePan={false} enableDamping minPolarAngle={0.5} maxPolarAngle={1.15} makeDefault />
      <World {...props} progress={progress} phase={phase} />
    </>
  );
}

/** Kamera adayı ekrana sığdırır; yakınlaştırma sınırları buna göre. */
function CameraFit({ radius }: { radius: number }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    // Açılışta ağaçlara yakın dur (büyük adanın kenarları biraz taşabilir); uzaklaştırınca bütün ada görünür
    const span = Math.min(size.width, size.height * 1.3);
    const fit = span / (Math.min(radius, 6.6) * 2.05);
    cam.zoom = fit;
    cam.updateProjectionMatrix();
    const c = controls as unknown as { minZoom: number; maxZoom: number } | null;
    if (c) {
      c.minZoom = span / (radius * 2.3);
      c.maxZoom = fit * 2.5;
    }
  }, [camera, size.width, size.height, radius, controls]);
  return null;
}
