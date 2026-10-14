// Kodla çizilen resimler: duvar posterleri ve tabloları (items.json → art) ile zemin/duvar desenleri
// (items.json → pattern). Hepsi tuvalde bir kez çizilir ve doku olarak önbelleğe alınır; dosya yok.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { rng } from '../../lib/rng';

type Ctx = CanvasRenderingContext2D;
const cache = new Map<string, CanvasTexture>();

function texture(key: string, w: number, h: number, draw: (g: Ctx, w: number, h: number) => void, repeat = false): CanvasTexture {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  cache.set(key, t);
  return t;
}

const star = (g: Ctx, x: number, y: number, r: number, color: string) => {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
};

const circle = (g: Ctx, x: number, y: number, r: number, color: string) => {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};

const text = (g: Ctx, s: string, x: number, y: number, size: number, color: string, weight = 800) => {
  g.fillStyle = color;
  g.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
};

/** Resimler: [genişlik oranı (karo), çizim]. Çerçeve ayrı çizilir (WallArt). */
const ART: Record<string, (g: Ctx, w: number, h: number) => void> = {
  gezegenler(g, w, h) {
    g.fillStyle = '#1d2350';
    g.fillRect(0, 0, w, h);
    const r = rng('gezegen');
    for (let i = 0; i < 40; i++) circle(g, r() * w, r() * h, 1 + r() * 1.5, '#ffffff');
    circle(g, w * 0.15, h * 0.5, w * 0.14, '#ffcf3f');
    [['#b0b0b0', 0.035], ['#e8a85a', 0.05], ['#4fa3e0', 0.055], ['#d9583f', 0.045], ['#e0b77a', 0.1], ['#e8d08a', 0.085], ['#8fd6e0', 0.065], ['#4f6fe0', 0.06]].forEach(([c, s], i) => {
      circle(g, w * (0.34 + i * 0.085), h * (0.5 + (i % 2 ? 0.08 : -0.08)), w * (s as number), c as string);
    });
    g.strokeStyle = '#e8d08a';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(w * 0.765, h * 0.42, w * 0.13, w * 0.03, -0.3, 0, Math.PI * 2);
    g.stroke();
    text(g, 'GÜNEŞ SİSTEMİ', w / 2, h * 0.88, h * 0.07, '#ffffff');
  },
  harita(g, w, h) {
    g.fillStyle = '#9fd4f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7cc46a';
    const blob = (pts: [number, number][]) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
      g.closePath();
      g.fill();
    };
    blob([[0.08, 0.2], [0.3, 0.15], [0.32, 0.4], [0.22, 0.5], [0.12, 0.42]]);
    blob([[0.24, 0.55], [0.33, 0.58], [0.3, 0.9], [0.24, 0.85]]);
    blob([[0.44, 0.18], [0.58, 0.15], [0.56, 0.4], [0.47, 0.42]]);
    blob([[0.47, 0.45], [0.58, 0.45], [0.56, 0.8], [0.5, 0.82]]);
    blob([[0.6, 0.15], [0.9, 0.18], [0.88, 0.45], [0.66, 0.5], [0.6, 0.35]]);
    blob([[0.8, 0.65], [0.92, 0.63], [0.9, 0.8], [0.8, 0.78]]);
    circle(g, w * 0.535, h * 0.3, h * 0.025, '#ef476f');
    text(g, 'DÜNYA', w * 0.86, h * 0.9, h * 0.08, '#1d4f7a');
  },
  periyodik(g, w, h) {
    g.fillStyle = '#fffaf0';
    g.fillRect(0, 0, w, h);
    const cols = ['#ff8a80', '#ffd180', '#ffff8d', '#ccff90', '#a7ffeb', '#80d8ff', '#b388ff', '#f8bbd0'];
    const cw = w / 18;
    const ch = h / 9;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 18; c++) {
        const gap = r === 0 ? c > 0 && c < 17 : r < 3 ? c > 1 && c < 12 : false;
        if (gap) continue;
        g.fillStyle = cols[(c + r) % cols.length];
        g.fillRect(c * cw + 1, r * ch + ch * 0.5 + 1, cw - 2, ch - 2);
      }
    }
    for (let r = 0; r < 2; r++) for (let c = 3; c < 17; c++) {
      g.fillStyle = r ? '#f8bbd0' : '#e1bee7';
      g.fillRect(c * cw + 1, (7.8 + r) * ch * 0.92, cw - 2, ch * 0.85);
    }
    text(g, 'H', cw / 2, ch, ch * 0.5, '#333');
    text(g, 'He', w - cw / 2, ch, ch * 0.5, '#333');
  },
  motivasyon(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ff9a8b');
    grad.addColorStop(1, '#ffd36e');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    text(g, 'VAZGEÇME!', w / 2, h * 0.42, w * 0.15, '#ffffff', 900);
    text(g, 'Her gün biraz', w / 2, h * 0.62, w * 0.08, '#7a2e2e', 700);
    star(g, w * 0.5, h * 0.18, w * 0.08, '#ffffff');
  },
  kedi(g, w, h) {
    g.fillStyle = '#ffe3ec';
    g.fillRect(0, 0, w, h);
    circle(g, w / 2, h * 0.55, w * 0.28, '#f0a050');
    g.fillStyle = '#f0a050';
    g.beginPath();
    g.moveTo(w * 0.26, h * 0.42);
    g.lineTo(w * 0.3, h * 0.18);
    g.lineTo(w * 0.44, h * 0.32);
    g.moveTo(w * 0.74, h * 0.42);
    g.lineTo(w * 0.7, h * 0.18);
    g.lineTo(w * 0.56, h * 0.32);
    g.fill();
    circle(g, w * 0.4, h * 0.52, w * 0.035, '#2b1d16');
    circle(g, w * 0.6, h * 0.52, w * 0.035, '#2b1d16');
    circle(g, w / 2, h * 0.62, w * 0.025, '#ff7b9c');
    text(g, 'MİYAV', w / 2, h * 0.9, w * 0.1, '#c0567a');
  },
  roket(g, w, h) {
    g.fillStyle = '#2b2d6e';
    g.fillRect(0, 0, w, h);
    const r = rng('roket');
    for (let i = 0; i < 25; i++) circle(g, r() * w, r() * h, 1.5, '#ffffff');
    g.fillStyle = '#eeeeee';
    g.beginPath();
    g.moveTo(w / 2, h * 0.12);
    g.quadraticCurveTo(w * 0.68, h * 0.35, w * 0.62, h * 0.68);
    g.lineTo(w * 0.38, h * 0.68);
    g.quadraticCurveTo(w * 0.32, h * 0.35, w / 2, h * 0.12);
    g.fill();
    circle(g, w / 2, h * 0.38, w * 0.07, '#4fa3e0');
    g.fillStyle = '#ef476f';
    g.fillRect(w * 0.3, h * 0.6, w * 0.08, h * 0.12);
    g.fillRect(w * 0.62, h * 0.6, w * 0.08, h * 0.12);
    g.fillStyle = '#ffb347';
    g.beginPath();
    g.moveTo(w * 0.42, h * 0.68);
    g.lineTo(w / 2, h * 0.9);
    g.lineTo(w * 0.58, h * 0.68);
    g.fill();
  },
  dinozor(g, w, h) {
    g.fillStyle = '#d8f3c8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#4caf50';
    g.beginPath();
    g.ellipse(w * 0.48, h * 0.6, w * 0.25, h * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(w * 0.6, h * 0.3, w * 0.1, h * 0.3);
    g.beginPath();
    g.ellipse(w * 0.7, h * 0.28, w * 0.1, h * 0.06, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(w * 0.25, h * 0.58);
    g.lineTo(w * 0.05, h * 0.7);
    g.lineTo(w * 0.25, h * 0.66);
    g.fill();
    for (const x of [0.36, 0.44, 0.52, 0.58]) g.fillRect(w * x, h * 0.68, w * 0.05, h * 0.14);
    circle(g, w * 0.73, h * 0.26, w * 0.015, '#ffffff');
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#ffb347';
      g.beginPath();
      g.moveTo(w * (0.3 + i * 0.07), h * 0.48);
      g.lineTo(w * (0.335 + i * 0.07), h * 0.4);
      g.lineTo(w * (0.37 + i * 0.07), h * 0.48);
      g.fill();
    }
  },
  gokkusagi(g, w, h) {
    g.fillStyle = '#e8f6ff';
    g.fillRect(0, 0, w, h);
    ['#ef476f', '#ff8c42', '#ffd166', '#06d6a0', '#118ab2', '#8e5bd8'].forEach((c, i) => {
      g.strokeStyle = c;
      g.lineWidth = w * 0.05;
      g.beginPath();
      g.arc(w / 2, h * 0.75, w * (0.4 - i * 0.05), Math.PI, 0);
      g.stroke();
    });
    circle(g, w * 0.15, h * 0.75, w * 0.1, '#ffffff');
    circle(g, w * 0.85, h * 0.75, w * 0.1, '#ffffff');
  },
  dag(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ffcf9e');
    grad.addColorStop(1, '#bfe3ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    circle(g, w * 0.78, h * 0.25, h * 0.1, '#fff3b0');
    const mountain = (x: number, peak: number, c: string) => {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(x - w * 0.3, h);
      g.lineTo(x, h * peak);
      g.lineTo(x + w * 0.3, h);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(x - w * 0.06, h * (peak + 0.15));
      g.lineTo(x, h * peak);
      g.lineTo(x + w * 0.06, h * (peak + 0.15));
      g.fill();
    };
    mountain(w * 0.3, 0.25, '#6b7fa8');
    mountain(w * 0.62, 0.35, '#556a94');
    g.fillStyle = '#5fae4f';
    g.fillRect(0, h * 0.85, w, h * 0.15);
  },
  deniz(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#9edcff');
    grad.addColorStop(0.55, '#e8f6ff');
    grad.addColorStop(0.56, '#2f9ad6');
    grad.addColorStop(1, '#1d6fa8');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    circle(g, w * 0.25, h * 0.3, h * 0.12, '#ffe08a');
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(w * 0.62, h * 0.52);
    g.lineTo(w * 0.7, h * 0.2);
    g.lineTo(w * 0.7, h * 0.52);
    g.fill();
    g.fillStyle = '#c0703a';
    g.fillRect(w * 0.55, h * 0.52, w * 0.2, h * 0.05);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(w * (0.1 + i * 0.16), h * 0.75, w * 0.03, Math.PI, 0);
      g.stroke();
    }
  },
  cicek(g, w, h) {
    g.fillStyle = '#fff4d6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5fae4f';
    g.fillRect(w * 0.48, h * 0.45, w * 0.04, h * 0.5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = '#ffcf3f';
      g.beginPath();
      g.ellipse(w / 2 + Math.cos(a) * w * 0.15, h * 0.38 + Math.sin(a) * w * 0.15, w * 0.09, w * 0.04, a, 0, Math.PI * 2);
      g.fill();
    }
    circle(g, w / 2, h * 0.38, w * 0.1, '#8a5a2a');
  },
  soyut(g, w, h) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ef476f';
    g.fillRect(w * 0.1, h * 0.1, w * 0.45, h * 0.35);
    g.fillStyle = '#118ab2';
    g.fillRect(w * 0.6, h * 0.1, w * 0.3, h * 0.6);
    g.fillStyle = '#ffd166';
    g.fillRect(w * 0.1, h * 0.5, w * 0.45, h * 0.4);
    g.fillStyle = '#2b2d42';
    g.fillRect(w * 0.55, h * 0.1, w * 0.05, h * 0.8);
    g.fillRect(w * 0.1, h * 0.45, w * 0.8, h * 0.05);
    circle(g, w * 0.75, h * 0.82, w * 0.08, '#06d6a0');
  },
  pano(g, w, h) {
    g.fillStyle = '#c8955f';
    g.fillRect(0, 0, w, h);
    const notes = ['#fff59d', '#ffccbc', '#c5e1a5', '#b3e5fc', '#f8bbd0'];
    const r = rng('pano');
    for (let i = 0; i < 6; i++) {
      const x = w * (0.06 + (i % 3) * 0.31) + r() * 10;
      const y = h * (0.1 + Math.floor(i / 3) * 0.45) + r() * 8;
      g.save();
      g.translate(x + w * 0.13, y + h * 0.17);
      g.rotate((r() - 0.5) * 0.2);
      g.fillStyle = notes[i % notes.length];
      g.fillRect(-w * 0.12, -h * 0.17, w * 0.24, h * 0.34);
      g.fillStyle = '#9e9e9e';
      for (let l = 0; l < 3; l++) g.fillRect(-w * 0.09, -h * 0.08 + l * h * 0.07, w * 0.18, 2);
      circle(g, 0, -h * 0.14, 4, '#ef476f');
      g.restore();
    }
  },
  belge(g, w, h) {
    g.fillStyle = '#fffaf0';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a227';
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    text(g, 'BAŞARI', w / 2, h * 0.28, w * 0.13, '#8a6a00', 900);
    text(g, 'BELGESİ', w / 2, h * 0.42, w * 0.09, '#8a6a00', 800);
    text(g, '50 saat çalıştı', w / 2, h * 0.6, w * 0.07, '#5a4a2a', 600);
    star(g, w / 2, h * 0.8, w * 0.08, '#ffcf3f');
  },
};

