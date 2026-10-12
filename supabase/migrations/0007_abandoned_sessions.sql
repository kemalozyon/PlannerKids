-- Yarıda bırakılan sayaç oturumları: adada solgun bir fidan bırakır. Aynı gün, iptalden sonra
-- en az 10 dk çalışılırsa fidan canlanır (hesap istemcide: src/lib/wilt.ts). 5 dk'dan kısa iptaller kaydedilmez.

create table if not exists public.abandoned_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,                                           -- sayacın başladığı gün
  minutes     integer not null check (minutes between 1 and 1440),     -- iptale kadar geçen süre
  created_at  timestamptz not null default now()
);
create index if not exists abandoned_sessions_user_date_idx on public.abandoned_sessions (user_id, date);

alter table public.abandoned_sessions enable row level security;

drop policy if exists "own rows" on public.abandoned_sessions;
create policy "own rows" on public.abandoned_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
