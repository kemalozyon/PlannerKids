// Karakterin başına takılan aksesuar: gözlük (Mini Characters modeli) ya da kodla çizilen Efsane tacı.
// Hem gezinti (Explore) hem dünyadaki avatar kullanır.
import { useEffect, useMemo } from 'react';
import { Color, ExtrudeGeometry, Mesh, MeshBasicMaterial, Object3D, Shape } from 'three';
import type { Item } from '../../lib/catalog';
import { useModel } from './models';

/** Aksesuar karakterin başına (head kemiği) takılır; başla birlikte sallanır. */
export function Accessory({ item, body }: { item: Item; body: Object3D }) {
  const head = useMemo(() => body.getObjectByName('head') ?? body, [body]);
  const glasses = item.model ? <GlassesOn head={head} model={item.model} /> : null;
  return glasses ?? <Crown head={head} />;
}

// Mini Characters'ta head kemiği başın altında: baş 0.38 yukarı uzanır, yüzün önü z ≈ 0.21
function GlassesOn({ head, model }: { head: Object3D; model: string }) {
  const obj = useModel(model);
  useEffect(() => {
    obj.position.set(0, 0.13, 0.15);
    head.add(obj);
    return () => {
      head.remove(obj);
    };
  }, [head, obj]);
  return null;
}

/** Efsane tacı: altın halka ve sivri uçlar */
function Crown({ head }: { head: Object3D }) {
  const crown = useMemo(() => {
    const g = new Object3D();
    const gold = new MeshBasicMaterial({ color: new Color('#ffcc33') });
    const ring = new Mesh(new ExtrudeGeometry(ringShape(), { depth: 0.06, bevelEnabled: false }), gold);
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new Mesh(new ExtrudeGeometry(spikeShape(), { depth: 0.02, bevelEnabled: false }), gold);
      spike.position.set(Math.cos(a) * 0.145, 0.06, Math.sin(a) * 0.145);
      spike.rotation.y = -a + Math.PI / 2;
      g.add(spike);
    }
    g.position.y = 0.37;
    return g;
  }, []);
  useEffect(() => {
    head.add(crown);
    return () => {
      head.remove(crown);
    };
  }, [head, crown]);
  return null;
}

function ringShape() {
  const s = new Shape();
  s.absarc(0, 0, 0.16, 0, Math.PI * 2, false);
  const hole = new Shape();
  hole.absarc(0, 0, 0.13, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

function spikeShape() {
  const s = new Shape();
  s.moveTo(-0.04, 0);
  s.lineTo(0, 0.09);
  s.lineTo(0.04, 0);
  s.closePath();
  return s;
}
