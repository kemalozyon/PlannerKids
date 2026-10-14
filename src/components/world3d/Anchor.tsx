// Sahnedeki bir noktayı ekrandaki bir HTML kutusuna bağlar (eşyanın, karakterin seçenek balonu). Her karede nokta
// kameradan ekrana izdüşürülür ve kutunun left/top'u doğrudan yazılır: React yeniden çizmez. Sahne "istek üzerine"
// çizilse de (frameloop="demand") kamera ya da karakter her oynadığında kare çizildiği için balon yapışık kalır.
// drei <Html> kullanılmıyor (tuval kapanırken removeChild hatası verir).
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, type RefObject } from 'react';
import { Vector3 } from 'three';

/** Üst şeridin (çipler) altında kalsın; sığmazsa balon noktanın altına geçer */
const TOP = 52;
const EDGE = 8;

export default function ScreenAnchor({ el, at, id }: { el: RefObject<HTMLElement | null>; at: () => [number, number, number] | null; id: string }) {
  const { camera, size, invalidate } = useThree();
  const v = useMemo(() => new Vector3(), []);
  // Yeni hedefte bir kare çiz (balon hemen yerine otursun)
  useEffect(() => {
    invalidate();
    const f = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(f);
  }, [id, invalidate]);
  useFrame(() => {
    const box = el.current;
    const p = at();
    if (!box || !p) return;
    v.set(p[0], p[1], p[2]).project(camera);
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let x = ((v.x + 1) / 2) * size.width;
    const y = ((1 - v.y) / 2) * size.height;
    x = Math.min(size.width - w / 2 - EDGE, Math.max(w / 2 + EDGE, x));
    const below = y - h - 14 < TOP;
    box.style.left = `${x}px`;
    box.style.top = `${below ? Math.min(y + 40, size.height - h - 14 - EDGE) : Math.min(y, size.height - EDGE)}px`;
    box.dataset.below = below ? '1' : '0';
    box.style.visibility = 'visible';
  });
  return null;
}
