-- Kitaplık: kitaplar odadaki kitaplığın raflarında kapaklarıyla durur. Kapak ve yazar Open Library'den
-- (ad ya da ISBN ile aranır); bulunamazsa renkli sırt ve elle yazılan ad. Eklerken "en sevdiğin kısım" notu.
alter table public.books add column if not exists isbn text check (char_length(isbn) <= 20);
alter table public.books add column if not exists ol_key text check (char_length(ol_key) <= 40);
-- Yalnızca Open Library kapak adresi (başka siteden resim çekilmesin)
alter table public.books add column if not exists cover_url text
  check (cover_url is null or cover_url ~ '^https://covers\.openlibrary\.org/b/(id|isbn|olid)/[A-Za-z0-9-]+-[SML]\.jpg$');
alter table public.books add column if not exists favorite_part text check (char_length(favorite_part) <= 300);
