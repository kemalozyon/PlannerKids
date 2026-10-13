// Avatarın dönen 3D önizlemesi (Profil, karakter düzenleyici, dükkânda kıyafet). Sürükleyerek çevrilir.
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import type { AvatarLook } from '../../lib/avatar';
import AvatarModel, { type AvatarAnim, type AvatarState } from './AvatarModel';

export default function AvatarPreview({ look, state = 'idle', className = 'avatar-preview', zoom = 1 }: { look: AvatarLook; state?: AvatarState; className?: string; zoom?: number }) {
  const anim = useRef<AvatarAnim>({ state });
  anim.current.state = state;
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }} camera={{ fov: 30, position: [0, 0.9, 3.6 / zoom] }}>
        <hemisphereLight args={['#ffffff', '#8a7a60', 1.4]} />
        <directionalLight position={[2, 4, 3]} intensity={2} />
        <group position={[0, -0.05, 0]}>
          <AvatarModel look={look} anim={anim} live />
        </group>
        <mesh position={[0, -0.04, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.55, 32]} />
          <meshStandardMaterial color="#000000" transparent opacity={0.12} />
        </mesh>
        <OrbitControls target={[0, 0.62, 0]} enablePan={false} enableZoom={false} minPolarAngle={1.1} maxPolarAngle={1.6} autoRotate autoRotateSpeed={1.2} />
      </Canvas>
    </div>
  );
}
