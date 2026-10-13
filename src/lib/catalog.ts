// Eşya kataloğu: mobilya, ışık, bitki, zemin, duvar, dış mekân dekoru, kıyafet (karakter ve aksesuar),
// canlılar (evcil) ve seri dondurma. Eşyalar yalnızca 💎 Elmasla (çalışarak kazanılır) ya da başarıyla
// (toplam saat, ağaç sayısı, seri, plan, ders altını, seviye) alınır; sandık eşyaları ve canlılar satın alınamaz.
// Tanımlar src/config/items.json'da; sunucu fiyatı ve karo ölçüsünü item_defs tablosundan okur.

import { CFG, ITEM_DEFS, type ItemDef } from './config';
import type { Currency } from './types';

export type { Currency };
export type Category = 'mobilya' | 'zemin' | 'duvar' | 'bitki' | 'isik' | 'dis' | 'karakter' | 'aksesuar' | 'evcil' | 'diger';
export type Rarity = 'yaygin' | 'nadir' | 'efsanevi';
/** streak: en iyi seri (gün) · plans: tamamlanan planlı gün · gold: altın seviyedeki ders sayısı · level: seviye sırası ·
 *  hours: toplam çalışma saati · trees: dikilen ağaç sayısı */
export type UnlockKind = 'streak' | 'plans' | 'gold' | 'level' | 'hours' | 'trees';

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
  /** Aynı eşyadan birden fazla alınabilir (mobilya, süsler) */
  repeat?: boolean;
  /** Karo ölçüsü (w × h), izinli dönüşler, iç/dış mekân */
  w?: number;
  h?: number;
  rotations?: number[];
  placement?: 'indoor' | 'outdoor' | 'both';
  tint?: Record<string, string>;
  glow?: string;
  opens?: 'shelf';
  desc?: string;
  color?: string;
  color2?: string;
  stars?: boolean;
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

/** Dükkân ve koleksiyon sekmeleri; Kıyafet karakter ve aksesuarı birlikte gösterir */
export const CATEGORIES: { id: string; name: string; icon: string; cats: Category[] }[] = [
  { id: 'mobilya', name: 'Mobilya', icon: '🛋️', cats: ['mobilya'] },
  { id: 'zemin', name: 'Zemin', icon: '🟫', cats: ['zemin'] },
  { id: 'duvar', name: 'Duvar', icon: '🧱', cats: ['duvar'] },
  { id: 'bitki', name: 'Bitki', icon: '🪴', cats: ['bitki'] },
  { id: 'isik', name: 'Işık', icon: '💡', cats: ['isik'] },
  { id: 'dis', name: 'Dış mekân', icon: '🌼', cats: ['dis'] },
  { id: 'kiyafet', name: 'Kıyafet', icon: '👕', cats: ['karakter', 'aksesuar'] },
  { id: 'evcil', name: 'Canlılar', icon: '🐾', cats: ['evcil'] },
  { id: 'diger', name: 'Diğer', icon: '🧊', cats: ['diger'] },
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
/** Odaya ya da bahçeye yerleştirilebilen eşyalar */
export const placeable = (i: Item) => !!i.placement;
/** Odanın zemin/duvar kaplaması */
export const covering = (i: Item) => i.category === 'zemin' || i.category === 'duvar';
