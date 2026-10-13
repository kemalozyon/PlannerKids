// Kitaplık: kodla çizilen ahşap raflar ve üstünde bitirilen kitaplar. Her kitap bir kutu (renk book.color,
// boyu ve kalınlığı kitaptan tohumlanır); sırtında adı yazar (bütün sırtlar tek bir tuval atlasında).
// Kitaba dokununca kitap kartı açılır. Kütüphane odasının gömme rafları ve "kitaplık" eşyaları bunu kullanır.
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { inkOn } from '../../lib/reading';
import { rng } from '../../lib/rng';
import type { Book } from '../../lib/types';
import { isTap } from './light';

/** Raf katı sayısı ve bir karoya sığan kitap */
export const LEVELS = 4;
export const PER_TILE = 6;
const HEIGHT = 1.7;
const DEPTH = 0.36;
const WOOD = '#a8743f';
const WOOD_DARK = '#7a5230';

/** w karo genişliğindeki bir kitaplığa sığan kitap */
export const capacity = (w: number) => w * PER_TILE * LEVELS;

interface Placed {
  book: Book;
  x: number;
  y: number;
  w: number;
  h: number;
  lean: number;
}

/** Raf bölmelerinin doldurulma sırası: göz hizasındaki kattan başlar, karolara yayılır */
function sectionOrder(w: number): { tile: number; level: number }[] {
  const out: { tile: number; level: number }[] = [];
  for (const level of [1, 2, 0, 3]) for (let i = 0; i < w; i++) out.push({ tile: i, level });
  return out;
}

/** Kitapları raflara dizer: bölme bölme (her bölmede en az 3 kitap, hepsi sığmazsa doldura doldura) */
function layout(books: Book[], w: number): Placed[] {
  const shelfH = (HEIGHT - 0.12) / LEVELS;
  const sections = sectionOrder(w);
  const chunk = Math.min(PER_TILE, Math.max(5, Math.ceil(books.length / sections.length)));
  const out: Placed[] = [];
  let i = 0;
  for (const sec of sections) {
    let x = -w / 2 + sec.tile + 0.06;
    const top = HEIGHT - 0.06 - sec.level * shelfH;
    for (let k = 0; k < chunk && i < books.length; k++, i++) {
      const book = books[i];
      const r = rng(`kitap:${book.id}`);
      const bw = 0.1 + r() * 0.05;
      const bh = shelfH * (0.74 + r() * 0.2);
      out.push({ book, x: x + bw / 2, y: top - shelfH + 0.03 + bh / 2, w: bw, h: bh, lean: k === chunk - 1 && r() < 0.5 ? -0.18 : 0 });
      x += bw + 0.004;
    }
    if (i >= books.length) break;
  }
  // Hepsi sığmadıysa kalanlar bölmeleri tam doldurarak dizilir
  if (i < books.length) return layoutFull(books, w);
  return out;
}

function layoutFull(books: Book[], w: number): Placed[] {
  const shelfH = (HEIGHT - 0.12) / LEVELS;
  const out: Placed[] = [];
  let i = 0;
  for (const sec of sectionOrder(w)) {
    let x = -w / 2 + sec.tile + 0.05;
    const top = HEIGHT - 0.06 - sec.level * shelfH;
    while (i < books.length) {
      const r = rng(`kitap:${books[i].id}`);
      const bw = 0.1 + r() * 0.04;
      if (x + bw > -w / 2 + sec.tile + 0.95) break;
      const bh = shelfH * (0.7 + r() * 0.22);
      out.push({ book: books[i], x: x + bw / 2, y: top - shelfH + 0.03 + bh / 2, w: bw, h: bh, lean: 0 });
      x += bw + 0.004;
      i++;
    }
  }
  return out;
}

/** Bütün sırtların atlası: her kitaba bir sütun */
function useSpineAtlas(placed: Placed[]) {
  const atlas = useMemo(() => {
    if (!placed.length) return null;
    const cw = 40;
    const chh = 256;
    const c = document.createElement('canvas');
    c.width = cw * placed.length;
    c.height = chh;
    const g = c.getContext('2d')!;
    placed.forEach((p, i) => {
      const x = i * cw;
      g.fillStyle = p.book.color;
      g.fillRect(x, 0, cw, chh);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x, 18, cw, 4);
      g.fillRect(x, chh - 22, cw, 4);
      g.save();
      g.translate(x + cw / 2, chh / 2);
      g.rotate(-Math.PI / 2);
      g.fillStyle = inkOn(p.book.color);
      g.font = '700 22px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const title = p.book.title.length > 18 ? p.book.title.slice(0, 17) + '…' : p.book.title;
      g.fillText(title, 0, 0, chh - 50);
      g.restore();
    });
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [placed]);
  useEffect(() => () => atlas?.dispose(), [atlas]);
  return atlas;
}

