-- Okuma: kitap listesi, okuma kayıtları, kitap parseli ağaçları, okuma hedefleri.
-- Okuma süresi ormandaki günlük (ders) bitkisine sayılmaz.

create table if not exists public.books (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  author          text,
  pages           integer check (pages between 1 and 5000),
  genre           text,
  recommended_by  text,
  color           text not null default '#4f7cff',
  status          text not null default 'want' check (status in ('want', 'reading', 'done')),
  current_page    integer not null default 0 check (current_page >= 0),
  started_on      date,
  finished_on     date,
  rating          smallint check (rating between 1 and 5),
  fav_character   text,
  review          text,
  created_at      timestamptz not null default now()
);

create table if not exists public.reading_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  date        date not null,
  minutes     integer not null default 0 check (minutes between 0 and 1440),
  pages       integer not null default 0 check (pages >= 0),   -- bu oturumda okunan sayfa
  to_page     integer,                                          -- gelinen sayfa
  created_at  timestamptz not null default now()
);
create index if not exists reading_logs_user_date_idx on public.reading_logs (user_id, date);

create table if not exists public.book_trees (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  cell        smallint not null check (cell between 0 and 63),
  created_at  timestamptz not null default now(),
  unique (user_id, book_id),          -- her kitap bir kez dikilir
  unique (user_id, month, cell)       -- parselde bir hücrede tek ağaç
);

create table if not exists public.reading_goals (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  monthly_books  smallint not null default 2 check (monthly_books between 1 and 30),
  daily_pages    smallint not null default 15 check (daily_pages between 1 and 500),
  updated_at     timestamptz not null default now()
);

alter table public.books         enable row level security;
alter table public.reading_logs  enable row level security;
alter table public.book_trees    enable row level security;
alter table public.reading_goals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['books','reading_logs','book_trees','reading_goals'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all
         using (user_id = auth.uid())
         with check (user_id = auth.uid())', t);
  end loop;
end $$;