/** Resimlerin en/boy oranı: genişlik w karo için (yükseklik ~0.7 karo) */
export const ART_HEIGHT = 0.7;

export function artTexture(art: string, w: number): CanvasTexture | null {
  const draw = ART[art];
  if (!draw) return null;
  return texture(`art:${art}`, Math.round(256 * w), Math.round(256 * ART_HEIGHT), draw);
}

/** Saat yüzü: akrep ve yelkovan gerçek saati gösterir (dakikada bir yeniden çizilir) */
export function clockTexture(): CanvasTexture {
  const key = 'art:saat';
  let t = cache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    cache.set(key, t);
  }
  const g = (t.image as HTMLCanvasElement).getContext('2d')!;
  const now = new Date();
  g.clearRect(0, 0, 256, 256);
  circle(g, 128, 128, 120, '#ffffff');
  g.strokeStyle = '#2b2d42';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    circle(g, 128 + Math.sin(a) * 95, 128 - Math.cos(a) * 95, i % 3 ? 4 : 8, '#2b2d42');
  }
  const hand = (a: number, len: number, wdt: number, c: string) => {
    g.strokeStyle = c;
    g.lineWidth = wdt;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
    g.stroke();
  };
  const m = now.getMinutes();
  hand(((now.getHours() % 12) + m / 60) * (Math.PI / 6), 55, 10, '#2b2d42');
  hand(m * (Math.PI / 30), 85, 6, '#ef476f');
  circle(g, 128, 128, 8, '#2b2d42');
  t.needsUpdate = true;
  return t;
}

