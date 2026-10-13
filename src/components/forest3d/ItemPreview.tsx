// Dükkân ve koleksiyonda bir eşyanın dönen 3D önizlemesi (karakter ve hayvanlar yerinde canlanır).
// three.js büyük olduğundan sayfalar bunu tembel yükler; WebGL yoksa yalnızca simge gösterilir.
import { useAnimations, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Box3, Vector3, type Group } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Item } from '../../lib/catalog';
import { modelUrl } from './models';

export default function ItemPreview({ item }: { item: Item }) {
  if (!item.model) return <div className="item-preview emoji">{item.icon}</div>;
  return (
    <div className="item-preview">
      <Canvas dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }} camera={{ fov: 35, position: [0, 1.1, 3.4] }}>
        <hemisphereLight args={['#ffffff', '#7a6a50', 1.3]} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} />
        <Suspense fallback={null}>
          <Model key={item.id} name={item.model} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Model 1.6 birim yüksekliğe sığdırılır, ortalanır ve yavaşça döner */
function Model({ name }: { name: string }) {
  const { scene, animations } = useGLTF(modelUrl(name));
  const obj = useMemo(() => cloneSkinned(scene), [scene]);
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(obj);
    const size = box.getSize(new Vector3());
    const s = 1.6 / Math.max(size.x, size.y, size.z, 0.01);
    const c = box.getCenter(new Vector3());
    return { s, x: -c.x * s, y: -box.min.y * s - 0.55, z: -c.z * s };
  }, [obj]);
  const group = useRef<Group>(null);
  const { actions } = useAnimations(animations, group);
  useEffect(() => {
    (actions.idle ?? Object.values(actions)[0])?.reset().play();
  }, [actions]);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.7;
  });
  return (
    <group ref={group}>
      <primitive object={obj} scale={fit.s} position={[fit.x, fit.y, fit.z]} />
    </group>
  );
}
