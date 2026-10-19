-- Mantar pano (NOTES davranışlı duvar süsü): çocuğun kendi hatırlatıcı notları. Panoda son 6 not görünür.
-- Elmas ya da başka bir şey kazandırmaz; yalnızca çocuğun kendi satırları (RLS "own rows"). En fazla 30 not.

create table if not exists public.board_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text        text not null check (char_length(btrim(text)) between 1 and 120),
  color       smallint not null default 0 check (color between 0 and 4),
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists board_notes_user_created_idx on public.board_notes (user_id, created_at);

alter table public.board_notes enable row level security;
drop policy if exists "own rows" on public.board_notes;
create policy "own rows" on public.board_notes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Panoya en fazla 30 not (types.ts → BOARD_MAX)
create or replace function public.board_notes_limit() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('board_notes:' || new.user_id::text));
  if (select count(*) from public.board_notes where user_id = new.user_id) >= 30 then
    raise exception 'Pano doldu';
  end if;
  return new;
end $$;

drop trigger if exists board_notes_limit on public.board_notes;
create trigger board_notes_limit before insert on public.board_notes
  for each row execute function public.board_notes_limit();
