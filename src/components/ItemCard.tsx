import { RARITY, type Item } from '../lib/catalog';

/** Dükkân ve koleksiyon kartı: simge, ad, nadirlik şeridi; altta fiyat, "sende" ya da nasıl açılacağı. */
export default function ItemCard({
  item,
  have,
  count = 0,
  footer,
  silhouette,
  onClick,
}: {
  item: Item;
  have: boolean;
  count?: number;
  footer: string;
  /** Koleksiyonda sahip olunmayan: gölge gibi */
  silhouette?: boolean;
  onClick: () => void;
}) {
  const r = RARITY[item.rarity];
  return (
    <button
      className={`item-card r-${item.rarity}${have ? ' have' : ''}${silhouette ? ' silhouette' : ''}`}
      style={{ ['--rarity' as string]: r.color }}
      onClick={onClick}
      aria-label={`${item.name}, ${r.name}${have ? ', sende' : ''}`}
    >
      <span className="item-icon" aria-hidden>
        {silhouette ? '❔' : item.icon}
      </span>
      <span className="item-name">{silhouette ? '???' : item.name}</span>
      <span className="item-foot">
        {footer}
        {count > 1 && ` ×${count}`}
      </span>
    </button>
  );
}

/** Kartın altındaki kısa yazı */
export function priceText(item: Item): string {
  const a = item.acquire;
  if (a.kind === 'buy') return `💎 ${a.price}`;
  if (a.kind === 'chest') return '📦 Sandık';
  if (a.kind === 'free') return 'Ücretsiz';
  return '🔒 Başarı';
}
