// 3D model tablosu: Kenney Nature Kit + Cube Pets (CC0, bkz. src/assets/models/LICENSE.md).
// Modeller küçük (.glb); Vite her birine URL verir, tek dosyalık demo derlemesinde içine gömülür.
import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import { Color, Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';

const nature = import.meta.glob('../../assets/models/nature/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const pets = import.meta.glob('../../assets/models/pets/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byName = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.glb', ''), url]));
export const NATURE = byName(nature);
export const PETS = byName(pets);

/** Bir türün 3D görünüşü. models: küçük / büyük / dev ağaç evrelerindeki model. */
interface Look {
  models: [string, string, string];
  leaf: string;
  /** Model boyu farklıysa evre ölçeklerine çarpan */
  k?: number;
  glow?: boolean;
}

export const LOOKS: Record<string, Look> = {
  elma: { models: ['tree_default', 'tree_default', 'tree_detailed'], leaf: '#5fc35a' },
  cam: { models: ['tree_pineRoundA', 'tree_pineRoundA', 'tree_pineTallA_detailed'], leaf: '#2f9d63' },
  kiraz: { models: ['tree_fat', 'tree_fat', 'tree_oak'], leaf: '#f6a5c6' },
  palmiye: { models: ['tree_palmShort', 'tree_palmShort', 'tree_palmDetailedTall'], leaf: '#55c46b' },
  akcaagac: { models: ['tree_oak', 'tree_oak', 'tree_default'], leaf: '#e8573c' },
  kaktus: { models: ['cactus_short', 'cactus_tall', 'cactus_tall'], leaf: '#43b05c', k: 1.7 },
  sogut: { models: ['tree_thin', 'tree_thin', 'tree_tall'], leaf: '#8fd9a8' },
  sihirli: { models: ['tree_plateau', 'tree_plateau', 'tree_blocks'], leaf: '#b47cff', glow: true },
};

/** Evreye göre model ve ölçek. 0 tohum (filiz), 1 çiçek, 2–4 ağaç. */
export function treeModel(species: string, stage: number, bloom: string): { name: string; scale: number; colors: Recolor } {
  const look = LOOKS[species] ?? LOOKS.elma;
  if (stage === 0) return { name: 'crops_leafsStageA', scale: 3, colors: { leaf: look.leaf, grass: look.leaf } };
  if (stage === 1) return { name: 'flower_redA', scale: 5.5, colors: { flower: bloom, grass: '#4fae4c' } };
  const k = look.k ?? 1;
  return { name: look.models[stage - 2], scale: [0.95, 1.25, 1.6][stage - 2] * k, colors: { leaf: look.leaf, glow: look.glow } };
}

export interface Recolor {
  /** Yaprak (leafs*) */
  leaf?: string;
  /** Çimen/sap (grass) */
  grass?: string;
  /** Çiçek taç yaprağı (colorRed vb.) */
  flower?: string;
  /** Gövde (woodBark*) */
  wood?: string;
  /** Yapraklar hafifçe parlasın (sihirli ağaç) */
  glow?: boolean;
}

/** Kenney'in turkuaz paletini daha sıcak, çocuksu renklere çevirir. */
const DEFAULTS = { grass: '#6cc24a', wood: '#9a6a43', dirt: '#b0794a' };

function recolorMaterial(m: Material, c: Recolor): Material {
  if (!(m instanceof MeshStandardMaterial)) return m;
  const name = m.name.toLowerCase();
  const pick = name.startsWith('leaf')
    ? c.leaf
    : name === 'grass'
      ? (c.grass ?? DEFAULTS.grass)
      : name.startsWith('wood')
        ? (c.wood ?? DEFAULTS.wood)
        : name === 'dirt'
          ? DEFAULTS.dirt
          : name.startsWith('color')
            ? c.flower
            : undefined;
  if (!pick) return m;
  const out = m.clone();
  out.color = new Color(pick);
  out.flatShading = true;
  if (c.glow && name.startsWith('leaf')) {
    out.emissive = new Color(pick);
    out.emissiveIntensity = 0.35;
  }
  return out;
}

/** Yüklenen modelin boyanmış, gölgeli bir kopyası. Aynı model+renk için bir kez hazırlanır. */
const cache = new Map<string, Object3D>();
export function useModel(name: string, colors: Recolor = {}): Object3D {
  const url = NATURE[name] ?? PETS[name];
  const { scene } = useGLTF(url);
  const key = `${name}|${JSON.stringify(colors)}`;
  const template = useMemo(() => {
    let t = cache.get(key);
    if (!t) {
      t = scene.clone(true);
      t.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.material = Array.isArray(o.material) ? o.material.map((m) => recolorMaterial(m, colors)) : recolorMaterial(o.material, colors);
        }
      });
      cache.set(key, t);
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, key]);
  return useMemo(() => template.clone(true), [template]);
}

/** Sahnede kullanılan doğa modellerini önceden yükle (ilk dikimde takılma olmasın). */
export function preloadNature() {
  Object.values(NATURE).forEach((u) => useGLTF.preload(u));
}
