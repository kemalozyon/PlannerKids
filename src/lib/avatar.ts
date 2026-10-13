// Parça parça avatar: ten, yüz, saç, üst, alt, ayakkabı, şapka, gözlük ve sırt. Parçalar items.json'da
// (category 'kiyafet', slot + style); bazıları ücretsiz, bazıları 💎 Elmasla ya da başarıyla açılır.
// Renkler buradaki paletlerden seçilir. Görünüş family_settings.equipped → { look, pets } içinde durur;
// sunucu giyilen parçaların sahip olunduğunu denetler (0015_world_v2.sql → equipped_check).
import { ITEMS, itemById, type Item, type Slot } from './catalog';
import { rng } from './rng';
import type { Equipped } from './types';

export const SKINS = ['#ffe0c7', '#f9d0b0', '#f1c19a', '#e0a67a', '#c98a5c', '#a86d45', '#8a5433', '#5e3a22'];
export const HAIR_COLORS = ['#2b1d16', '#4a2f1f', '#7a4a2a', '#b5793d', '#e3b15a', '#f4d98b', '#c0392b', '#e8e8e8', '#ff8ac2', '#7e6bff', '#3fb6ff', '#46c46e'];
export const CLOTH_COLORS = ['#ffffff', '#2b2d42', '#ef476f', '#ff8c42', '#ffd166', '#06d6a0', '#118ab2', '#3a5ccc', '#8e5bd8', '#f78fb3', '#7f8c8d', '#8d6346', '#2e7d4f', '#c0392b'];
export const EYE_COLORS = ['#2b1d16', '#5b3a1e', '#2f6fb0', '#2f8f5b', '#6b6b6b'];

export const EYES = [
  { id: 'round', name: 'Yuvarlak' },
  { id: 'big', name: 'Kocaman' },
  { id: 'happy', name: 'Gülen' },
  { id: 'sleepy', name: 'Uykulu' },
  { id: 'wink', name: 'Göz kırpan' },
] as const;
export const BROWS = [
  { id: 'none', name: 'Yok' },
  { id: 'thin', name: 'İnce' },
  { id: 'thick', name: 'Kalın' },
  { id: 'angry', name: 'Kararlı' },
] as const;
export const MOUTHS = [
  { id: 'smile', name: 'Gülümseme' },
  { id: 'grin', name: 'Kahkaha' },
  { id: 'open', name: 'Şaşkın' },
  { id: 'flat', name: 'Ciddi' },
  { id: 'tongue', name: 'Dil çıkaran' },
] as const;
export const CHEEKS = [
  { id: 'none', name: 'Yok' },
  { id: 'blush', name: 'Al yanak' },
  { id: 'freckles', name: 'Çil' },
] as const;
export const BODIES = [
  { id: 'small', name: 'Kısa', scale: 0.92 },
  { id: 'normal', name: 'Orta', scale: 1 },
  { id: 'tall', name: 'Uzun', scale: 1.08 },
] as const;

export interface AvatarLook {
  skin: string;
  body: (typeof BODIES)[number]['id'];
  eyes: (typeof EYES)[number]['id'];
  eyeColor: string;
  brows: (typeof BROWS)[number]['id'];
  mouth: (typeof MOUTHS)[number]['id'];
  cheeks: (typeof CHEEKS)[number]['id'];
  hair: string;
  hairColor: string;
  top: string;
  topColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoesColor: string;
  hat: string | null;
  hatColor: string;
  glasses: string | null;
  back: string | null;
  backColor: string;
}

export const DEFAULT_LOOK: AvatarLook = {
  skin: SKINS[1],
  body: 'normal',
  eyes: 'round',
  eyeColor: EYE_COLORS[0],
  brows: 'thin',
  mouth: 'smile',
  cheeks: 'blush',
  hair: 'k:sac-atkuyrugu',
  hairColor: HAIR_COLORS[2],
  top: 'k:ust-tisort',
  topColor: '#ff8c42',
  bottom: 'k:alt-kot',
  bottomColor: '#3a5ccc',
  shoes: 'k:ayk-spor',
  shoesColor: '#ffffff',
  hat: null,
  hatColor: '#ef476f',
  glasses: null,
  back: null,
  backColor: '#06d6a0',
};

/** Parçanın alanı (look anahtarı) ve rengi */
export const SLOT_KEY: Record<Slot, { key: keyof AvatarLook; color?: keyof AvatarLook; optional: boolean }> = {
  hair: { key: 'hair', color: 'hairColor', optional: false },
  top: { key: 'top', color: 'topColor', optional: false },
  bottom: { key: 'bottom', color: 'bottomColor', optional: false },
  shoes: { key: 'shoes', color: 'shoesColor', optional: false },
  hat: { key: 'hat', color: 'hatColor', optional: true },
  glasses: { key: 'glasses', optional: true },
  back: { key: 'back', color: 'backColor', optional: true },
};

export const slotItems = (slot: Slot): Item[] => ITEMS.filter((i) => i.category === 'kiyafet' && i.slot === slot);

/** Görünüşteki parça kimlikleri (boş olanlar hariç) */
export const lookParts = (look: AvatarLook): string[] =>
  (Object.values(SLOT_KEY).map((s) => look[s.key]) as (string | null)[]).filter((x): x is string => !!x);

/** Parçanın çizim stili (style) */
export const styleOf = (id: string | null): string | null => (id ? (itemById(id)?.style ?? null) : null);

