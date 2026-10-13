// Ormanda gezinti: çocuk kendi karakteriyle adada yürür. Buradaki her şey saf mantık (çarpışma,
// yön, günlük yıldızlar, yerleştirme); 3D sahne components/forest3d/Explore.tsx içinde. Toplanan yıldızlar
// deftere yazılır (economy.ts) ve yalnızca küçük süsleri alır.
import { CELLS } from './forest';
import { cellPosition, GRID_HALF, ringPoint, rng, type IslandLayout } from './island';
import type { ForestTree } from './types';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Karakterin çarpışma yarıçapı */
export const PLAYER_R = 0.25;
/** Adanın kıyısında görünmez duvar: kenardan bu kadar içeride */
export const EDGE = 0.45;

/** Adaya yerleştirilmiş eşya: konum, kapladığı yer, üzerinden yürünür mü */
export interface PlacedSpot {
  x: number;
  z: number;
  r: number;
  walk?: boolean;
}

/** Üzerinden geçilemeyen şeyler. Çimen, çiçek, mantar, çalı, fidan, solgun fidan ve yolların içinden geçilir. */
export function obstacles(trees: ForestTree[], layout: IslandLayout, placed: PlacedSpot[] = []): Circle[] {
  const out: Circle[] = [];
  for (const t of trees) {
    if (t.stage < 2) continue;
    const [x, z] = cellPosition(t.cell);
    out.push({ x, z, r: [0.2, 0.25, 0.3][t.stage - 2] ?? 0.3 });
  }
  for (const d of layout.decor) {
    const r = d.kind === 'rock' ? 0.4 : d.kind === 'stone' ? 0.22 : d.kind === 'log' ? 0.3 : d.kind === 'stump' ? 0.18 : 0;
    if (r) out.push({ x: d.x, z: d.z, r: r * d.scale });
  }
  if (layout.pond) out.push({ ...layout.pond, r: layout.pond.r + 0.05 });
  if (layout.campfire) out.push({ ...layout.campfire, r: 0.35 });
  for (const p of placed) if (!p.walk) out.push({ x: p.x, z: p.z, r: p.r * 0.8 });
  return out;
}

/** Eşya buraya konabilir mi: ızgaraya girmez, kıyıdan taşmaz, başka bir şeyin üstüne binmez. */
export function canPlace(x: number, z: number, r: number, radius: number, taken: Circle[]): boolean {
  if (Math.hypot(x, z) > radius - EDGE - r * 0.6) return false;
  const pad = GRID_HALF + r * 0.6;
  if (Math.abs(x) < pad && Math.abs(z) < pad) return false;
  return !taken.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r * 0.8);
}

/** İstenen yere gitmeyi dener; engellere girerse dışına itilir (kenarı boyunca kayar), kıyıdan düşmez. */
export function resolveMove(from: [number, number], to: [number, number], obs: Circle[], radius: number): [number, number] {
  let [x, z] = to;
  for (let pass = 0; pass < 3; pass++) {
    for (const c of obs) {
      const min = c.r + PLAYER_R;
      let dx = x - c.x;
      let dz = z - c.z;
      let d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-6) {
        // Tam merkezdeyse geldiği yöne doğru it
        dx = from[0] - c.x;
        dz = from[1] - c.z;
        d = Math.hypot(dx, dz) || 1;
        if (!dx && !dz) dx = 1;
      }
      x = c.x + (dx / d) * min;
      z = c.z + (dz / d) * min;
    }
  }
  const max = radius - EDGE;
  const r = Math.hypot(x, z);
  if (r > max) {
    x *= max / r;
    z *= max / r;
  }
  return [x, z];
}

/** Kameranın baktığı yöne göre hareket: ix sağa, iy ileri (-1…1). Kamera karakterin yaw yönünde arkada durur. */
export function moveDir(ix: number, iy: number, yaw: number): [number, number] {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let dx = rx * ix + fx * iy;
  let dz = rz * ix + fz * iy;
  const m = Math.hypot(dx, dz);
  if (m > 1) {
    dx /= m;
    dz /= m;
  }
  return [dx, dz];
}

/** Konuma en yakın şey (en fazla max uzaklıkta) */
export function nearest<T extends { x: number; z: number }>(pos: [number, number], items: T[], max: number): T | null {
  let best: T | null = null;
  let bestD = max;
  for (const it of items) {
    const d = Math.hypot(it.x - pos[0], it.z - pos[1]);
    if (d <= bestD) {
      best = it;
      bestD = d;
    }
  }
  return best;
}

export const STAR_COUNT = 8;
/** Bu kadar yakına gelince yıldız toplanır */
export const STAR_REACH = 0.6;

/** Günün yıldızları: tarihe göre sabit konumlar; yarısı ızgaranın boş hücrelerinde, yarısı kıyıda. */
export function dailyStars(date: string, trees: ForestTree[], layout: IslandLayout, radius: number): { x: number; z: number }[] {
  const rand = rng(`yildiz:${date}`);
  const avoid: Circle[] = obstacles(trees, layout).map((c) => ({ ...c, r: c.r + 0.35 }));
  const used = new Set(trees.map((t) => t.cell));
  const out: { x: number; z: number }[] = [];
  const free = Array.from({ length: CELLS }, (_, c) => c).filter((c) => !used.has(c));
  for (let i = 0; i < STAR_COUNT / 2 && free.length; i++) {
    const cell = free.splice(Math.floor(rand() * free.length), 1)[0];
    const [x, z] = cellPosition(cell);
    out.push({ x, z });
  }
  while (out.length < STAR_COUNT) {
    const pt = ringPoint(rand, radius - EDGE, [...avoid, ...out.map((s) => ({ ...s, r: 1 }))]);
    if (!pt) break;
    out.push({ x: pt[0], z: pt[1] });
  }
  return out;
}
