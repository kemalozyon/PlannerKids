// Dükkân penceresi her sayfanın üstünde açılır (App.tsx → Shell). "#shop" adresi de pencereyi açar (eski bağlantılar,
// tanıtım turu). "Hemen yerleştir": Dünyam açılır, eşya karakterin bulunduğu alanda düzenleme modunda ele verilir.
export const SHOP_EVENT = 'ct-shop';
export const PLACE_EVENT = 'ct-place';
const PLACE_KEY = 'ct-place-item';

export const openShop = () => window.dispatchEvent(new Event(SHOP_EVENT));

/** Satın alınan eşyayı hemen yerleştir (Dünyam henüz açık değilse açılınca ele alınır) */
export function placeNow(id: string) {
  try {
    sessionStorage.setItem(PLACE_KEY, id);
  } catch {
    /* yok say */
  }
  window.dispatchEvent(new CustomEvent(PLACE_EVENT, { detail: id }));
}

/** Bekleyen "hemen yerleştir" isteğini al (bir kez) */
export function takePlace(): string | null {
  try {
    const id = sessionStorage.getItem(PLACE_KEY);
    sessionStorage.removeItem(PLACE_KEY);
    return id;
  } catch {
    return null;
  }
}
