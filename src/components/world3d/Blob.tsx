// Yumuşak "leke" gölgeler: karakterin, hayvanların ve eşyaların altında koyu, kenarı eriyen bir daire. Güneş gölgesi
// kapalıyken bile (düşük kalite) her şey zemine oturur; açıkken temas gölgesi gibi hafif kalır. Eşyalarınki bir alan
// için tek bir instanced mesh (tek çizim).
import { useLayoutEffect, useMemo, useRef } from 'react';
import { CanvasTexture, Object3D, SRGBColorSpace, type InstancedMesh } from 'three';
import { has, itemById } from '../../lib/catalog';
import { footSize, supportOf, type SpaceLayout } from '../../lib/world';
import { useQuality } from './gfx';

let tex: CanvasTexture | null = null;
function blobTexture() {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Tek leke (karakter, hayvan); `y` zeminden yükseklik */
export function Blob({ size = 0.7, opacity, y = 0.018 }: { size?: number; opacity?: number; y?: number }) {
  const q = useQuality();
  return (
    <mesh position-y={y} rotation-x={-Math.PI / 2} renderOrder={1}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={blobTexture()} transparent opacity={opacity ?? (q === 'dusuk' ? 0.42 : 0.24)} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

const tmp = new Object3D();

/** Bir alanın yerdeki eşyalarının lekeleri (halı/yol, duvar ve masa üstü eşyaları hariç) */
export function ItemBlobs({ layout }: { layout: SpaceLayout }) {
  const q = useQuality();
  const ref = useRef<InstancedMesh>(null);
  const spots = useMemo(
    () =>
      layout.items.flatMap((it, i) => {
        const item = itemById(it.item);
        if (!item || item.placement === 'wall' || has(item, 'WALK_THROUGH') || supportOf(layout, it, i) != null) return [];
        const [w, h] = footSize(item, it.rot);
        return [{ x: it.x + w / 2, z: it.y + h / 2, w: w * 1.15, h: h * 1.15 }];
      }),
    [layout],
  );
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    spots.forEach((s, i) => {
      tmp.position.set(s.x, 0.016, s.z);
      tmp.rotation.set(-Math.PI / 2, 0, 0);
      tmp.scale.set(s.w, s.h, 1);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.count = spots.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [spots]);
  if (!spots.length) return null;
  // Kapasite 64'ün katı: eşya eklendikçe her seferinde yeniden kurulmasın
  const cap = Math.ceil(spots.length / 64) * 64;
  return (
    <instancedMesh key={cap} ref={ref} args={[undefined, undefined, cap]} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={blobTexture()} transparent opacity={q === 'dusuk' ? 0.4 : 0.22} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </instancedMesh>
  );
}
