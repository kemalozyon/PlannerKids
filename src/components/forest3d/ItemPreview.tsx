// Dükkân ve koleksiyonda bir eşyanın dönen 3D önizlemesi (karakter ve hayvanlar yerinde canlanır).
// three.js büyük olduğundan sayfalar bunu tembel yükler; WebGL yoksa yalnızca simge gösterilir.
import { useAnimations, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Box3, Color, Mesh, MeshStandardMaterial, Vector3, type Group } from 'three';
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
          <Model key={item.id} item={item} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Model 1.6 birim yüksekliğe sığdırılır, ortalanır ve yavaşça döner; kumaş/lamba rengi items.json → tint */
function Model({ item }: { item: Item }) {
  const { scene, animations } = useGLTF(modelUrl(item.model!));
  const obj = useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse((c) => {
      if (!(c instanceof Mesh) || !(c.material instanceof MeshStandardMaterial)) return;
      const color = item.tint?.[c.material.name];
      const glow = item.glow === c.material.name;
      if (!color && !glow) return;
      const m = c.material.clone();
      if (color) m.color = new Color(color);
      if (glow) {
        m.emissive = new Color(color ?? '#ffe7a3');
        m.emissiveIntensity = 0.9;
      }
      c.material = m;
    });
    return o;
  }, [scene, item]);
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
