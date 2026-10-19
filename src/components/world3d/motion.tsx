// Hareket yardımcıları: kare hızından bağımsız sönümleme (damp), en kısa yoldan açı, yumuşatma eğrileri ve sahne
// "istek üzerine" çizildiği için (frameloop="demand") hedefe varana kadar kendi kendine kare isteyen hook'lar.
// Azaltılmış hareket ayarı lib/motionPref.ts'te (sayfa da kullanır).
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../../lib/motionPref';
import type { Group } from 'three';

/** cur'u to'ya λ hızıyla yaklaştırır (λ büyüdükçe hızlı); kare hızı ne olursa olsun aynı süre */
export const damp = (cur: number, to: number, lambda: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-lambda * dt));

/** Açının farkı (-π…π) */
export const angleDiff = (from: number, to: number) => {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
};

/** Açıyı en kısa yoldan sönümler */
export const dampAngle = (cur: number, to: number, lambda: number, dt: number) => cur + angleDiff(cur, to) * (1 - Math.exp(-lambda * dt));

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Biraz taşıp yerine oturur (yerleştirme) */
export const easeOutBack = (t: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

export { reducedMotion, setReducedMotion, useReducedMotion } from '../../lib/motionPref';

// ---------- Sahne hook'ları ----------
/** Yalnızca çizildikçe ilerleyen saat (istek üzerine çizimde uzun aradan sonra zıplamaz) */
export function useLocalTime() {
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.05);
  });
  return t;
}

/**
 * Sayıyı hedefe sönümleyen ref; hedefe varana kadar kare ister. `onUpdate` her karede yeni değeri alır
 * (nesneye doğrudan yazmak için: React yeniden çizilmez).
 */
export function useDamped(target: number, lambda: number, onUpdate?: (v: number) => void, initial?: number) {
  const v = useRef(initial ?? target);
  const invalidate = useThree((s) => s.invalidate);
  const reduced = useReducedMotion();
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    if (v.current === target) return;
    const next = reduced ? target : damp(v.current, target, lambda, d);
    v.current = Math.abs(next - target) < 1e-3 ? target : next;
    onUpdate?.(v.current);
    invalidate();
  });
  return v;
}

/**
 * Menteşe: `open` olunca içindekiler `to` kadar döner (ya da kayar), kapanınca geri gelir — sönümlü.
 * `axis` 'x' | 'y' | 'z' dönüş ekseni; `slide` verilirse dönmez, o eksende kayar.
 */
export function Hinge({
  open,
  to,
  axis = 'y',
  slide = false,
  position,
  children,
}: {
  open: boolean;
  to: number;
  axis?: 'x' | 'y' | 'z';
  slide?: boolean;
  position?: [number, number, number];
  children: ReactNode;
}) {
  const g = useRef<Group>(null);
  useDamped(open ? to : 0, 10, (v) => {
    if (!g.current) return;
    if (slide) g.current.position[axis] = (position?.['xyz'.indexOf(axis)] ?? 0) + v;
    else g.current.rotation[axis] = v;
  }, open ? to : 0);
  const p: [number, number, number] = position ?? [0, 0, 0];
  const init = open ? to : 0;
  const rot: [number, number, number] = [0, 0, 0];
  const pos: [number, number, number] = [...p];
  const i = 'xyz'.indexOf(axis);
  if (slide) pos[i] += init;
  else rot[i] = init;
  return (
    <group ref={g} position={pos} rotation={rot}>
      {children}
    </group>
  );
}

/** `on` olunca 0→1, kapanınca 1→0 sönümlü değer (ışık şiddeti, hareket gücü) */
export function usePower(on: boolean, lambda = 6) {
  return useDamped(on ? 1 : 0, lambda, undefined, on ? 1 : 0);
}

/** İçindekileri dikeyde `to` ölçeğine sönümler (kesitte duvarlar alçalıp yükselir) */
export function ScaleY({ to, children }: { to: number; children: ReactNode }) {
  const g = useRef<Group>(null);
  const [init] = useState(to);
  useDamped(to, 9, (v) => {
    if (g.current) g.current.scale.y = v;
  }, init);
  return (
    <group ref={g} scale-y={init}>
      {children}
    </group>
  );
}

/**
 * Ortak saat: aynı sahnede kaç bileşen isterse istesin (su karoları…) tek zamanlayıcı `ms`'de bir kare ister.
 * Her bileşen kendi setInterval'ını kursa sahne o kadar sık çizilirdi.
 */
const tickers = new Map<string, { n: number; id: number }>();
const tickerKey = new WeakMap<() => void, number>();
let nextKey = 0;
export function useSharedTicker(on: boolean, ms: number) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!on) return;
    if (!tickerKey.has(invalidate)) tickerKey.set(invalidate, nextKey++);
    const k = `${tickerKey.get(invalidate)}:${ms}`;
    const t = tickers.get(k);
    if (t) t.n++;
    else tickers.set(k, { n: 1, id: window.setInterval(() => document.visibilityState === 'visible' && invalidate(), ms) });
    return () => {
      const u = tickers.get(k);
      if (!u) return;
      if (--u.n === 0) {
        clearInterval(u.id);
        tickers.delete(k);
      }
    };
  }, [on, ms, invalidate]);
}
