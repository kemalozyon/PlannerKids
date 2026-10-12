// Aile paneli kilidi. PIN bir çocuk kilididir, güvenlik önlemi değildir:
// aynı hesapla girildiği için yalnızca yanlışlıkla açılmayı önler.

const UNLOCK_KEY = 'ct-family-unlocked-v1';

export async function hashPin(pin: string): Promise<string> {
  const text = `calisma-takip:${pin}`;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // Güvenli olmayan bağlamda (http) subtle yok: basit FNV-1a özeti
    let h = 0x811c9dc5;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    return `fnv:${h.toString(16)}`;
  }
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const validPin = (pin: string) => /^\d{4}$/.test(pin);

/** Bu sekmede panel açık mı (sekme kapanınca kilitlenir). */
export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function setUnlocked(on: boolean) {
  try {
    if (on) sessionStorage.setItem(UNLOCK_KEY, '1');
    else sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* yok say */
  }
}
