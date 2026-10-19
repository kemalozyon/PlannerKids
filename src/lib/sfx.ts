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
  /** Eşya yerine kondu: tok bir "tak" */
  place() {
    tone(180, 120, 0.08, 0, 'square', 0.06);
    tone(660, 880, 0.1, 0.05, 'sine', 0.1);
  },
  /** Kapıdan geçiş */
  door() {
    tone(330, 440, 0.12, 0, 'triangle', 0.1);
    tone(440, 554, 0.16, 0.1, 'triangle', 0.1);
  },
  /** Hüzünlü kısa ses */
  sad() {
    tone(392, 300, 0.35, 0, 'triangle', 0.1);
  },
  /** Satın alındı: kasa "çın"ı, parlak arpej */
  buy() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, f * 1.005, 0.16, i * 0.06, 'triangle', 0.11));
    tone(2093, 2100, 0.3, 0.26, 'sine', 0.06);
  },
  /** Düğme: kısa, yumuşak "tık" */
  click() {
    tone(900, 700, 0.045, 0, 'sine', 0.07);
  },
  /** Eşya ele alındı: yükselen "vıjt" */
  pick() {
    tone(320, 640, 0.1, 0, 'sine', 0.09);
  },
  /** Suya girildi: köpüklü "şlap" */
  splash() {
    tone(600, 120, 0.22, 0, 'sawtooth', 0.035);
    [0.04, 0.09, 0.15].forEach((d, i) => tone(900 + i * 300, 1400 + i * 300, 0.06, d, 'sine', 0.05));
  },
  /** Işınlanma: inip çıkan "vınn" */
  zap() {
    tone(220, 1760, 0.3, 0, 'sawtooth', 0.04);
    tone(1760, 440, 0.3, 0.3, 'triangle', 0.08);
  },
  /** Zar yuvarlanıyor: takırtı */
  dice() {
    for (let i = 0; i < 6; i++) tone(500 + ((i * 137) % 400), 300, 0.04, i * 0.11, 'square', 0.04);
  },
  /** Müzik karosu: pentatonik bir nota (renge göre) */
  note(i: number) {
    const f = [523, 587, 659, 784, 880, 1047, 1175][((i % 7) + 7) % 7];
    tone(f, f, 0.32, 0, 'triangle', 0.13);
  },
  /** Çalgı eşyaları (PLAY_SOUND): kısa bir ezgi */
  melody(kind: string) {
    const m = MELODIES[kind] ?? MELODIES.piyano;
    let at = 0;
    for (const [f, d] of m.notes) {
      if (f) tone(f, kind === 'davul' ? f * 0.5 : f, d * 0.95, at, m.wave, m.vol);
      at += d;
    }
  },
};

// Notalar (Hz): C5 523, D5 587, E5 659, F5 698, G5 784, A5 880; 0 = es
const MELODIES: Record<string, { wave: OscillatorType; vol: number; notes: [number, number][] }> = {
  piyano: { wave: 'triangle', vol: 0.16, notes: [[523, 0.18], [659, 0.18], [784, 0.18], [659, 0.18], [698, 0.18], [587, 0.18], [523, 0.36]] },
  'muzik-kutusu': { wave: 'sine', vol: 0.14, notes: [[1047, 0.15], [1319, 0.15], [1568, 0.15], [1319, 0.15], [1175, 0.15], [988, 0.15], [1047, 0.3]] },
  davul: { wave: 'square', vol: 0.08, notes: [[140, 0.16], [0, 0.08], [140, 0.12], [220, 0.16], [140, 0.16], [0, 0.08], [220, 0.24]] },
  zil: { wave: 'sine', vol: 0.15, notes: [[1568, 0.3], [1319, 0.3], [1047, 0.5]] },
  gitar: { wave: 'sawtooth', vol: 0.06, notes: [[330, 0.2], [392, 0.2], [494, 0.2], [392, 0.2], [440, 0.4]] },
};
