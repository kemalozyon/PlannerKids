// Eşya kataloğu: mobilya (alt kategorili), ışık, bitki, halı, duvar süsü, zemin/duvar kaplaması, dış mekân
// dekoru, kıyafet (parça parça avatar), canlılar (evcil) ve seri dondurma. Eşyalar yalnızca 💎 Elmasla (çalışarak kazanılır) ya da başarıyla
// (toplam saat, ağaç sayısı, seri, plan, ders altını, seviye) alınır; sandık eşyaları ve canlılar satın alınamaz.
// Tanımlar src/config/items.json'da; sunucu fiyatı ve karo ölçüsünü item_defs tablosundan okur.

import { CFG, ITEM_DEFS, type Behavior, type Dispense, type Fx, type ItemDef, type Sound } from './config';
import type { Currency } from './types';

export type { Behavior, Currency };
export type Category = 'mobilya' | 'isik' | 'bitki' | 'hali' | 'duvarsus' | 'zemin' | 'duvar' | 'dis' | 'kiyafet' | 'evcil' | 'diger';
export type Slot = NonNullable<ItemDef['slot']>;
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
  placement?: 'indoor' | 'outdoor' | 'both' | 'wall';
  tint?: Record<string, string>;
  glow?: string;
  desc?: string;
  color?: string;
  color2?: string;
  stars?: boolean;
  sub?: string;
  /** Ne yapar (config.ts → BEHAVIORS); hiç yoksa boş dizi. Sormak için has() */
  behaviors: Behavior[];
  fx?: Fx;
  capacity?: number;
  dispense?: Dispense;
  anim?: string;
  sound?: Sound;
  palette?: string[];
  art?: string;
  proc?: 'bookcase' | 'swing' | 'fireplace' | 'set';
  piece?: string;
  colors?: string[];
  seat?: number;
  screen?: [number, number, number];
  pattern?: string;
  slot?: Slot;
  style?: string;
  fixed?: boolean;
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
  return { ...rest, behaviors: d.behaviors ?? [], category: d.category as Category, rarity: d.rarity as Rarity, acquire };
}

/** Eşyanın bu davranışı var mı */
export const has = (it: Pick<Item, 'behaviors'> | undefined, b: Behavior): boolean => !!it?.behaviors.includes(b);
/** Karakteri oturtan/yatıran/sallayan davranışı (yoksa null) */
export const poseOf = (it: Pick<Item, 'behaviors'>): 'sit' | 'lie' | 'swing' | null =>
  has(it, 'SIT') ? 'sit' : has(it, 'LAY') ? 'lie' : has(it, 'SWING') ? 'swing' : null;

export const ITEMS: Item[] = ITEM_DEFS.map(toItem);

export const itemById = (id: string): Item | undefined => ITEMS.find((i) => i.id === id);

/** Dükkân ve koleksiyon sekmeleri; Kaplama zemin ve duvarı birlikte gösterir */
export const CATEGORIES: { id: string; name: string; icon: string; cats: Category[] }[] = [
  { id: 'mobilya', name: 'Mobilya', icon: '🛋️', cats: ['mobilya'] },
  { id: 'isik', name: 'Işık', icon: '💡', cats: ['isik'] },
  { id: 'bitki', name: 'Bitki', icon: '🪴', cats: ['bitki'] },
  { id: 'hali', name: 'Halı', icon: '🟥', cats: ['hali'] },
  { id: 'duvarsus', name: 'Duvar süsü', icon: '🖼️', cats: ['duvarsus'] },
  { id: 'kaplama', name: 'Kaplama', icon: '🧱', cats: ['zemin', 'duvar'] },
  { id: 'dis', name: 'Dış mekân', icon: '🌼', cats: ['dis'] },
  { id: 'kiyafet', name: 'Kıyafet', icon: '👕', cats: ['kiyafet'] },
  { id: 'evcil', name: 'Canlılar', icon: '🐾', cats: ['evcil'] },
  { id: 'diger', name: 'Diğer', icon: '🧊', cats: ['diger'] },
];

