-- Oyun ekonomisi: 💎 kristal (yalnızca ders çalışarak) ve ⭐ yıldız (gezintide toplanır) defteri, dükkân,
-- sahip olunan eşyalar, adaya yerleştirilen yapılar ve görünüş (karakter, aksesuar, arkadaş hayvan).
-- Kurallar istemcide de var: src/lib/economy.ts ve src/lib/catalog.ts. Sayıları birlikte değiştir
-- (src/lib/logic.test.ts bu dosyadaki fiyatların ve sabitlerin istemciyle aynı olduğunu denetler).
--
-- Kazançlar istemcinin yazdığı "taleplerdir"; buradaki tetikleyiciler her talebin kayıtlarla hak edildiğini,
-- harcamaların da bakiyeyi aşmadığını doğrular (orman bütçesindeki forest_check_budget deseni).

-- ---------- Defter ----------
create table if not exists public.crystal_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  currency    text not null check (currency in ('crystal', 'star')),
  -- study: günün dakikaları · plan: tamamlanan planlı gün · book: biten kitap · quest: görev
  -- star: toplanan yıldız · gift: ebeveyn hediyesi · buy: harcama (yalnızca satın alma tetikleyicisi yazar)
  kind        text not null check (kind in ('study', 'plan', 'book', 'quest', 'star', 'gift', 'buy')),
  ref         text not null check (char_length(ref) between 1 and 80),
  amount      integer not null check (amount <> 0),
  note        text check (char_length(note) <= 120),
  created_at  timestamptz not null default now(),
  unique (user_id, currency, kind, ref)
);

-- ---------- Sahip olunan eşyalar ----------
create table if not exists public.owned_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id     text not null check (char_length(item_id) between 1 and 40),
  via         text not null check (via in ('buy', 'chest')),
  ref         text,                                  -- sandıkta haftanın pazartesisi
  created_at  timestamptz not null default now(),
  unique (user_id, via, ref)                         -- bir haftanın sandığı bir kez açılır (buy'da ref boş)
);

-- ---------- Adaya yerleştirilen eşyalar ----------
create table if not exists public.island_placements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  owned_id    uuid not null references public.owned_items(id) on delete cascade,
  x           real not null check (x between -20 and 20),
  z           real not null check (z between -20 and 20),
  rot         real not null default 0,
  created_at  timestamptz not null default now(),
  unique (month, owned_id)
);
create index if not exists island_placements_user_month_idx on public.island_placements (user_id, month);

-- Görünüş: { character, accessory, pets[] }
alter table public.family_settings add column if not exists equipped jsonb;

