// Ortam sesi çalar: yağmur, beyaz/pembe gürültü, dalgalar ve Lo-Fi. Dosya yok, hepsi WebAudio ile üretilir.
// Uygulama boyu tek çalar: odadaki radyo/pikap (MUSIC) ve odak modunun yağmur sesi aynı çaları kullanır, sekme
// değişse de çalmaya devam eder. Ses düzeyi tarayıcıda saklanır; çalma durumu saklanmaz (tarayıcı kendiliğinden
// ses açmaya izin vermez).
import { useSyncExternalStore } from 'react';

export const CHANNELS = [
  { id: 'lofi', name: 'Lo-Fi', icon: '🎧', desc: 'Yavaş ritim, yumuşak akorlar' },
  { id: 'yagmur', name: 'Yağmur', icon: '🌧️', desc: 'Camda hafif yağmur' },
  { id: 'dalga', name: 'Dalgalar', icon: '🌊', desc: 'Sahile vuran dalgalar' },
  { id: 'pembe', name: 'Pembe gürültü', icon: '🌸', desc: 'Yumuşak, dengeli uğultu' },
  { id: 'beyaz', name: 'Beyaz gürültü', icon: '📻', desc: 'Dış sesleri bastırır' },
] as const;
export type Channel = (typeof CHANNELS)[number]['id'];

export interface AmbientState {
  channel: Channel | null;
  /** Çalan eşya (powerKey): plak o dönerken döner */
  source: string | null;
  /** 0…1 */
  volume: number;
}

const VOL_KEY = 'ct-ambient-v1';
const readVolume = () => {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.6;
  } catch {
    return 0.6;
  }
};

let state: AmbientState = { channel: null, source: null, volume: readVolume() };
const listeners = new Set<() => void>();
const set = (s: Partial<AmbientState>) => {
  state = { ...state, ...s };
  listeners.forEach((f) => f());
};

export const ambientState = () => state;
export function useAmbient(): AmbientState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => state,
  );
}

// ---------- Ses grafiği ----------
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Çalan kanalın durdurucusu */
let stopNow: (() => void) | null = null;

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Döngüde çalan gürültü tamponu: beyaz, pembe (Paul Kellet) ya da kahverengi */
function noiseBuffer(c: AudioContext, kind: 'beyaz' | 'pembe' | 'kahve', seconds = 4): AudioBuffer {
  const len = c.sampleRate * seconds;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'beyaz') d[i] = w * 0.5;
    else if (kind === 'kahve') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

function loop(c: AudioContext, buf: AudioBuffer, out: AudioNode): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.connect(out);
  s.start();
  return s;
}

/** Gürültü kanalları; dalgada ses yavaşça kabarıp çekilir */
function noise(c: AudioContext, out: AudioNode, ch: 'yagmur' | 'beyaz' | 'pembe' | 'dalga'): () => void {
  const g = c.createGain();
  g.gain.value = ch === 'yagmur' ? 0.4 : ch === 'beyaz' ? 0.18 : 0.5;
  g.connect(out);
  const nodes: AudioScheduledSourceNode[] = [];
  if (ch === 'dalga') {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(g);
    g.gain.value = 0.35;
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 0.11;
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(g.gain);
    lfo.start();
    nodes.push(lfo, loop(c, noiseBuffer(c, 'pembe', 6), lp));
  } else nodes.push(loop(c, noiseBuffer(c, ch === 'yagmur' ? 'kahve' : ch), g));
  return () => {
    nodes.forEach((n) => n.stop());
    g.disconnect();
  };
}

/** Akorlar (Hz): Cmaj7 – Am7 – Dm7 – G7, her biri bir ölçü */
const CHORDS = [
  [261.6, 329.6, 392.0, 493.9],
  [220.0, 261.6, 329.6, 392.0],
  [293.7, 349.2, 440.0, 523.3],
  [196.0, 246.9, 293.7, 349.2],
];
const BPM = 72;

/** Lo-Fi: yumuşak akor, kick, hi-hat ve plak cızırtısı; ileriye bakan zamanlayıcıyla çalar */
function lofi(c: AudioContext, out: AudioNode): () => void {
  const bus = c.createGain();
  bus.gain.value = 0.9;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  bus.connect(lp).connect(out);
  const hiss = c.createGain();
  hiss.gain.value = 0.012;
  hiss.connect(out);
  const crackle = loop(c, noiseBuffer(c, 'pembe', 3), hiss);
  const hatBuf = noiseBuffer(c, 'beyaz', 1);
  const beat = 60 / BPM;
  let next = c.currentTime + 0.1;
  let step = 0;
  const note = (f: number, t: number, dur: number, vol: number, type: OscillatorType) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const kick = (t: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.32);
  };
  const hat = (t: number, vol: number) => {
    const s = c.createBufferSource();
    const hp = c.createBiquadFilter();
    const g = c.createGain();
    s.buffer = hatBuf;
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(hp).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5, 0.06);
  };
  // Sekizlik adımlar: her ölçü 8 adım
  const tick = () => {
    while (next < c.currentTime + 0.4) {
      const bar = Math.floor(step / 8) % CHORDS.length;
      const s = step % 8;
      if (s === 0) {
        for (const f of CHORDS[bar]) note(f / 2, next, beat * 3.8, 0.05, 'triangle');
        note(CHORDS[bar][0] / 4, next, beat * 1.8, 0.12, 'sine');
      }
      if (s === 4) note(CHORDS[bar][0] / 4, next, beat * 1.8, 0.1, 'sine');
      // Arada bir yumuşak melodi notası
      if ((s === 3 || s === 6) && Math.random() < 0.55) note(CHORDS[bar][1 + Math.floor(Math.random() * 3)], next, beat * 0.9, 0.035, 'sine');
      if (s === 0 || s === 5) kick(next);
      hat(next + (s % 2 ? beat * 0.06 : 0), s % 2 ? 0.03 : 0.05);
      next += beat / 2;
      step++;
    }
  };
  tick();
  const timer = window.setInterval(tick, 100);
  return () => {
    window.clearInterval(timer);
    crackle.stop();
    bus.disconnect();
    hiss.disconnect();
  };
}

/** Kanalı çal (çalan durur); source: çalan eşya */
export function play(channel: Channel, source: string | null = null) {
  const c = audio();
  if (!c || !master) return;
  stopNow?.();
  master.gain.value = state.volume;
  // Kısa açılış: ses birden patlamasın
  const fade = c.createGain();
  fade.gain.setValueAtTime(0.0001, c.currentTime);
  fade.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.6);
  fade.connect(master);
  const stop = channel === 'lofi' ? lofi(c, fade) : noise(c, fade, channel);
  stopNow = () => {
    stop();
    fade.disconnect();
  };
  set({ channel, source });
}

export function stop() {
  stopNow?.();
  stopNow = null;
  set({ channel: null, source: null });
}

export function setVolume(v: number) {
  const volume = Math.min(1, Math.max(0.05, v));
  if (master) master.gain.value = volume;
  try {
    localStorage.setItem(VOL_KEY, String(volume));
  } catch {
    /* yok say */
  }
  set({ volume });
}