/** Alt kategorilerin adları (mobilya ve dış mekân), kıyafette parçalar */
export const SUBS: Record<string, string> = {
  oturma: '🪑 Oturma',
  masa: '🍽️ Masa',
  yatak: '🛏️ Yatak odası',
  kitaplik: '📚 Kitaplık',
  mutfak: '🍳 Mutfak',
  banyo: '🛁 Banyo',
  elektronik: '📺 Elektronik',
  oyuncak: '🧸 Oyuncak',
  pura: '🩵 Pura seti',
  mode: '🖤 Mode seti',
  kulube: '🪵 Kulübe seti',
  plasto: '🌈 Plasto ve Area',
  pastel: '🩷 Pastel seti',
  orman: '🌲 Orman seti',
  kraliyet: '👑 Kraliyet seti',
  neon: '🟣 Neon seti',
  depo: '📦 Depolama',
  eglence: '🎮 Eğlence',
  mimari: '🏛️ Mimari',
  su: '⛲ Su',
  hayvan: '🐾 Evcil köşe',
  cit: '🚧 Çit',
  yol: '🪨 Yol',
  cicek: '🌼 Çiçek',
  bostan: '🎃 Bostan',
  doga: '🌳 Doğa',
  kamp: '🔥 Oturma ve kamp',
  heykel: '🗿 Heykel',
  zemin: '🟫 Zemin',
  duvar: '🧱 Duvar',
};

export const SLOTS: { id: Slot; name: string; icon: string; optional: boolean }[] = [
  { id: 'hair', name: 'Saç', icon: '💇', optional: false },
  { id: 'top', name: 'Üst', icon: '👕', optional: false },
  { id: 'bottom', name: 'Alt', icon: '👖', optional: false },
  { id: 'shoes', name: 'Ayakkabı', icon: '👟', optional: false },
  { id: 'hat', name: 'Şapka', icon: '🧢', optional: true },
  { id: 'glasses', name: 'Gözlük', icon: '👓', optional: true },
  { id: 'back', name: 'Sırt', icon: '🎒', optional: true },
];

/** Alt başlığın görünen adı */
export function groupTitle(g: string): string {
  const slot = SLOTS.find((x) => x.id === g);
  if (slot) return `${slot.icon} ${slot.name}`;
  const cat = CATEGORIES.find((c) => c.cats.includes(g as Category));
  return SUBS[g] ?? (cat ? `${cat.icon} ${cat.name}` : g);
}

/** Davranışların dükkânda görünen kısa adları */
const BEHAVIOR_TEXT: Partial<Record<Behavior, (i: Item) => string>> = {
  SIT: () => '🪑 oturulur',
  LAY: () => '🛏️ uzanılır',
  SWING: () => '🎠 sallanılır',
  TOGGLE: (i) => (i.fx === 'fire' ? '🔥 yakılır' : i.fx === 'tv' ? '📺 açılır' : i.fx === 'anim' ? '▶️ çalışır' : '💡 açılıp kapanır'),
  OPEN_CLOSE: () => '🔓 kapağı açılır',
  GATE: () => '🚪 kapı gibi açılıp kapanır',
  WALK_THROUGH: () => '👣 üstünden yürünür',
  STACKABLE: () => '🍽️ üstüne eşya konur',
  ON_SURFACE: () => '💻 masaya konabilir',
  STORAGE: (i) => `📦 içine ${i.capacity ?? 0} eşya sığar`,
  DISPENSE: () => '🎁 eline ikram verir',
  PLAY_ANIMATION: () => '✨ hareket eder',
  PLAY_SOUND: () => '🎵 çalınır',
  CHANGE_COLOR: (i) => `🎨 ${i.palette?.length ?? 0} renk`,
  INTERACT_PET: () => '🐾 canlılar yanına gelir',
  BOOKS: () => '📚 kitapların dizilir',
};

/** Eşya ne yapar (dükkân): "oturulur · açılıp kapanır" */
export const behaviorText = (i: Item): string => i.behaviors.map((b) => BEHAVIOR_TEXT[b]?.(i)).filter(Boolean).join(' · ');

/** Eşyanın gruplandığı alt başlık (yoksa kategori) */
export const groupOf = (i: Item): string => i.sub ?? (i.category === 'zemin' || i.category === 'duvar' ? i.category : i.slot ?? i.category);

export const RARITY: Record<Rarity, { name: string; color: string }> = {
  yaygin: { name: 'Yaygın', color: '#7a8b99' },
  nadir: { name: 'Nadir', color: '#3a7bd5' },
  efsanevi: { name: 'Efsanevi', color: '#c27a00' },
};

/** Dondurma en fazla bu kadar birikir */
export const FREEZE_MAX = CFG.freeze.max;
/** Seviyeye göre aynı anda gelen arkadaş hayvan sayısı (Bahçıvan'dan sonra 2) */
export const companionSlots = (level: number) => (level >= 3 ? 2 : 1);
/** Odaya, duvara ya da bahçeye yerleştirilebilen eşyalar */
export const placeable = (i: Item) => !!i.placement;
/** Duvara asılan eşya */
export const onWall = (i: Item) => i.placement === 'wall';
/** Odanın zemin/duvar kaplaması */
export const covering = (i: Item) => i.category === 'zemin' || i.category === 'duvar';
