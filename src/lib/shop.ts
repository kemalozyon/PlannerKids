// Dükkân Dünyam'ın alttaki panelinde açılır (WorldDock → 🛍️ Dükkân). Başka bir sayfadan openShop(): Dünyam açılır
// ve panelde Dükkân sekmesi seçilir ("#shop" adresi de aynısını yapar: eski bağlantılar, tanıtım turu).
export const SHOP_EVENT = 'ct-shop';
const SHOP_KEY = 'ct-open-shop';

export function openShop() {
  try {
    sessionStorage.setItem(SHOP_KEY, '1');
  } catch {
    /* yok say */
  }
  window.dispatchEvent(new Event(SHOP_EVENT));
}

/** Bekleyen "dükkânı aç" isteğini al (bir kez; Dünyam açılırken) */
export function takeShop(): boolean {
  try {
    const on = sessionStorage.getItem(SHOP_KEY) === '1';
    sessionStorage.removeItem(SHOP_KEY);
    return on;
  } catch {
    return false;
  }
}
