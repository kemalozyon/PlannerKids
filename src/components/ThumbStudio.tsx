// Eşya küçük resimlerini çizen gizli 3D sahne (lib/thumbs.ts sırasından). Tek bir WebGL bağlamı: eşyalar sırayla
// sahneye konur, dünyadaki izometrik açıdan (Habbo kataloğundaki gibi 3/4 bakış) bir kez çizilir ve PNG'ye
// çevrilir. Model yüklenemezse eşya emojiyle kalır.
import { useGLTF } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Box3, OrthographicCamera, Vector3, type Group } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DEFAULT_LOOK, wear } from '../lib/avatar';
import { itemById, type Item } from '../lib/catalog';
import { thumbDone, useThumbHead } from '../lib/thumbs';
import AvatarModel from './avatar/AvatarModel';
import { modelUrl } from './forest3d/models';
import { patternTexture } from './world3d/art';
import { ItemModel } from './world3d/items';

const SIZE = 160;
/** Dünyadaki kamerayla aynı yön (WorldView: hedef + (18, 20, 18)) */
const DIR = new Vector3(18, 20, 18).normalize();
/** Kıyafette parçanın olduğu bölge (avatar boyunun alt–üst oranı); sırt çantası arkadan */
const CROP: Partial<Record<string, [number, number]>> = { hair: [0.55, 1], hat: [0.6, 1.05], glasses: [0.6, 0.92], top: [0.3, 0.72], bottom: [0.05, 0.5], shoes: [0, 0.22] };

export default function ThumbStudio() {
  const id = useThumbHead();
  const item = id ? itemById(id) : undefined;
  useEffect(() => {
    if (id && !item) thumbDone(id, null);
  }, [id, item]);
  return (
    <div className="thumb-studio" aria-hidden>
      <Canvas frameloop="never" dpr={1} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: SIZE, height: SIZE }}>
        <hemisphereLight args={['#ffffff', '#8a7a60', 1.35]} />
        <directionalLight position={[4, 8, 6]} intensity={2.2} />
        {item && (
          <Guard key={item.id} id={item.id}>
            <Suspense fallback={null}>
              <Shot item={item} />
            </Suspense>
          </Guard>
        )}
      </Canvas>
    </div>
  );
}

/** Model yüklenemezse sıra tıkanmasın */
class Guard extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    thumbDone(this.props.id, null);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Eşyayı sahneye koyar; yerleşince kadraja sığdırıp bir kez çizer */
function Shot({ item }: { item: Item }) {
  const group = useRef<Group>(null);
  const { gl, scene } = useThree();
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      // Dokular bir kare gecikebilir: iki kare bekle
      raf = requestAnimationFrame(() => {
        const g = group.current;
        if (!g) return thumbDone(item.id, null);
        const box = new Box3().setFromObject(g);
        if (box.isEmpty()) return thumbDone(item.id, null);
        const crop = item.slot ? CROP[item.slot] : undefined;
        if (crop) {
          const [y0, y1] = [box.min.y, box.max.y];
          box.min.y = y0 + (y1 - y0) * crop[0];
          box.max.y = y0 + (y1 - y0) * crop[1];
        }
        const center = box.getCenter(new Vector3());
        const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
        const dir = item.slot === 'back' ? new Vector3(-DIR.x, DIR.y, -DIR.z) : DIR;
        cam.position.copy(center).addScaledVector(dir, 30);
        cam.lookAt(center);
        cam.updateMatrixWorld();
        // Kutunun köşeleri kamera uzayında: en geniş yarı boyut kadraj olur
        let m = 0.01;
        for (let i = 0; i < 8; i++) {
          const c = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
          m = Math.max(m, Math.abs(c.x), Math.abs(c.y));
        }
        m *= 1.08;
        Object.assign(cam, { left: -m, right: m, top: m, bottom: -m });
        cam.updateProjectionMatrix();
        gl.setClearColor(0x000000, 0);
        gl.render(scene, cam);
        thumbDone(item.id, gl.domElement.toDataURL('image/png'));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [gl, scene, item.id]);
  return (
    <group ref={group}>
      <Body item={item} />
    </group>
  );
}

function Body({ item }: { item: Item }) {
  if (item.category === 'kiyafet') return <AvatarModel look={wear(DEFAULT_LOOK, item)} />;
  if (item.category === 'zemin' || item.category === 'duvar') return <Covering item={item} />;
  if (item.category === 'evcil' && item.model) return <Pet item={item} />;
  return <ItemModel item={item} x={0} y={item.placement === 'wall' ? -1 : 0} rot={0} />;
}

/** Zemin ve duvar kaplaması: küçük bir köşe (iki karo zemin + arka duvar parçası) */
function Covering({ item }: { item: Item }) {
  const floor = item.category === 'zemin';
  const c1 = item.color ?? '#e9dcc3';
  const c2 = item.color2 ?? c1;
  const map = useMemo(() => {
    const t = floor
      ? patternTexture(item.pattern ?? (item.color2 ? 'checker' : 'plain'), c1, c2, 'floor').clone()
      : patternTexture(item.pattern ?? (item.stars ? 'stars' : 'plain'), c1, c2, 'wall').clone();
    t.repeat.set(floor && !item.pattern ? 1 : 2, floor && !item.pattern ? 1 : floor ? 2 : 1);
    t.needsUpdate = true;
    return t;
  }, [item, floor, c1, c2]);
  return floor ? (
    <mesh position={[0, -0.05, 0]}>
      <boxGeometry args={[2, 0.1, 2]} />
      <meshStandardMaterial attach="material-2" map={map} />
      <meshStandardMaterial attach="material-0" color="#b49a74" />
      <meshStandardMaterial attach="material-1" color="#b49a74" />
      <meshStandardMaterial attach="material-3" color="#b49a74" />
      <meshStandardMaterial attach="material-4" color="#b49a74" />
      <meshStandardMaterial attach="material-5" color="#b49a74" />
    </mesh>
  ) : (
    <group>
      <mesh position={[0, 1.3, 0]}>
        <boxGeometry args={[2, 2.6, 0.08]} />
        <meshStandardMaterial map={map} />
      </mesh>
      <mesh position={[0, 0, 0.5]}>
        <boxGeometry args={[2, 0.06, 1]} />
        <meshStandardMaterial color="#d9c6a3" />
      </mesh>
    </group>
  );
}

/** Hayvan modeli (iskeletli olabilir, kopyası ayrı iskeletle) */
function Pet({ item }: { item: Item }) {
  const { scene } = useGLTF(modelUrl(item.model!));
  const obj = useMemo(() => cloneSkinned(scene), [scene]);
  return <primitive object={obj} />;
}
