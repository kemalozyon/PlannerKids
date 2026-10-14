let known: boolean | null = null;

/** Tarayıcı 3D çizebiliyor mu (WebGL). Yoksa ada düz ızgara, eşyalar simge olarak gösterilir. Bir kez denenir:
 *  her deneme yeni bir WebGL bağlamı açar ve tarayıcı bağlam sayısını sınırlar. */
export function hasWebGL(): boolean {
  if (known != null) return known;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    known = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    known = false;
  }
  return known;
}
