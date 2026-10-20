import { useEffect, useState } from 'react';
import { RARITY, type Item } from '../lib/catalog';
import { useThumb } from '../lib/thumbs';

/** Öge ekrana (ya da yakınına) bir kez girdi mi; IntersectionObserver yoksa hemen evet */
function useSeen(el: Element | null): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);
  return seen;
}

/** Eşyanın kendi resmi (ThumbStudio çizer); hazır olana ya da çizilemiyorsa emoji. Ekrana girmeden çizim istemez. */
export function ItemIcon({ item, className = '' }: { item: Item; className?: string }) {
  const [el, setEl] = useState<Element | null>(null);
  const src = useThumb(item, useSeen(el));
  return src ? (
    <img ref={setEl} className={`item-thumb ${className}`} src={src} alt="" draggable={false} />
  ) : (
    <span ref={setEl} className={`item-emoji ${className}`}>
      {item.icon}
    </span>
  );
}

/** Dükkân ve koleksiyon kartı: simge, ad, nadirlik şeridi; altta fiyat, "sende" ya da nasıl açılacağı. */
export default function ItemCard({
  item,
  have,
  count = 0,
  footer,
  silhouette,
  selected,
  badge,
  onClick,
}: {
  item: Item;
  /** Köşedeki rozet (YENİ) */
  badge?: string;
  have: boolean;
  count?: number;
  footer: string;
  /** Koleksiyonda sahip olunmayan: gölge gibi */
  silhouette?: boolean;
  /** Dükkân penceresinde seçili */
  selected?: boolean;
  onClick: () => void;
}) {
  const r = RARITY[item.rarity];
  return (
    <button
      className={`item-card r-${item.rarity}${have ? ' have' : ''}${silhouette ? ' silhouette' : ''}${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      style={{ ['--rarity' as string]: r.color }}
      onClick={onClick}
      aria-label={`${item.name}, ${r.name}${have ? ', sende' : ''}`}
    >
      {badge && <span className="item-badge">{badge}</span>}
      <span className="item-icon" aria-hidden>
        {silhouette ? '❔' : <ItemIcon item={item} />}
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
  if (a.kind === 'drop') return '🌟 Nadir ağaç';
  if (a.kind === 'free') return 'Ücretsiz';
  return '🔒 Başarı';
}