// ---------- Kaplama desenleri ----------
/** Zemin/duvar dokusu: bir karo (zemin) ya da bir karo genişliğinde duvar şeridi için */
export function patternTexture(pattern: string | undefined, c1: string, c2: string, kind: 'floor' | 'wall'): CanvasTexture {
  const S = 128;
  return texture(`pat:${kind}:${pattern ?? 'checker'}:${c1}:${c2}`, S, kind === 'wall' ? S * 2 : S, (g, w, h) => {
    g.fillStyle = c1;
    g.fillRect(0, 0, w, h);
    const p = pattern ?? (kind === 'floor' ? 'checker' : 'plain');
    const r = rng(`desen:${p}`);
    if (p === 'checker') {
      g.fillStyle = c2;
      g.fillRect(0, 0, w / 2, h / 2);
      g.fillRect(w / 2, h / 2, w / 2, h / 2);
    } else if (p === 'plank') {
      g.fillStyle = c2;
      for (let i = 0; i < 4; i++) {
        g.fillRect(0, (i * h) / 4, w, 2);
        g.fillRect(((i * 37) % 4) * (w / 4) + w / 8, (i * h) / 4, 2, h / 4);
      }
    } else if (p === 'marble') {
      g.strokeStyle = c2;
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(r() * w, 0);
        g.bezierCurveTo(r() * w, h * 0.3, r() * w, h * 0.7, r() * w, h);
        g.stroke();
      }
      g.fillStyle = c2;
      g.fillRect(0, 0, w, 1);
      g.fillRect(0, 0, 1, h);
    } else if (p === 'stars') {
      for (let i = 0; i < (kind === 'wall' ? 6 : 3); i++) star(g, r() * w, r() * h, 4 + r() * 5, '#fff6c8');
      for (let i = 0; i < 8; i++) circle(g, r() * w, r() * h, 1, '#ffffff');
    } else if (p === 'clouds') {
      for (let i = 0; i < 2; i++) {
        const x = r() * w;
        const y = h * (0.2 + i * 0.4);
        circle(g, x, y, 14, c2);
        circle(g, x + 14, y - 6, 16, c2);
        circle(g, x + 28, y, 13, c2);
      }
    } else if (p === 'stripes') {
      g.fillStyle = c2;
      for (let i = 0; i < 4; i++) g.fillRect((i * w) / 4, 0, w / 8, h);
    } else if (p === 'dots') {
      for (let y = 0; y < 4 * (h / w); y++) for (let x = 0; x < 4; x++) circle(g, (x + (y % 2) * 0.5 + 0.25) * (w / 4), (y + 0.5) * (w / 4), 6, c2);
    } else if (p === 'brick') {
      g.fillStyle = c2;
      const bh = h / 8;
      for (let y = 0; y < 8; y++) {
        g.fillRect(0, y * bh, w, 2);
        const off = y % 2 ? w / 4 : 0;
        for (let x = off; x < w; x += w / 2) g.fillRect(x, y * bh, 2, bh);
      }
    } else if (p === 'tiles') {
      g.fillStyle = c2;
      for (let i = 0; i <= 4; i++) {
        g.fillRect((i * w) / 4 - 1, 0, 2, h);
        g.fillRect(0, (i * h) / 4 - 1, w, 2);
      }
    } else if (p === 'sand') {
      for (let i = 0; i < 90; i++) circle(g, r() * w, r() * h, 1 + r() * 1.2, c2);
    } else if (p === 'grass') {
      g.strokeStyle = c2;
      g.lineWidth = 2;
      for (let i = 0; i < 40; i++) {
        const x = r() * w;
        const y = r() * h;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 4, y - 5 - r() * 4);
        g.stroke();
      }
    } else if (p === 'waves') {
      g.strokeStyle = c2;
      g.lineWidth = 4;
      for (let y = h / 8; y < h; y += h / 4) {
        g.beginPath();
        for (let x = 0; x <= w; x += 4) g.lineTo(x, y + Math.sin((x / w) * Math.PI * 4) * 6);
        g.stroke();
      }
    } else if (p === 'hearts') {
      g.fillStyle = c2;
      for (let y = 0; y < 4 * (h / w); y++)
        for (let x = 0; x < 3; x++) {
          const cx = (x + (y % 2) * 0.5 + 0.25) * (w / 3);
          const cy = (y + 0.5) * (w / 4);
          circle(g, cx - 4, cy, 5, c2);
          circle(g, cx + 4, cy, 5, c2);
          g.beginPath();
          g.moveTo(cx - 9, cy + 1);
          g.lineTo(cx, cy + 11);
          g.lineTo(cx + 9, cy + 1);
          g.fill();
        }
    } else if (p === 'panel') {
      g.fillStyle = c2;
      g.fillRect(0, h * 0.55, w, h * 0.45);
      g.fillStyle = '#ffffff33';
      g.fillRect(0, h * 0.55, w, 3);
      g.fillStyle = c1;
      g.fillRect(w * 0.15, h * 0.62, w * 0.7, h * 0.3);
    }
  }, true);
}