-- ---------- Kurallar ----------
-- Dükkân fiyatları (catalog.ts'te acquire.kind = 'buy' olanlar). repeat: aynı eşyadan birden fazla alınabilir.
create or replace function public.shop_price(item text, out currency text, out price integer, out repeat boolean)
language sql immutable as $$
  select v.currency, v.price, v.repeat from (values
    ('char:female-e', 'crystal', 80, false),
    ('char:female-a', 'crystal', 100, false),
    ('char:male-c', 'crystal', 120, false),
    ('acc:glasses', 'crystal', 50, false),
    ('acc:sunglasses', 'crystal', 70, false),
    ('pet:cat', 'crystal', 60, false),
    ('pet:dog', 'crystal', 60, false),
    ('pet:pig', 'crystal', 60, false),
    ('pet:beaver', 'crystal', 80, false),
    ('pet:koala', 'crystal', 100, false),
    ('pet:panda', 'crystal', 120, false),
    ('pet:penguin', 'crystal', 120, false),
    ('pet:parrot', 'crystal', 140, false),
    ('yapi:sign', 'crystal', 40, true),
    ('yapi:pot', 'crystal', 40, true),
    ('yapi:campfire', 'crystal', 50, true),
    ('yapi:tent', 'crystal', 60, true),
    ('yapi:canoe', 'crystal', 80, true),
    ('yapi:bed', 'crystal', 90, true),
    ('yapi:bridge', 'crystal', 100, true),
    ('yapi:bigtent', 'crystal', 120, true),
    ('yapi:column', 'crystal', 140, true),
    ('yapi:statue', 'crystal', 160, true),
    ('sus:flowerY', 'star', 3, true),
    ('sus:flowerP', 'star', 3, true),
    ('sus:path', 'star', 4, true),
    ('sus:pathWood', 'star', 4, true),
    ('sus:mushroom', 'star', 5, true),
    ('sus:smallpot', 'star', 6, true),
    ('sus:fence', 'star', 5, true),
    ('sus:fencePlanks', 'star', 8, true),
    ('sus:platform', 'star', 15, true),
    ('freeze', 'crystal', 20, true)
  ) as v(id, currency, price, repeat)
  where v.id = item
$$;

-- Bir günün planı tamamen bitti mi (her dersin çalışılan dakikası planlananı karşılıyor)
create or replace function public.economy_plan_done(uid uuid, d date) returns boolean
language sql stable as $$
  select exists (select 1 from public.study_plans p where p.user_id = uid and p.date = d)
     and not exists (
       select 1 from public.study_plans p
        where p.user_id = uid and p.date = d
          and p.minutes > coalesce((
            select sum(l.duration_minutes) from public.study_logs l
             where l.user_id = uid and l.date = d and l.course_id = p.course_id), 0))
$$;

-- Görev ödülü: ref = '<görev>:<gün ya da haftanın pazartesisi>'
create or replace function public.economy_quest(uid uuid, cur text, r text) returns integer
language plpgsql stable as $$
declare
  q text := split_part(r, ':', 1);
  p date;
  n integer;
begin
  if r !~ '^[a-z0-9]+:\d{4}-\d{2}-\d{2}$' then return 0; end if;
  p := split_part(r, ':', 2)::date;
  if p > current_date + 1 then return 0; end if;          -- +1: istemcinin yerel günü UTC'den ileride olabilir
  if q = 'day30' and cur = 'crystal' then
    select coalesce(sum(duration_minutes), 0) into n from public.study_logs where user_id = uid and date = p;
    return case when n >= 30 then 2 else 0 end;
  elsif q = 'stars5' and cur = 'star' then
    select count(*) into n from public.crystal_ledger
     where user_id = uid and currency = 'star' and kind = 'star' and ref like p::text || ':%';
    return case when n >= 5 then 3 else 0 end;
  end if;
  if extract(isodow from p) <> 1 then return 0; end if;   -- haftalık görevler pazartesiye bağlı
  if q = 'week5days' and cur = 'crystal' then
    select count(distinct date) into n from public.study_logs
     where user_id = uid and date between p and p + 6 and duration_minutes > 0;
    return case when n >= 5 then 5 else 0 end;
  elsif q = 'week3plans' and cur = 'crystal' then
    select count(*) into n from generate_series(p, p + 6, interval '1 day') g where public.economy_plan_done(uid, g::date);
    return case when n >= 3 then 5 else 0 end;
  elsif q = 'week3courses' and cur = 'crystal' then
    select count(distinct course_id) into n from public.study_logs where user_id = uid and date between p and p + 6;
    return case when n >= 3 then 3 else 0 end;
  elsif q = 'weekBook' and cur = 'crystal' then
    select count(*) into n from public.books where user_id = uid and finished_on between p and p + 6;
    return case when n >= 1 then 5 else 0 end;
  end if;
  return 0;
end $$;

-- Bir kazanç satırı için izin verilen en yüksek miktar
create or replace function public.economy_allowed(uid uuid, cur text, k text, r text) returns integer
language plpgsql stable as $$
declare
  d date;
  m integer;
begin
  if k = 'study' and cur = 'crystal' then
    if r !~ '^\d{4}-\d{2}-\d{2}$' then return 0; end if;
    d := r::date;
    if d > current_date + 1 then return 0; end if;
    select coalesce(sum(duration_minutes), 0) into m from public.study_logs where user_id = uid and date = d;
    return least(m / 10, 12);                               -- 10 dk = 1 💎, günde en fazla 12
  elsif k = 'plan' and cur = 'crystal' then
    if r !~ '^\d{4}-\d{2}-\d{2}$' then return 0; end if;
    return case when public.economy_plan_done(uid, r::date) then 3 else 0 end;
  elsif k = 'book' and cur = 'crystal' then
    return case when exists (select 1 from public.books where user_id = uid and id::text = r and finished_on is not null) then 5 else 0 end;
  elsif k = 'quest' then
    return public.economy_quest(uid, cur, r);
  elsif k = 'star' and cur = 'star' then
    if r !~ '^\d{4}-\d{2}-\d{2}:[0-7]$' then return 0; end if;   -- günde 8 yıldız
    return case when split_part(r, ':', 1)::date <= current_date + 1 then 1 else 0 end;
  elsif k = 'gift' and cur = 'crystal' then
    return 50;
  end if;
  return 0;
end $$;

create or replace function public.ledger_check() returns trigger
language plpgsql as $$
declare
  allowed integer;
begin
  if tg_op = 'UPDATE' and (new.user_id, new.currency, new.kind, new.ref) is distinct from (old.user_id, old.currency, old.kind, old.ref) then
    raise exception 'Defter satırının türü değiştirilemez';
  end if;
  if new.kind = 'buy' or (tg_op = 'UPDATE' and old.kind = 'buy') then
    if coalesce(current_setting('economy.buying', true), '') <> 'on' or new.amount >= 0 then
      raise exception 'Harcama yalnızca satın almayla yazılır';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.amount < old.amount then
    raise exception 'Kazanç azaltılamaz';
  end if;
  allowed := public.economy_allowed(new.user_id, new.currency, new.kind, new.ref);
  if new.amount <= 0 or new.amount > allowed then
    raise exception 'Bu kazanç hak edilmemiş (izin verilen: %)', allowed;
  end if;
  return new;
end $$;

drop trigger if exists ledger_check on public.crystal_ledger;
create trigger ledger_check before insert or update on public.crystal_ledger
  for each row execute function public.ledger_check();

-- Satın alma: fiyat sunucudan, bakiye yetmezse ret; yetiyorsa harcama satırı aynı işlemde yazılır.
-- Sandık: haftanın hedefi (5 gün, 150 dk) tuttuysa bir kez.
create or replace function public.owned_check() returns trigger
language plpgsql as $$
declare
  cur text;
  pr integer;
  rep boolean;
  bal integer;
  p date;
  n integer;
  m integer;
begin
  if new.via = 'buy' then
    select s.currency, s.price, s.repeat into cur, pr, rep from public.shop_price(new.item_id) s;
    if pr is null then raise exception 'Bu eşya satılmıyor'; end if;
    -- Aynı anda iki satın alma bakiyeyi iki kez harcamasın
    perform pg_advisory_xact_lock(hashtext('economy:' || new.user_id::text));
    if not rep and exists (select 1 from public.owned_items where user_id = new.user_id and item_id = new.item_id) then
      raise exception 'Bu eşya zaten sende';
    end if;
    select coalesce(sum(amount), 0) into bal from public.crystal_ledger where user_id = new.user_id and currency = cur;
    if bal < pr then
      raise exception 'Bakiye yetmiyor: % lazım, % var', pr, bal;
    end if;
    new.ref := null;
  else
    if new.ref is null or new.ref !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Sandık haftası geçersiz'; end if;
    p := new.ref::date;
    if extract(isodow from p) <> 1 or p > current_date + 1 then raise exception 'Sandık haftası geçersiz'; end if;
    select count(distinct date), coalesce(sum(duration_minutes), 0) into n, m
      from public.study_logs where user_id = new.user_id and date between p and p + 6 and duration_minutes > 0;
    if n < 5 or m < 150 then
      raise exception 'Bu haftanın sandığı henüz açılmadı (% gün, % dk)', n, m;
    end if;
  end if;
  return new;
end $$;

create or replace function public.owned_charge() returns trigger
language plpgsql as $$
declare
  cur text;
  pr integer;
begin
  if new.via = 'buy' then
    select s.currency, s.price into cur, pr from public.shop_price(new.item_id) s;
    perform set_config('economy.buying', 'on', true);
    insert into public.crystal_ledger (user_id, currency, kind, ref, amount, note)
      values (new.user_id, cur, 'buy', new.id::text, -pr, new.item_id);
    perform set_config('economy.buying', 'off', true);
  end if;
  return new;
end $$;

drop trigger if exists owned_check on public.owned_items;
create trigger owned_check before insert on public.owned_items
  for each row execute function public.owned_check();
drop trigger if exists owned_charge on public.owned_items;
create trigger owned_charge after insert on public.owned_items
  for each row execute function public.owned_charge();

-- ---------- Erişim ----------
alter table public.crystal_ledger    enable row level security;
alter table public.owned_items       enable row level security;
alter table public.island_placements enable row level security;

-- Defter: okunur, eklenir, (kazanç artışı için) güncellenir; silinemez — harcama geri alınıp bakiye şişirilmesin.
drop policy if exists "own rows" on public.crystal_ledger;
drop policy if exists "own read" on public.crystal_ledger;
drop policy if exists "own insert" on public.crystal_ledger;
drop policy if exists "own update" on public.crystal_ledger;
create policy "own read" on public.crystal_ledger for select using (user_id = auth.uid());
create policy "own insert" on public.crystal_ledger for insert with check (user_id = auth.uid());
create policy "own update" on public.crystal_ledger for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Eşyalar: okunur ve eklenir (satın alma/sandık); değiştirilmez, silinmez.
drop policy if exists "own read" on public.owned_items;
drop policy if exists "own insert" on public.owned_items;
create policy "own read" on public.owned_items for select using (user_id = auth.uid());
create policy "own insert" on public.owned_items for insert with check (user_id = auth.uid());

drop policy if exists "own rows" on public.island_placements;
create policy "own rows" on public.island_placements for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.owned_items o where o.id = owned_id and o.user_id = auth.uid()));