/**
 * Raflar ve kitaplar. Yerel koordinat: (0,0,0) kitaplığın ön alt ortası, arka yüzü z = -DEPTH; önü +z'ye bakar.
 */
export function Bookcase({ w, books, onBook, onShelf }: { w: number; books: Book[]; onBook?: (b: Book) => void; onShelf?: () => void }) {
  const placed = useMemo(() => layout(books, w), [books, w]);
  const atlas = useSpineAtlas(placed);
  const textures = useMemo(
    () =>
      atlas
        ? placed.map((_, i) => {
            const t = atlas.clone();
            t.repeat.set(1 / placed.length, 1);
            t.offset.set(i / placed.length, 0);
            t.needsUpdate = true;
            return t;
          })
        : [],
    [atlas, placed],
  );
  const shelfH = (HEIGHT - 0.12) / LEVELS;
  const click = (e: ThreeEvent<MouseEvent>, f?: () => void) => {
    if (!f || !isTap(e)) return;
    e.stopPropagation();
    f();
  };
  return (
    <group onClick={(e) => click(e, onShelf)}>
      {/* Arkalık, yanlar, raflar */}
      <mesh position={[0, HEIGHT / 2, -DEPTH + 0.015]} castShadow receiveShadow>
        <boxGeometry args={[w, HEIGHT, 0.03]} />
        <meshStandardMaterial color={WOOD_DARK} flatShading />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.03), HEIGHT / 2, -DEPTH / 2]} castShadow>
          <boxGeometry args={[0.06, HEIGHT, DEPTH]} />
          <meshStandardMaterial color={WOOD} flatShading />
        </mesh>
      ))}
      {Array.from({ length: LEVELS + 1 }, (_, i) => (
        <mesh key={i} position={[0, HEIGHT - 0.03 - i * shelfH, -DEPTH / 2]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.04, DEPTH]} />
          <meshStandardMaterial color={WOOD} flatShading />
        </mesh>
      ))}
      {/* Ara bölmeler (her karoda bir) */}
      {Array.from({ length: w - 1 }, (_, i) => (
        <mesh key={`b${i}`} position={[-w / 2 + i + 1, HEIGHT / 2, -DEPTH / 2]}>
          <boxGeometry args={[0.03, HEIGHT - 0.08, DEPTH - 0.02]} />
          <meshStandardMaterial color={WOOD} flatShading />
        </mesh>
      ))}
      {placed.map((p, i) => (
        <group
          key={p.book.id}
          position={[p.x, p.y, -DEPTH / 2 + 0.03]}
          rotation-z={p.lean}
          onClick={(e) => click(e, onBook && (() => onBook(p.book)))}
        >
          <mesh castShadow>
            <boxGeometry args={[p.w, p.h, DEPTH - 0.1]} />
            <meshStandardMaterial color={p.book.color} flatShading />
          </mesh>
          {/* Dokunma alanı: bölmenin bütün yüksekliği (ince sırtı tutturmak zor) */}
          {onBook && (
            <mesh position={[0, (shelfH - p.h) / 2 - 0.02, 0.02]}>
              <boxGeometry args={[p.w + 0.004, shelfH - 0.05, DEPTH]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
          <mesh position={[0, 0, (DEPTH - 0.1) / 2 + 0.001]}>
            <planeGeometry args={[p.w, p.h]} />
            <meshStandardMaterial map={textures[i]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Okunmakta olan kitaplar: üst üste yatan küçük bir yığın */
export function ReadingStack({ books, onBook }: { books: Book[]; onBook?: (b: Book) => void }) {
  return (
    <group>
      {books.slice(0, 4).map((b, i) => (
        <mesh
          key={b.id}
          position={[0, 0.03 + i * 0.05, 0]}
          rotation-y={(rng(b.id)() - 0.5) * 0.6}
          castShadow
          onClick={(e) => {
            if (!onBook || !isTap(e)) return;
            e.stopPropagation();
            onBook(b);
          }}
        >
          <boxGeometry args={[0.3, 0.05, 0.22]} />
          <meshStandardMaterial color={b.color} flatShading />
        </mesh>
      ))}
    </group>
  );
}
