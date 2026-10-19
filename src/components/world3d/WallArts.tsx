// Kodla çizilen yeni duvar süsleri (items.json → art): yuvarlak ayna, bayrak, vitray, yuvarlak pencere, neon kalp
// ve yıldız (TOGGLE + CHANGE_COLOR: seçili renkte parlar), asma bitki, akvaryum (açıkken balıklar yüzer). Grup
// duvar eşyasının ortasında, önü duvardan dışa (+z) bakar (items.tsx → WallItem).
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, type ComponentType } from 'react';
import { DoubleSide, ExtrudeGeometry, Shape, type Group } from 'three';

export interface WallArtProps {
  /** Çizim genişliği (birim) ve kapladığı karo sayısı */
  w: number;
  n: number;
  on: boolean;
  /** Ana ya da seçili renk */
  color: string;
}

function heartShape(s: number) {
  const h = new Shape();
  h.moveTo(0, -s * 0.9);
  h.bezierCurveTo(s * 1.4, s * 0.1, s * 0.7, s * 1.1, 0, s * 0.45);
  h.bezierCurveTo(-s * 0.7, s * 1.1, -s * 1.4, s * 0.1, 0, -s * 0.9);
  return h;
}

function starShape(s: number) {
  const st = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.45 : s;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) st.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else st.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  st.closePath();
  return st;
}

/** Neon tabela: şekil seçili renkte, açıkken parlar */
function Neon({ shape, on, color }: { shape: 'kalp' | 'yildiz'; on: boolean; color: string }) {
  const geo = useMemo(() => {
    const g = new ExtrudeGeometry(shape === 'kalp' ? heartShape(0.28) : starShape(0.32), { depth: 0.04, bevelEnabled: false });
    g.center();
    return g;
  }, [shape]);
  return (
    <group>
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[0.8, 0.8, 0.02]} />
        <meshStandardMaterial color="#1f2226" transparent opacity={0.35} />
      </mesh>
      <mesh geometry={geo} position={[0, 0, 0.05]}>
        <meshStandardMaterial color={on ? color : '#9aa0a6'} emissive={on ? color : '#000000'} emissiveIntensity={on ? 1.3 : 0} toneMapped={!on} />
      </mesh>
    </group>
  );
}

function Mirror() {
  return (
    <group>
      <mesh position={[0, 0, 0.02]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.36, 0.36, 0.04, 28]} />
        <meshStandardMaterial color="#c9a227" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.042]}>
        <circleGeometry args={[0.31, 28]} />
        <meshStandardMaterial color="#dfeef6" metalness={0.95} roughness={0.05} />
      </mesh>
    </group>
  );
}

