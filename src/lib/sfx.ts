// Küçük ses efektleri: dosya yok, WebAudio ile anında üretilir. Ses ayarı tarayıcıda saklanır.
const KEY = 'ct-sfx-v1';

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* yok say */
  }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!soundOn()) return null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Bir nota: frekans (başlangıç → bitiş), süre, gecikme, dalga biçimi */
function tone(f0: number, f1: number, dur: number, delay = 0, type: OscillatorType = 'sine', vol = 0.18) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  /** Ağaç dikildi / büyüdü: yükselen üç nota */
  plant() {
    [523, 659, 784].forEach((f, i) => tone(f, f * 1.01, 0.28, i * 0.09, 'triangle'));
  },
  /** Bir şeye dokunuldu */
  pop() {
    tone(420, 760, 0.09, 0, 'sine', 0.14);
  },
  /** Hayvana dokunuldu: hayvana göre perde */
  boing(pitch = 1) {
    tone(260 * pitch, 620 * pitch, 0.16, 0, 'square', 0.07);
    tone(620 * pitch, 330 * pitch, 0.18, 0.15, 'sine', 0.12);
  },
  /** Arı vızıltısı */
  buzz() {
    tone(180, 210, 0.35, 0, 'sawtooth', 0.04);
  },
  /** Yıldız toplandı: parlak iki nota */
  star() {
    tone(988, 1000, 0.12, 0, 'triangle', 0.12);
    tone(1319, 1330, 0.22, 0.08, 'triangle', 0.12);
  },
  /** Zıplama */
  jump() {
    tone(300, 520, 0.14, 0, 'sine', 0.08);
  },
  /** Solgun fidan */
  sad() {
    tone(392, 300, 0.35, 0, 'triangle', 0.1);
  },
};
