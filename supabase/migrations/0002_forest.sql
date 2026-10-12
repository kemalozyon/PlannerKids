-- Orman: her günün çalışma dakikaları o günün parası; çocuk bu parayla bitki alıp o ayın ormanına diker.
-- Fiyatlar istemcide (src/lib/forest.ts → STAGES): 30 tohum, 60 çiçek, 90 küçük, 120 büyük, 180 dev.
-- Harcama kontrolü: bir günün bitkilerinin toplam fiyatı o günün dakikalarını aşamaz (aşağıdaki tetikleyici).

create table if not exists public.forest_trees (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,                       -- hangi günün parasıyla alındı
  stage       smallint not null check (stage between 0 and 4),   -- 0 tohum … 4 dev ağaç
  species     text not null,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  cell        smallint not null check (cell between 0 and 63),     -- 8x8 ızgara
  created_at  timestamptz not null default now(),
  unique (user_id, month, cell)     -- bir hücrede tek bitki
);

alter table public.forest_trees enable row level security;

drop policy if exists "own rows" on public.forest_trees;
create policy "own rows" on public.forest_trees for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Bütçe kontrolü: istemci hilesine karşı sunucuda da doğrula.
create or replace function public.forest_price(stage smallint) returns integer
language sql immutable as $$ select (array[30, 60, 90, 120, 180])[stage + 1] $$;

create or replace function public.forest_check_budget() returns trigger
language plpgsql as $$
declare
  earned integer;
  spent  integer;
begin
  select coalesce(sum(duration_minutes), 0) into earned
    from public.study_logs where user_id = new.user_id and date = new.date;
  select coalesce(sum(public.forest_price(stage)), 0) into spent
    from public.forest_trees where user_id = new.user_id and date = new.date and id <> new.id;
  if spent + public.forest_price(new.stage) > earned then
    raise exception 'Bu günün dakikaları yetmiyor (kalan: % dk)', earned - spent;
  end if;
  return new;
end $$;

drop trigger if exists forest_budget on public.forest_trees;
create trigger forest_budget before insert or update of stage, date on public.forest_trees
  for each row execute function public.forest_check_budget();
