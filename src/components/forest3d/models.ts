// 3D model tablosu: Kenney Nature Kit + Furniture Kit + Cube Pets + Mini Characters (CC0, bkz. ASSETS_LICENSES.md).
// Modeller küçük (.glb); Vite her birine URL verir, tek dosyalık demo derlemesinde içine gömülür.
import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import { Color, Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';

const nature = import.meta.glob('../../assets/models/nature/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const pets = import.meta.glob('../../assets/models/pets/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const characters = import.meta.glob('../../assets/models/characters/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const accessories = import.meta.glob('../../assets/models/accessories/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const furniture = import.meta.glob('../../assets/models/furniture/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byName = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.glb', ''), url]));
const NATURE = byName(nature);
const PETS = byName(pets);
/** Gezinti karakterleri (Kenney Mini Characters): idle, walk, sprint, jump, fall, emote-yes… animasyonlu */
const CHARACTERS = byName(characters);
const ACCESSORIES = byName(accessories);
/** Kenney Furniture Kit (meshopt) */
const FURNITURE = byName(furniture);
/** Herhangi bir modelin adresi (doğa, hayvan, karakter, aksesuar, mobilya) */
export const modelUrl = (name: string): string => NATURE[name] ?? PETS[name] ?? CHARACTERS[name] ?? ACCESSORIES[name] ?? FURNITURE[name];

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
  const url = modelUrl(name);
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
