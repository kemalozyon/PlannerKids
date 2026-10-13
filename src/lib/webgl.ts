/** Tarayıcı 3D çizebiliyor mu (WebGL). Yoksa ada düz ızgara, eşyalar simge olarak gösterilir. */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
