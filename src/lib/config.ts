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

/** Bir alandaki sabit karo: kapı (yürünür, eşya konmaz), ev, su, köprü, tepe, koru */
export interface FixedTile {
  kind: 'door' | 'house' | 'water' | 'bridge' | 'hill' | 'grove';
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Kapının götürdüğü alan */
  to?: SpaceId;
  /** Bu kadar kitap bitince açılır (kütüphane kapısı) */
  books?: number;
  /** Bahçede bu arazi açılınca görünür */
  land?: string;
}

export type SpaceId = 'room' | 'library' | 'garden';

export interface Land {
  id: string;
  name: string;
  icon: string;
  hours: number;
  w: number;
  h: number;
  desc: string;
}

export interface WorldConfig {
  room: { w: number; h: number; fixed: FixedTile[] };
  library: { w: number; h: number; books: number; fixed: FixedTile[] };
  garden: { lands: Land[]; fixed: FixedTile[]; pathRow: number };
  region: { min: number; max: number; tilesPerTree: number };
  trees: { id: string; name: string; icon: string; min: number }[];
  creatures: { id: string; name: string; icon: string; trees: number; model?: string; fly?: boolean }[];
  shelf: { perShelf: number };
}

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
  walk?: boolean;
  fly?: boolean;
  pitch?: number;
  /** Karo ölçüsü ve yerleşim (yerleştirilebilen eşyalar) */
  w?: number;
  h?: number;
  rotations?: number[];
  placement?: 'indoor' | 'outdoor' | 'both';
  /** Malzeme adı → renk (ör. koltuğun kumaşı) */
  tint?: Record<string, string>;
  /** Bu malzeme ışık saçar (lamba) */
  glow?: string;
  /** Dokununca açılan pencere (kitaplık) */
  opens?: 'shelf';
  desc?: string;
  /** Zemin/duvar kaplamasının rengi */
  color?: string;
  color2?: string;
  stars?: boolean;
}

export const CFG = economy as EconomyConfig;
export const ITEM_DEFS = items.items as ItemDef[];
