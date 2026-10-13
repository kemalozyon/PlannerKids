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
}

export const CFG = economy as EconomyConfig;
export const ITEM_DEFS = items.items as ItemDef[];