// ---------- Pencereden görünen dış dünya ----------
const SKY: Record<string, [string, string]> = {
  sabah: ['#ffe2bd', '#bfe3ff'],
  gunduz: ['#bfe8ff', '#8fd0ff'],
  aksam: ['#ffc58f', '#f2876c'],
  gece: ['#24336b', '#0e1430'],
};

/**
 * Pencerenin camı: gerçek saate göre gökyüzü (sabah, gündüz, akşam, gece), güneş ya da ay ve yıldızlar,
 * arazinin çimeni, bahçe çiti ve uzakta ağaçlar ya da dağlar. Vakit ve arazi başına bir kez çizilir.
 */
export function windowTexture(phase: string, ground: string, scenery: string): CanvasTexture {
  return texture(`pencere:${phase}:${ground}:${scenery}`, 128, 128, (g, w, h) => {
    const night = phase === 'gece';
    const [a, b] = SKY[phase] ?? SKY.gunduz;
    const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, b);
    sky.addColorStop(1, a);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const r = rng(`pencere:${scenery}`);
    if (night) {
      for (let i = 0; i < 18; i++) circle(g, r() * w, r() * h * 0.55, r() < 0.2 ? 1.6 : 0.9, '#ffffff');
      circle(g, w * 0.74, h * 0.2, 11, '#fff6d8');
      circle(g, w * 0.78, h * 0.17, 9, b);
    } else {
      circle(g, w * 0.76, phase === 'aksam' ? h * 0.48 : phase === 'sabah' ? h * 0.36 : h * 0.18, 12, phase === 'aksam' ? '#ffd27a' : '#fff4c2');
      g.fillStyle = '#ffffffcc';
      for (let i = 0; i < 2; i++) {
        const x = r() * w * 0.6;
        const y = h * (0.12 + i * 0.16);
        circle(g, x, y, 7, '#ffffffcc');
        circle(g, x + 8, y - 3, 8, '#ffffffcc');
        circle(g, x + 16, y, 6, '#ffffffcc');
      }
    }
    // Uzakta dağlar ya da ağaç sırası
    const far = night ? '#2a3a5a' : scenery === 'mountain' ? '#8a97a8' : '#5f9e6a';
    g.fillStyle = far;
    if (scenery === 'mountain') {
      g.beginPath();
      g.moveTo(0, h * 0.62);
      [0.18, 0.3, 0.46, 0.6, 0.8, 1].forEach((x, i) => g.lineTo(w * x, h * (i % 2 ? 0.62 : 0.38)));
      g.lineTo(w, h * 0.7);
      g.lineTo(0, h * 0.7);
      g.fill();
    } else {
      for (let x = -4; x < w + 8; x += 11) circle(g, x + r() * 4, h * 0.62, 7 + r() * 5, far);
    }
    if (scenery === 'lake' || scenery === 'beach') {
      g.fillStyle = night ? '#1d3a66' : '#5cb8f2';
      g.fillRect(0, h * 0.62, w, h * 0.06);
    }
    // Çimen ve bahçe çiti
    const grass = night ? '#2f4a3a' : ground;
    g.fillStyle = grass;
    g.fillRect(0, h * 0.66, w, h * 0.34);
    g.fillStyle = night ? '#5a4a3a' : '#c9a46b';
    g.fillRect(0, h * 0.8, w, 3);
    for (let x = 4; x < w; x += 12) g.fillRect(x, h * 0.74, 3, h * 0.12);
    if (!night) for (let i = 0; i < 6; i++) circle(g, r() * w, h * (0.88 + r() * 0.1), 2, ['#ff8ac2', '#ffd166', '#ffffff'][i % 3]);
  });
}

