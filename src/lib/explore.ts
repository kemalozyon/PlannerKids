// "Yakından gez" (üçüncü şahıs gezinti) için saf mantık. Bahçe karo ızgarasıdır (world.ts): karakter
// yürünemeyen karolara (ağaç, ev, su, tepe, eşya) giremez, kenarlarından kayarak geçer.
import { STARS_PER_DAY } from './economy';
import { rng } from './rng';
import { key, type Step } from './world';

/** Karakterin yarıçapı (karo = 1) */
export const PLAYER_R = 0.25;

/** (x, z) noktası, çevresindeki PLAYER_R'lik kutuyla birlikte boş karolarda mı */
export function standable(x: number, z: number, blocked: Set<string>, w: number, h: number): boolean {
  for (const [dx, dz] of [
    [-PLAYER_R, -PLAYER_R],
    [PLAYER_R, -PLAYER_R],
    [-PLAYER_R, PLAYER_R],
    [PLAYER_R, PLAYER_R],
  ]) {
    const tx = Math.floor(x + dx);
    const tz = Math.floor(z + dz);
    if (tx < 0 || tz < 0 || tx >= w || tz >= h || blocked.has(key(tx, tz))) return false;
  }
  return true;
}

/** Karakterin kutusunun köşeleri bir karodan ötekine geçerken kenar (duvar, çit) engelliyor mu */
function crosses(from: [number, number], to: [number, number], step?: Step): boolean {
  if (!step) return true;
  for (const [dx, dz] of [
    [-PLAYER_R, -PLAYER_R],
    [PLAYER_R, -PLAYER_R],
    [-PLAYER_R, PLAYER_R],
    [PLAYER_R, PLAYER_R],
  ]) {
    const a = { x: Math.floor(from[0] + dx), y: Math.floor(from[1] + dz) };
    const b = { x: Math.floor(to[0] + dx), y: Math.floor(to[1] + dz) };
    if (a.x === b.x && a.y === b.y) continue;
    // Çapraz geçişte iki yoldan biri açık olmalı
    const ok = a.x !== b.x && a.y !== b.y ? (step(a, { x: b.x, y: a.y }) && step({ x: b.x, y: a.y }, b)) || (step(a, { x: a.x, y: b.y }) && step({ x: a.x, y: b.y }, b)) : step(a, b);
    if (!ok) return false;
  }
  return true;
}

/**
 * Hareket: önce tamamı, olmazsa yalnızca x ya da yalnızca z (duvara sürtünerek kayma).
 * `step` verilirse bölgeler arası (oda → bahçe) yalnızca kapıdan geçilir (worldPlan.ts → canStep).
 */
export function resolveMove(from: [number, number], to: [number, number], blocked: Set<string>, w: number, h: number, step?: Step): [number, number] {
  const ok = (p: [number, number]) => standable(p[0], p[1], blocked, w, h) && crosses(from, p, step);
  if (ok(to)) return to;
  if (ok([to[0], from[1]])) return [to[0], from[1]];
  if (ok([from[0], to[1]])) return [from[0], to[1]];
  return from;
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

export const STAR_COUNT = STARS_PER_DAY;
/** Bu kadar yakına gelince yıldız toplanır */
export const STAR_REACH = 0.6;

/** Günün yıldızları: tarihe ve alana göre sabit, alanın boş karolarında */
export function dailyStars(date: string, space: string, size: { w: number; h: number }, blocked: Set<string>): { x: number; z: number }[] {
  const rand = rng(`yildiz:${date}:${space}`);
  const free: [number, number][] = [];
  for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) if (!blocked.has(key(x, y))) free.push([x, y]);
  const out: { x: number; z: number }[] = [];
  while (out.length < STAR_COUNT && free.length) {
    const [x, y] = free.splice(Math.floor(rand() * free.length), 1)[0];
    out.push({ x: x + 0.5, z: y + 0.5 });
  }
  return out;
}
