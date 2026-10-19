// Günün tohumu: çocuk bugünün ağacının türünü kendisi seçer (Forest'taki gibi). Her tür için dükkânda bir tohum var
// (items.json → tohum:<tür>): bazıları ücretsiz, bazıları Elmasla bir kez alınır. Mevsimi olan türler (months) yalnızca
// mevsiminde ekilir. Seçim yalnızca bugün için yapılır ve gün içinde değiştirilebilir; seçilmeyen gün tarihten
// tohumlanan türü alır (world.ts → speciesOf). Aynı kural SQL'de: day_seeds_check (0031_economy_v3.sql).
import { itemById, type Item } from './catalog';
import { CFG, type SpeciesDef } from './config';
import type { DaySeed, OwnedItem } from './types';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export const seedItemId = (species: string) => `tohum:${species}`;

/** Tür bu gün ekilebilir mi (mevsimi yoksa her zaman) */
export const inSeason = (sp: Pick<SpeciesDef, 'months'>, date: string) => !sp.months || sp.months.includes(Number(date.slice(5, 7)));

/** "Mart, Nisan, Mayıs" ya da "Her mevsim" */
export const seasonText = (sp: Pick<SpeciesDef, 'months'>) => (sp.months ? sp.months.map((m) => MONTHS[m - 1]).join(', ') : 'Her mevsim');

/** Tohum sende mi: ücretsizse hep, satılıyorsa alınmışsa */
export const ownsSeed = (item: Item, owned: OwnedItem[]) => item.acquire.kind === 'free' || owned.some((o) => o.item_id === item.id);

export interface SeedChoice {
  species: SpeciesDef;
  item: Item;
  owned: boolean;
  season: boolean;
}

/** Bütün tohumlar: ekilebilenler önde (sende ve mevsiminde), sonra mevsiminde olup alınmamışlar, sonra mevsim dışı */
export function seedChoices(date: string, owned: OwnedItem[]): SeedChoice[] {
  const out: SeedChoice[] = [];
  for (const species of CFG.world.species) {
    const item = itemById(seedItemId(species.id));
    if (item) out.push({ species, item, owned: ownsSeed(item, owned), season: inSeason(species, date) });
  }
  const rank = (c: SeedChoice) => (c.season ? (c.owned ? 0 : 1) : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Seçilemiyorsa nedeni (sunucudaki day_seeds_check ile aynı; gün denetimini sunucu ±1 günle yapar) */
export function seedProblem(date: string, species: string, owned: OwnedItem[], today: string): string | null {
  if (date !== today) return 'Yalnızca bugünün tohumu seçilebilir';
  const sp = CFG.world.species.find((s) => s.id === species);
  const item = itemById(seedItemId(species));
  if (!sp || !item) return 'Böyle bir tohum yok';
  if (!ownsSeed(item, owned)) return 'Bu tohum sende değil';
  if (!inSeason(sp, date)) return `${sp.name} yalnızca mevsiminde ekilir (${seasonText(sp)})`;
  return null;
}

/** Tarih → seçilen tür */
export const seedMap = (seeds: DaySeed[]): Record<string, string> => Object.fromEntries(seeds.map((s) => [s.date, s.species]));