// ---------- TV ekranı ----------
export interface TvData {
  /** Bugün çalışılan dakika */
  today: number;
  /** Bu haftanın günleri (Pzt…Paz) dakika */
  week: number[];
  streak: number;
  /** Toplam saat (sayaçla) */
  hours: number;
  /** Bu ayın günleri: ağacın rengi ve boyu (0–1); boş gün null */
  month: { label: string; lead: number; days: ({ color: string; size: number; dry: boolean } | null)[] };
}

const tvCache = new Map<string, CanvasTexture>();

/** TV kanalı: 0 → çalışma istatistiğim, 1 → bu ayın ormanı. Veri değişince yeniden çizilir. */
export function tvTexture(channel: number, d: TvData): CanvasTexture {
  const k = `${channel}:${JSON.stringify(d)}`;
  let t = tvCache.get(k);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = channel ? '#123a2a' : '#13213f';
  g.fillRect(0, 0, W, H);
  g.font = '800 15px system-ui, -apple-system, "Segoe UI", sans-serif';
  g.textBaseline = 'top';
  if (channel === 0) {
    g.fillStyle = '#ffd23f';
    g.fillText('📊 Çalışmam', 12, 10);
    g.fillStyle = '#ffffff';
    g.font = '800 30px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillText(`${d.today} dk`, 12, 32);
    g.font = '700 13px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillStyle = '#b9c8ff';
    g.fillText('bugün', 14, 66);
    g.fillText(`🔥 ${d.streak} gün seri`, 150, 34);
    g.fillText(`⏱ ${d.hours} saat`, 150, 54);
    const max = Math.max(60, ...d.week);
    const days = ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'];
    d.week.forEach((m, i) => {
      const x = 16 + i * 33;
      const bh = Math.max(3, (m / max) * 52);
      g.fillStyle = m ? '#6ee7a8' : '#2e3d63';
      g.fillRect(x, 140 - bh, 22, bh);
      g.fillStyle = '#b9c8ff';
      g.fillText(days[i], x + 7, 143);
    });
  } else {
    g.fillStyle = '#ffd23f';
    g.fillText(`🌳 ${d.month.label}`, 12, 10);
    const cell = 18;
    d.month.days.forEach((day, i) => {
      const j = i + d.month.lead;
      const x = 18 + (j % 7) * (cell + 14);
      const y = 36 + Math.floor(j / 7) * (cell + 3);
      g.fillStyle = '#1d5a40';
      g.fillRect(x - 1, y - 1, cell + 2, cell + 2);
      if (!day) return;
      circle(g, x + cell / 2, y + cell / 2, 3 + day.size * 6, day.dry ? '#a8987e' : day.color);
    });
  }
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (tvCache.size > 12) {
    const first = tvCache.keys().next().value!;
    tvCache.get(first)?.dispose();
    tvCache.delete(first);
  }
  tvCache.set(k, t);
  return t;
}
