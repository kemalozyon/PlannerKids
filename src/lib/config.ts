// Oyun ekonomisinin tek kaynağı: src/config/economy.json ve src/config/items.json.
// Sunucu aynı değerleri economy_config / item_defs tablolarından okur; tablolar `npm run config:sql`
// ile üretilen migration'la doldurulur (logic.test.ts son üretilen migration'ın JSON'larla aynı olduğunu denetler).
import economy from '../config/economy.json' with { type: 'json' };
import items from '../config/items.json' with { type: 'json' };

export interface StudyTier {
  /** Günün bu dakikasına kadar */
  upTo: number;
  /** Bu kadar dakikaya 1 💎 */
  minutesPer: number;
}

export interface QuestConfig {
  id: string;
  scope: 'day' | 'week';
  title: string;
  icon: string;
  target: number;
  reward: number;
}

export interface EconomyConfig {
  session: {
    /** Sayaç açıkken sunucuya "buradayım" aralığı */
    beatSeconds: number;
    /** Son "buradayım"dan sonra bu kadar saniye daha sayılır; sonra seans kendiliğinden durur */
    graceSeconds: number;
    /** Bu kadar dakika dokunulmazsa "Hâlâ çalışıyor musun?" */
    idleMinutes: number;
    idleAnswerSeconds: number;
    /** Bir seans en fazla bu kadar dakika sayılır */
    maxMinutes: number;
    noteMin: number;
    noteMax: number;
    /** Bu kadar dakikadan sonra yarıda bırakılan seans kuru ağaç olur */
    wiltMinutes: number;
  };
  elmas: {
    study: { tiers: StudyTier[]; dailyCap: number };
    streak: { minMinutes: number; tiers: { days: number; bonus: number }[] };
    reflection: { bonus: number; minNote: number };
    plan: number;
    book: { bonus: number; perWeek: number };
    giftMax: number;
    quests: QuestConfig[];
  };
  chest: { days: number; minutes: number };
  freeze: { max: number; coverDays: number };
  stars: { perDay: number };
  levelHours: number[];
  skillTierMinutes: number[];
  world: WorldConfig;
}

/**
 * Bir alandaki sabit karo: kapı (yürünür, eşya konmaz), bahçe kapısı (ağaç bahçelerine), ev, su, köprü, tepe,
 * koru, kütüphanenin gömme rafları, pencere (duvarda: arka duvar y = -1, sol duvar x = -1), aylık bahçede ekim yeri.
 * Kapı ve bahçe kapısının `edge`'i, dünyada komşu alana açıldığı kenardır (worldPlan.ts → links).
 */
export interface FixedTile {
  kind: 'door' | 'gate' | 'house' | 'water' | 'bridge' | 'hill' | 'grove' | 'shelf' | 'window' | 'plot';
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Kapının götürdüğü yer */
  to?: 'room' | 'library' | 'garden' | 'forest' | RoomId;
  /** Kapının açıldığı kenar: n kuzey (y−1), s güney (y+1), e doğu (x+1), w batı (x−1) */
  edge?: 'n' | 's' | 'e' | 'w';
  /** Ekim yerinin günü (aylık bahçe) */
  day?: number;
}

/** Ay bahçesi: m:YYYY-MM */
export type MonthSpace = `m:${string}`;
/** Seriyle açılan odalar (evin doğusunda, odadan sonra sırayla) */
export type RoomId = 'kitchen' | 'bedroom' | 'bath' | 'playroom';
/** Evin alanları (haritaya göre), seriyle açılan odalar ve aylık ağaç bahçeleri */
export type SpaceId = 'room' | 'library' | 'garden' | RoomId | MonthSpace;
export type HomeSpace = 'room' | 'library' | 'garden' | RoomId;

/**
 * Seriyle açılan oda: en iyi seri `streak` güne ulaşınca bir kez açılır, kalıcıdır. Derinliği haritanın odasıyla
 * aynı (aşamayla güneye büyür), eni sabit. floor/wall: kaplama seçilmemişken görünen (sahip olmak gerekmez).
 */
export interface RoomDef {
  id: RoomId;
  name: string;
  icon: string;
  streak: number;
  w: number;
  floor: string;
  wall: string;
  desc: string;
  fixed: FixedTile[];
}

export interface SpaceDef {
  w: number;
  h: number;
  fixed: FixedTile[];
}

/**
 * Arazinin büyüme aşaması: toplam (güvenilir) çalışma saatiyle kendiliğinden açılır; ev ve bahçe aynı yerde
 * büyür (yalnızca doğuya ve güneye), yeni özellikler (dere, tepe, göl, deniz) yalnızca yeni açılan karolarda.
 */
export interface MapDef {
  id: string;
  name: string;
  icon: string;
  hours: number;
  desc: string;
  theme: { scenery: 'meadow' | 'lake' | 'forest' | 'mountain' | 'beach'; ground: string; side: string; wall: string; roof: string; floors: number };
  room: SpaceDef;
  library: SpaceDef;
  garden: SpaceDef;
}

/** Ağacın büyüklüğü: günün toplam dakikasına göre */
export interface StageDef {
  id: string;
  name: string;
  /** {s}: tür adı küçük harfle, {S}: büyük harfle */
  label: string;
  icon?: string;
  min: number;
  scale: number;
}