const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const oneOf = <T extends { id: string }>(list: readonly T[], v: unknown, d: T['id']): T['id'] => (list.some((x) => x.id === v) ? (v as T['id']) : d);

/** Kayıttan okunan görünüşü tamamlar: bilinmeyen alanlar varsayılana döner (sahiplik denetlenmez) */
export function normalizeLook(raw: unknown): AvatarLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AvatarLook, unknown>>;
  const part = (slot: Slot, v: unknown): string | null => {
    const s = SLOT_KEY[slot];
    const it = typeof v === 'string' ? itemById(v) : undefined;
    if (it && it.category === 'kiyafet' && it.slot === slot) return it.id;
    return s.optional ? null : (DEFAULT_LOOK[s.key] as string);
  };
  return {
    skin: hex(r.skin) ? r.skin : DEFAULT_LOOK.skin,
    body: oneOf(BODIES, r.body, DEFAULT_LOOK.body),
    eyes: oneOf(EYES, r.eyes, DEFAULT_LOOK.eyes),
    eyeColor: hex(r.eyeColor) ? r.eyeColor : DEFAULT_LOOK.eyeColor,
    brows: oneOf(BROWS, r.brows, DEFAULT_LOOK.brows),
    mouth: oneOf(MOUTHS, r.mouth, DEFAULT_LOOK.mouth),
    cheeks: oneOf(CHEEKS, r.cheeks, DEFAULT_LOOK.cheeks),
    hair: part('hair', r.hair)!,
    hairColor: hex(r.hairColor) ? r.hairColor : DEFAULT_LOOK.hairColor,
    top: part('top', r.top)!,
    topColor: hex(r.topColor) ? r.topColor : DEFAULT_LOOK.topColor,
    bottom: part('bottom', r.bottom)!,
    bottomColor: hex(r.bottomColor) ? r.bottomColor : DEFAULT_LOOK.bottomColor,
    shoes: part('shoes', r.shoes)!,
    shoesColor: hex(r.shoesColor) ? r.shoesColor : DEFAULT_LOOK.shoesColor,
    hat: part('hat', r.hat),
    hatColor: hex(r.hatColor) ? r.hatColor : DEFAULT_LOOK.hatColor,
    glasses: part('glasses', r.glasses),
    back: part('back', r.back),
    backColor: hex(r.backColor) ? r.backColor : DEFAULT_LOOK.backColor,
  };
}

/** Giyilen parçalardan sahip olunmayan var mı (sunucudaki equipped_check'in aynısı) */
export function lookProblem(look: AvatarLook, has: (item: Item) => boolean): string | null {
  for (const [slot, s] of Object.entries(SLOT_KEY) as [Slot, (typeof SLOT_KEY)[Slot]][]) {
    const id = look[s.key] as string | null;
    if (!id) {
      if (!s.optional) return 'Görünüş eksik';
      continue;
    }
    const it = itemById(id);
    if (!it || it.category !== 'kiyafet' || it.slot !== slot) return 'Görünüş geçersiz';
    if (!has(it)) return `${it.name} sende yok`;
  }
  return null;
}

/** 🎲 Rastgele görünüş: yalnızca sahip olunan parçalarla */
export function randomLook(has: (item: Item) => boolean, seed: string): AvatarLook {
  const r = rng(`avatar:${seed}`);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const part = (slot: Slot, optional: boolean) => {
    const mine = slotItems(slot).filter(has);
    if (optional && r() < 0.55) return null;
    return mine.length ? pick(mine).id : null;
  };
  return normalizeLook({
    skin: pick(SKINS),
    body: pick(BODIES).id,
    eyes: pick(EYES).id,
    eyeColor: pick(EYE_COLORS),
    brows: pick(BROWS).id,
    mouth: pick(MOUTHS).id,
    cheeks: pick(CHEEKS).id,
    hair: part('hair', false),
    hairColor: pick(HAIR_COLORS),
    top: part('top', false),
    topColor: pick(CLOTH_COLORS),
    bottom: part('bottom', false),
    bottomColor: pick(CLOTH_COLORS),
    shoes: part('shoes', false),
    shoesColor: pick(CLOTH_COLORS),
    hat: part('hat', true),
    hatColor: pick(CLOTH_COLORS),
    glasses: part('glasses', true),
    back: part('back', true),
    backColor: pick(CLOTH_COLORS),
  });
}

/** Bir parçayı giyerek görünüşü değiştirir (dükkân önizlemesi ve düzenleyici) */
export function wear(look: AvatarLook, item: Item): AvatarLook {
  if (item.category !== 'kiyafet' || !item.slot) return look;
  return { ...look, [SLOT_KEY[item.slot].key]: item.id };
}

// ---------- Kayıt ----------

export const DEFAULT_EQUIPPED: Equipped = { look: DEFAULT_LOOK, pets: [] };

/** Kayıttaki görünüş (eski { character, accessory } kaydı dahil) → güncel biçim */
export function normalizeEquipped(raw: unknown): Equipped {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { look?: unknown; pets?: unknown; character?: unknown };
  let look = normalizeLook(r.look);
  // Eski hazır karakterden kabaca bir başlangıç: erkek karakterlere kısa saç
  if (!r.look && typeof r.character === 'string' && r.character.includes('male-') && !r.character.includes('female')) look = { ...look, hair: 'k:sac-kisa' };
  const pets = Array.isArray(r.pets) ? r.pets.filter((p): p is string => typeof p === 'string' && itemById(p)?.category === 'evcil') : [];
  return { look, pets };
}
