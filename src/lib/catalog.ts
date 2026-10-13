// Eşya kataloğu: karakterler, aksesuarlar, evcil hayvanlar, ada yapıları, süsler.
// Eşyalar yalnızca 💎 Elmasla (çalışarak kazanılır) ya da başarıyla (seri, plan, ders altını, seviye) alınır;
// sandık eşyaları satın alınamaz. Tanımlar src/config/items.json'da; sunucu fiyatı item_defs tablosundan okur.

import { CFG, ITEM_DEFS, type ItemDef } from './config';
import type { Currency } from './types';

export type { Currency };
export type Category = 'karakter' | 'aksesuar' | 'evcil' | 'yapi' | 'sus' | 'diger';
export type Rarity = 'yaygin' | 'nadir' | 'efsanevi';
/** streak: en iyi seri (gün) · plans: tamamlanan planlı gün · gold: altın seviyedeki ders sayısı · level: seviye sırası */
export type UnlockKind = 'streak' | 'plans' | 'gold' | 'level';

export type Acquire =
  | { kind: 'free' }
  | { kind: 'buy'; currency: Currency; price: number }
  | { kind: 'unlock'; by: UnlockKind; target: number }
  | { kind: 'chest' };

export interface Item {
  id: string;
  name: string;
  icon: string;
  category: Category;
  rarity: Rarity;
  acquire: Acquire;
  /** 3D model adı (models.ts) */
  model?: string;
  /** Adadaki ölçek */
  scale?: number;
  /** Adada kapladığı yer (yarıçap); yerleştirme ve çarpışma için */
  r?: number;
  /** Üzerinden yürünebilir (yol, platform): çarpışmaya girmez */
  walk?: boolean;
  /** Uçan hayvan */
  fly?: boolean;
  /** Hayvanın sesi (perde) */
  pitch?: number;
  /** Aynı eşyadan birden fazla alınabilir (yapılar, süsler) */
  repeat?: boolean;
}

/** items.json satırını uygulamanın kullandığı biçime çevirir (fiyat → satın alma, unlock → başarı, chest → sandık) */
function toItem(d: ItemDef): Item {
  const acquire: Acquire =
    d.price != null
      ? { kind: 'buy', currency: 'crystal', price: d.price }
      : d.unlock
        ? { kind: 'unlock', by: d.unlock.by as UnlockKind, target: d.unlock.target }
        : d.chest
          ? { kind: 'chest' }
          : { kind: 'free' };
  const { price: _p, unlock: _u, chest: _c, ...rest } = d;
  return { ...rest, category: d.category as Category, rarity: d.rarity as Rarity, acquire };
}

export const ITEMS: Item[] = ITEM_DEFS.map(toItem);

export const itemById = (id: string): Item | undefined => ITEMS.find((i) => i.id === id);

export const CATEGORIES: { id: Category; name: string; icon: string }[] = [
  { id: 'karakter', name: 'Karakter', icon: '🧒' },
  { id: 'aksesuar', name: 'Aksesuar', icon: '👓' },
  { id: 'evcil', name: 'Evcil', icon: '🐾' },
  { id: 'yapi', name: 'Yapı', icon: '⛺' },
  { id: 'sus', name: 'Süs', icon: '🌼' },
  { id: 'diger', name: 'Diğer', icon: '🧊' },
];

export const RARITY: Record<Rarity, { name: string; color: string }> = {
  yaygin: { name: 'Yaygın', color: '#7a8b99' },
  nadir: { name: 'Nadir', color: '#3a7bd5' },
  efsanevi: { name: 'Efsanevi', color: '#c27a00' },
};

/** Dondurma en fazla bu kadar birikir */
export const FREEZE_MAX = CFG.freeze.max;
/** Seviyeye göre aynı anda gelen arkadaş hayvan sayısı (Bahçıvan'dan sonra 2) */
export const companionSlots = (level: number) => (level >= 3 ? 2 : 1);
/** Yerleştirilebilen eşyalar */
export const placeable = (i: Item) => i.category === 'yapi' || i.category === 'sus';