/** Ağaç türü: tarihten seçilir; months verilmişse o aylarda daha sık çıkar */
export interface SpeciesDef {
  id: string;
  name: string;
  icon: string;
  model: string;
  leaf: string;
  wood?: string;
  fruit?: string;
  months?: number[];
}

export interface WorldConfig {
  maps: MapDef[];
  rooms: RoomDef[];
  /** Kitaplık görünümünde (ShelfView) raf başına kitap */
  library: { perShelf: number };
  season: { from: string; to: string };
  monthGarden: { w: number; h: number; x0: number; y0: number; step: number; gate: { x: number; y: number } };
  stages: StageDef[];
  glowMinutes: number;
  species: SpeciesDef[];
  dry: Omit<SpeciesDef, 'months' | 'fruit'>;
  creatures: { id: string; name: string; icon: string; trees: number; model?: string; fly?: boolean }[];
}

/**
 * Eşya davranışları (birleştirilebilir; her yeni eşya için kod yazılmaz, items.json'da seçilir):
 * SIT/LAY/SWING poz · TOGGLE aç-kapa (fx: ne açılır) · OPEN_CLOSE kapak · GATE kapalıyken geçilmez · WALK_THROUGH
 * zemin katmanı, üstünden yürünür · STACKABLE üstüne küçük eşya konur · ON_SURFACE yüzeye konabilir · STORAGE içine
 * eşya konur · DISPENSE eline bir şey verir · PLAY_ANIMATION hareketli · PLAY_SOUND melodi · CHANGE_COLOR renk ·
 * INTERACT_PET canlılar toplanır · BOOKS kitaplık rafları. Yürümeyi engellemek varsayılandır.
 */
export const BEHAVIORS = [
  'SIT',
  'LAY',
  'SWING',
  'TOGGLE',
  'OPEN_CLOSE',
  'GATE',
  'WALK_THROUGH',
  'STACKABLE',
  'ON_SURFACE',
  'STORAGE',
  'DISPENSE',
  'PLAY_ANIMATION',
  'PLAY_SOUND',
  'CHANGE_COLOR',
  'INTERACT_PET',
  'BOOKS',
] as const;
export type Behavior = (typeof BEHAVIORS)[number];
/** TOGGLE açılınca ne olur: ışık saçar, TV ekranı, ateş yanar, hareket (anim) */
export type Fx = 'light' | 'tv' | 'fire' | 'anim';
/** DISPENSE: karakterin eline verilen */
export const DISPENSE = ['kahve', 'dondurma', 'meyve-suyu', 'patlamis-misir', 'kurabiye', 'su'] as const;
export type Dispense = (typeof DISPENSE)[number];
/** PLAY_SOUND: çalınan melodi */
export const SOUNDS = ['piyano', 'muzik-kutusu', 'davul', 'zil', 'gitar'] as const;
export type Sound = (typeof SOUNDS)[number];

/** items.json'daki ham eşya tanımı */
export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  category: string;
  rarity: string;
  /** Elmas fiyatı (satılıyorsa) */
  price?: number;
  /** Başarıyla açılır */
  unlock?: { by: string; target: number };
  /** Yalnızca haftalık sandıktan */
  chest?: boolean;
  repeat?: boolean;
  model?: string;
  scale?: number;
  r?: number;
  fly?: boolean;
  pitch?: number;
  /** Karo ölçüsü ve yerleşim (yerleştirilebilen eşyalar) */
  w?: number;
  h?: number;
  rotations?: number[];
  placement?: 'indoor' | 'outdoor' | 'both' | 'wall';
  /** Malzeme adı → renk (ör. koltuğun kumaşı) */
  tint?: Record<string, string>;
  /** Bu malzeme ışık saçar (lamba) */
  glow?: string;
  /** Alt kategori (dükkân ve envanter) */
  sub?: string;
  /** Ne yapar (bkz. BEHAVIORS) ve davranışların ayarları */
  behaviors?: Behavior[];
  fx?: Fx;
  /** STORAGE: içine konabilecek eşya sayısı */
  capacity?: number;
  dispense?: Dispense;
  /** PLAY_ANIMATION: parçanın hareketi (Sets.tsx) */
  anim?: string;
  sound?: Sound;
  /** CHANGE_COLOR: sırayla geçilen renkler (ilki varsayılan) */
  palette?: string[];
  /** Kodla çizilen resim (duvar süsü) */
  art?: string;
  /** Kodla çizilen eşya (kitaplık, salıncak, şömine; set: Habbo tarzı set parçası, bkz. world3d/Sets.tsx) */
  proc?: 'bookcase' | 'swing' | 'fireplace' | 'set';
  /** Set parçasının biçimi (sofa, chair, table, fridge…) ve renkleri [ana, ikinci, üçüncü] */
  piece?: string;
  colors?: string[];
  /** Oturma/yatma yüksekliği (birim) */
  seat?: number;
  /** TV ekranı: modelin genişliğine, yüksekliğine ve orta yüksekliğine oran */
  screen?: [number, number, number];
  /** Zemin/duvar deseni */
  pattern?: string;
  /** Avatar parçası */
  slot?: 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'glasses' | 'back';
  style?: string;
  /** Rengi değişmeyen parça */
  fixed?: boolean;
  desc?: string;
  /** Zemin/duvar kaplamasının rengi */
  color?: string;
  color2?: string;
  stars?: boolean;
}

export const CFG = economy as EconomyConfig;
export const ITEM_DEFS = items.items as ItemDef[];
