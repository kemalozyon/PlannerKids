// Open Library'de kitap arama (ad ya da ISBN): kapak, yazar, sayfa sayısı. Çalışma anında tarayıcıdan
// çağrılır (CORS açık, anahtar gerekmez); bulunamazsa ya da çevrimdışıysa kitap elle eklenir (renkli sırt).
// Kapak adresi yalnızca covers.openlibrary.org (sunucu da bunu denetler: 0013_books_shelf.sql).

export interface FoundBook {
  title: string;
  author: string | null;
  pages: number | null;
  year: number | null;
  isbn: string | null;
  ol_key: string | null;
  cover_url: string | null;
}

interface Doc {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  isbn?: string[];
  first_publish_year?: number;
}

/** "978-975-07-..." gibi bir ISBN mi */
export const isIsbn = (q: string) => /^(97[89])?\d{9}[\dXx]$/.test(q.replace(/[\s-]/g, ''));

export function searchUrl(q: string): string {
  const query = isIsbn(q) ? `isbn:${q.replace(/[\s-]/g, '')}` : q.trim();
  const fields = 'key,title,author_name,cover_i,number_of_pages_median,isbn,first_publish_year';
  return `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=${fields}&limit=8`;
}

export function toFound(d: Doc): FoundBook | null {
  if (!d.title) return null;
  return {
    title: d.title.slice(0, 120),
    author: d.author_name?.[0]?.slice(0, 80) ?? null,
    pages: d.number_of_pages_median && d.number_of_pages_median <= 5000 ? d.number_of_pages_median : null,
    year: d.first_publish_year ?? null,
    isbn: d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0] ?? null,
    ol_key: d.key?.replace('/works/', '').slice(0, 40) ?? null,
    cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
  };
}

export async function searchBooks(q: string, signal?: AbortSignal): Promise<FoundBook[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(searchUrl(q), { signal });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const body = (await res.json()) as { docs?: Doc[] };
  return (body.docs ?? []).map(toFound).filter((b): b is FoundBook => !!b);
}
