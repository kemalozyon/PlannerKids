// Günün saatine göre gökyüzü ve ışık (oda ve dış mekân aynı tabloyu kullanır)
import type { DayPhase } from '../../lib/dayPhase';
import type { ThreeEvent } from '@react-three/fiber';

export const LIGHT: Record<DayPhase, { label: string; sky: string; sun: string; sunI: number; sky2: string; ground: string; hemiI: number; fog: string }> = {
  sabah: { label: '🌅 Sabah', sky: 'linear-gradient(180deg,#ffe2bd 0%,#bfe3ff 100%)', sun: '#fff0d6', sunI: 2.3, sky2: '#ffe9d0', ground: '#7a5a3a', hemiI: 1.1, fog: '#d9ecff' },
  gunduz: { label: '☀️ Gündüz', sky: 'linear-gradient(180deg,#bfe8ff 0%,#8fd0ff 100%)', sun: '#ffffff', sunI: 2.7, sky2: '#ffffff', ground: '#6a5a3a', hemiI: 1.2, fog: '#a8dcff' },
  aksam: { label: '🌇 Akşam', sky: 'linear-gradient(180deg,#ffc58f 0%,#f2876c 100%)', sun: '#ffae6b', sunI: 1.9, sky2: '#ffcfa8', ground: '#5a3a3a', hemiI: 0.9, fog: '#f6a37e' },
  gece: {
    label: '🌙 Gece',
    sky: 'radial-gradient(1px 1px at 20% 30%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 70% 20%,#fff 50%,transparent 51%),radial-gradient(1.5px 1.5px at 85% 45%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 40% 12%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 10% 60%,#fff 50%,transparent 51%),linear-gradient(180deg,#24336b 0%,#0e1430 100%)',
    sun: '#a9bcff',
    sunI: 0.7,
    sky2: '#7f8fd8',
    ground: '#1f2440',
    hemiI: 0.55,
    fog: '#1a2350',
  },
};

/** Sürükleyip döndürmeyi dokunmadan ayır */
export const isTap = (e: ThreeEvent<MouseEvent>) => e.delta < 8;