function Flag({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[-0.32, 0, 0.06]} rotation-z={0.5}>
        <cylinderGeometry args={[0.015, 0.015, 0.9, 8]} />
        <meshStandardMaterial color="#8a5a34" />
      </mesh>
      <mesh position={[0.02, 0.18, 0.06]} rotation-z={0.5}>
        <boxGeometry args={[0.55, 0.36, 0.01]} />
        <meshStandardMaterial color={color} side={DoubleSide} />
      </mesh>
      <mesh position={[0.02, 0.18, 0.067]} rotation-z={0.5}>
        <circleGeometry args={[0.08, 5]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

function Stained({ w }: { w: number }) {
  const panes = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#b07cff', '#ff9f43'];
  const cols = Math.max(2, Math.round(w * 3));
  const pw = (w - 0.1) / cols;
  return (
    <group>
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[w + 0.06, 0.96, 0.03]} />
        <meshStandardMaterial color="#4a3524" />
      </mesh>
      {Array.from({ length: cols * 3 }, (_, i) => {
        const x = -w / 2 + 0.05 + pw * (i % cols) + pw / 2;
        const y = -0.3 + Math.floor(i / cols) * 0.3;
        const c = panes[(i * 7) % panes.length];
        return (
          <mesh key={i} position={[x, y, 0.03]}>
            <planeGeometry args={[pw - 0.03, 0.27]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.35} transparent opacity={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function RoundWindow() {
  return (
    <group>
      <mesh position={[0, 0, 0.02]}>
        <torusGeometry args={[0.34, 0.05, 8, 28]} />
        <meshStandardMaterial color="#f4efe6" />
      </mesh>
      <mesh position={[0, 0, 0.015]}>
        <circleGeometry args={[0.32, 28]} />
        <meshStandardMaterial color="#9fd8ff" emissive="#9fd8ff" emissiveIntensity={0.35} />
      </mesh>
      {[0, Math.PI / 2].map((r) => (
        <mesh key={r} position={[0, 0, 0.03]} rotation-z={r}>
          <boxGeometry args={[0.64, 0.03, 0.02]} />
          <meshStandardMaterial color="#f4efe6" />
        </mesh>
      ))}
    </group>
  );
}

function Hanging({ color }: { color: string }) {
  return (
    <group position={[0, 0.25, 0.18]}>
      <mesh>
        <cylinderGeometry args={[0.14, 0.1, 0.16, 12]} />
        <meshStandardMaterial color="#d98b6a" />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[Math.cos(i) * 0.12, -0.15 - (i % 3) * 0.12, Math.sin(i) * 0.06]} rotation-z={Math.sin(i) * 0.4}>
          <boxGeometry args={[0.08, 0.32 + (i % 3) * 0.1, 0.02]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Fish({ on, i, w }: { on: boolean; i: number; w: number }) {
  const g = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    if (!on || !g.current) return;
    const t = clock.elapsedTime * (0.6 + i * 0.25) + i * 2;
    g.current.position.x = Math.sin(t) * (w / 2 - 0.15);
    g.current.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI;
    invalidate();
  });
  const c = ['#ff9f43', '#ffd23f', '#ef476f'][i % 3];
  return (
    <group ref={g} position={[(i - 1) * 0.2, -0.15 + i * 0.12, 0.12]}>
      <mesh scale={[1.6, 1, 0.6]}>
        <sphereGeometry args={[0.04, 8, 6]} />
        <meshStandardMaterial color={c} />
      </mesh>
      <mesh position={[-0.07, 0, 0]} rotation-z={Math.PI / 2}>
        <coneGeometry args={[0.03, 0.05, 4]} />
        <meshStandardMaterial color={c} />
      </mesh>
    </group>
  );
}

function Aquarium({ w, on }: { w: number; on: boolean }) {
  return (
    <group>
      <mesh position={[0, 0, 0.13]}>
        <boxGeometry args={[w, 0.6, 0.24]} />
        <meshStandardMaterial color="#5fc4f0" transparent opacity={0.45} emissive="#5fc4f0" emissiveIntensity={on ? 0.35 : 0.1} />
      </mesh>
      <mesh position={[0, -0.27, 0.13]}>
        <boxGeometry args={[w - 0.02, 0.06, 0.22]} />
        <meshStandardMaterial color="#e8d3a8" />
      </mesh>
      <mesh position={[0, 0.31, 0.13]}>
        <boxGeometry args={[w + 0.02, 0.04, 0.26]} />
        <meshStandardMaterial color="#2b2622" />
      </mesh>
      {[0, 1, 2].map((i) => (
        <Fish key={i} on={on} i={i} w={w} />
      ))}
    </group>
  );
}

/** Aplik: duvara tutturulmuş kol ve küçük abajur; açıkken yanar */
function Sconce({ on, color }: { on: boolean; color: string }) {
  return (
    <group>
      <mesh position={[0, -0.12, 0.03]}>
        <boxGeometry args={[0.12, 0.2, 0.04]} />
        <meshStandardMaterial color="#c9a227" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -0.05, 0.12]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.02, 0.02, 0.18, 6]} />
        <meshStandardMaterial color="#c9a227" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.06, 0.2]}>
        <cylinderGeometry args={[0.1, 0.15, 0.18, 14, 1, true]} />
        <meshStandardMaterial color={on ? '#fff3d0' : color} emissive="#ffd27a" emissiveIntensity={on ? 0.9 : 0} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** Neon şerit: duvar boyunca parlayan çubuk; renk seçilebilir */
function NeonStrip({ w, on, color }: { w: number; on: boolean; color: string }) {
  return (
    <group position={[0, 0.55, 0]}>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[w, 0.05, 0.03]} />
        <meshStandardMaterial color="#2b2622" />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[w - 0.04, 0.025, 0.02]} />
        <meshStandardMaterial color={on ? color : '#9aa5ad'} emissive={color} emissiveIntensity={on ? 1.6 : 0} toneMapped={!on} />
      </mesh>
    </group>
  );
}

/** art adı → çizim (Framed'in resimlerinden ayrı, kendi biçimi olanlar) */
export const WALL_ART: Record<string, ComponentType<WallArtProps>> = {
  'ayna-yuvarlak': () => <Mirror />,
  bayrak: ({ color }) => <Flag color={color} />,
  vitray: ({ w }) => <Stained w={w} />,
  'pencere-yuvarlak': () => <RoundWindow />,
  'neon-kalp': ({ on, color }) => <Neon shape="kalp" on={on} color={color} />,
  'neon-yildiz': ({ on, color }) => <Neon shape="yildiz" on={on} color={color} />,
  asma: ({ color }) => <Hanging color={color} />,
  akvaryum: ({ w, on }) => <Aquarium w={w} on={on} />,
  aplik: ({ on, color }) => <Sconce on={on} color={color} />,
  'neon-serit': ({ w, on, color }) => <NeonStrip w={w} on={on} color={color} />,
};
