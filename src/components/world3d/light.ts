// Günün saatine göre gökyüzü ve ışık (oda ve dış mekân aynı tabloyu kullanır). Atmosphere.tsx evre değişince
// bu değerler arasında yumuşakça geçer.
import type { DayPhase } from '../../lib/dayPhase';
import type { ThreeEvent } from '@react-three/fiber';

export interface PhaseLight {
  label: string;
  /** Gökyüzünün tepesi ve ufku (ufuk aynı zamanda sis rengi) */
  top: string;
  horizon: string;
  sun: string;
  sunI: number;
  /** Güneşin (gece ayın) hedefe göre yönü: ışık hep -x/+z yanından gelir, gölgeler kuşbakışı kamerada (+x,+z) görünür yana düşer (arkaya değil) */
  sunDir: [number, number, number];
  sky2: string;
  ground: string;
  hemiI: number;
  /** Ortam yansımasının (IBL) gücü */
  env: number;
  /** Gece yıldızları */
  stars: boolean;
}

export const LIGHT: Record<DayPhase, PhaseLight> = {
  sabah: { label: '🌅 Sabah', top: '#8ec9ff', horizon: '#ffe3c4', sun: '#ffe6c4', sunI: 2.4, sunDir: [-14, 11, 7], sky2: '#ffe9d0', ground: '#7a5a3a', hemiI: 0.72, env: 0.2, stars: false },
  gunduz: { label: '☀️ Gündüz', top: '#6fbcff', horizon: '#cdeeff', sun: '#ffffff', sunI: 2.8, sunDir: [-6, 22, 11], sky2: '#ffffff', ground: '#6a5a3a', hemiI: 0.78, env: 0.22, stars: false },
  aksam: { label: '🌇 Akşam', top: '#7d6fc9', horizon: '#ffb07a', sun: '#ffa060', sunI: 2.0, sunDir: [-1, 10, 16], sky2: '#ffcfa8', ground: '#5a3a3a', hemiI: 0.66, env: 0.18, stars: false },
  gece: { label: '🌙 Gece', top: '#0b1030', horizon: '#26346e', sun: '#a9bcff', sunI: 0.7, sunDir: [-7, 18, 11], sky2: '#7f8fd8', ground: '#1f2440', hemiI: 0.48, env: 0.1, stars: true },
};

/** Sürükleyip döndürmeyi dokunmadan ayır */
export const isTap = (e: ThreeEvent<MouseEvent>) => e.delta < 8;
