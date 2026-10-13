-- Dünyam v2: haritalar, aylık ağaç bahçeleri, masa üstü ve duvar eşyaları, parça parça avatar.
--
-- * Haritalar toplam (güvenilir) çalışma saatiyle açılır (economy_config → world.maps). Ev ve bahçe her
--   haritada büyür. Taşınınca evin alanları (oda, kütüphane, bahçe) boşalır, eşyalar envantere döner;
--   aylık bahçeler kalır. Kullanıcının haritası user_world'de, yalnızca move_map() yazar.
-- * Aylık ağaç bahçeleri: alan kimliği m:YYYY-MM (world.season içinde, günü gelmiş ay). Her günün ekim yeri
--   sabittir (takvim düzeni), oraya eşya konmaz. Ağaçlar kayıtlardan türer, saklanmaz.
-- * Küçük eşya (surface/small) masanın üstüne konabilir; duvar eşyası arka duvarda y = -1, sol duvarda x = -1.
-- * Görünüş (family_settings.equipped → look) ücretli/kilitli parça içeriyorsa sahip olunmalı.
-- Kuralların istemcideki aynısı: src/lib/world.ts, src/lib/avatar.ts. Sonra 0016_config.sql'i çalıştır.

-- ---------- Harita ----------
create table if not exists public.user_world (
  user_id   uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  map       text not null,
  moved_at  timestamptz
);

alter table public.user_world enable row level security;
drop policy if exists "own read" on public.user_world;
create policy "own read" on public.user_world for select using (user_id = auth.uid());

-- Duvara asılan eşyalar
alter table public.item_defs drop constraint if exists item_defs_placement_check;
alter table public.item_defs add constraint item_defs_placement_check check (placement in ('indoor', 'outdoor', 'both', 'wall'));

-- Aylık bahçeler de bir alan
alter table public.user_spaces drop constraint if exists user_spaces_space_check;
alter table public.user_spaces add constraint user_spaces_space_check
  check (space in ('room', 'library', 'garden') or space ~ '^m:\d{4}-(0[1-9]|1[0-2])$');

-- İlerleme: güvenilir dakika (harita), biten kitap, ağaç = çalışılan gün (elle yazılan dahil), harita
drop function if exists public.world_ctx(uuid);
create function public.world_ctx(uid uuid, out minutes integer, out books integer, out trees integer, out map text)
language sql stable as $$
  select coalesce((select sum(duration_minutes) from public.study_logs where user_id = uid and source <> 'manual'), 0)::integer,
         (select count(*) from public.books where user_id = uid and status = 'done')::integer,
         (select count(distinct date) from public.study_logs where user_id = uid and duration_minutes > 0)::integer,
         coalesce((select w.map from public.user_world w where w.user_id = uid), public.economy_cfg() #>> '{world,maps,0,id}')
$$;

create or replace function public.world_map(p_map text) returns jsonb
language sql stable as $$
  select coalesce(
    (select m from jsonb_array_elements(public.economy_cfg() #> '{world,maps}') m where m ->> 'id' = p_map),
    public.economy_cfg() #> '{world,maps,0}')
$$;

-- Alanın ölçüsü: evin alanları haritadan, aylık bahçe sabit
drop function if exists public.world_size(text, integer);
create function public.world_size(p_space text, p_map text, out w integer, out h integer)
language sql stable as $$
  select (s ->> 'w')::integer, (s ->> 'h')::integer from (
    select case when p_space ~ '^m:' then public.economy_cfg() #> '{world,monthGarden}' else public.world_map(p_map) -> p_space end s
  ) x
$$;

-- Zemindeki sabit karolar: haritanın tanımları (kapı, ev, raf…) ya da ayın ekim yerleri ve bahçe kapısı
drop function if exists public.world_fixed(text, integer, integer);
create function public.world_fixed(p_space text, p_map text) returns table (x integer, y integer)
language sql stable as $$
  with c as (select public.economy_cfg() -> 'world' w),
  sz as (select * from public.world_size(p_space, p_map)),
  home as (
    select gx, gy
      from sz, jsonb_array_elements(case when p_space ~ '^m:' then '[]'::jsonb else public.world_map(p_map) -> p_space -> 'fixed' end) f,
           generate_series((f ->> 'x')::integer, least(sz.w, (f ->> 'x')::integer + coalesce((f ->> 'w')::integer, 1)) - 1) gx,
           generate_series((f ->> 'y')::integer, least(sz.h, (f ->> 'y')::integer + coalesce((f ->> 'h')::integer, 1)) - 1) gy
     where (f ->> 'x')::integer >= 0 and (f ->> 'y')::integer >= 0
  ),
  m as (
    select c.w -> 'monthGarden' g,
           extract(isodow from (substr(p_space, 3) || '-01')::date)::integer - 1 lead,
           extract(day from (substr(p_space, 3) || '-01')::date + interval '1 month - 1 day')::integer n
      from c where p_space ~ '^m:'
  ),
  plots as (
    select (g ->> 'x0')::integer + (g ->> 'step')::integer * ((lead + d - 1) % 7) gx,
           (g ->> 'y0')::integer + (g ->> 'step')::integer * ((lead + d - 1) / 7) gy
      from m, generate_series(1, m.n) d
    union all
    select (g #>> '{gate,x}')::integer, (g #>> '{gate,y}')::integer from m
  )
  select gx, gy from home union select gx, gy from plots
$$;

-- Duvarda eşya asılamayan yerler: pencereler, kapıların ve gömme rafların üstü
create or replace function public.world_wall_blocked(p_space text, p_map text) returns setof text
language sql stable as $$
  select z.k
    from jsonb_array_elements(case when p_space in ('room', 'library') then public.world_map(p_map) -> p_space -> 'fixed' else '[]'::jsonb end) f,
    lateral (
      select gx || ',-1' k
        from generate_series((f ->> 'x')::integer, (f ->> 'x')::integer + coalesce((f ->> 'w')::integer, 1) - 1) gx
       where (f ->> 'kind' = 'window' and (f ->> 'y')::integer = -1) or (f ->> 'kind' in ('door', 'shelf') and (f ->> 'y')::integer = 0)
      union all
      select '-1,' || gy
        from generate_series((f ->> 'y')::integer, (f ->> 'y')::integer + coalesce((f ->> 'h')::integer, 1) - 1) gy
       where (f ->> 'kind' = 'window' and (f ->> 'x')::integer = -1) or (f ->> 'kind' = 'door' and (f ->> 'x')::integer = 0)
    ) z
$$;

-- ---------- Yerleşimi kaydet ----------
create or replace function public.save_space(p_space text, p_layout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ctx record;
  sz record;
  fixed text[];
  wallb text[];
  surf text[] := '{}';
  taken text[] := '{}';
  it jsonb;
  def public.item_defs;
  slot text;
  cat text;
  month text;
  indoor boolean := p_space in ('room', 'library');
  px integer;
  py integer;
  rot integer;
  fw integer;
  fh integer;
  gx integer;
  gy integer;
  on_cnt integer;
  cnt integer;
  layer text;
  k text;
  n integer;
  other integer;
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  if p_space is null or not (p_space in ('room', 'library', 'garden') or p_space ~ '^m:\d{4}-(0[1-9]|1[0-2])$') then
    raise exception 'Alan geçersiz';
  end if;
  select * into ctx from public.world_ctx(uid);
  if p_space ~ '^m:' then
    month := substr(p_space, 3);
    if month < public.economy_cfg() #>> '{world,season,from}' or month > public.economy_cfg() #>> '{world,season,to}' then
      raise exception 'Bu ayın bahçesi yok';
    end if;
    -- Saat dilimi farkı için birkaç saat tolerans: yerel gün sunucudan ileride olabilir
    if month > to_char(now() + interval '14 hours', 'YYYY-MM') then raise exception 'Bu ayın bahçesi henüz açılmadı'; end if;
  end if;
  if jsonb_typeof(p_layout) <> 'object' or jsonb_typeof(p_layout -> 'items') <> 'array' or jsonb_array_length(p_layout -> 'items') > 200 then
    raise exception 'Yerleşim geçersiz';
  end if;
  select * into sz from public.world_size(p_space, ctx.map);
  select coalesce(array_agg(f.x || ',' || f.y), '{}') into fixed from public.world_fixed(p_space, ctx.map) f;
  select coalesce(array_agg(b), '{}') into wallb from public.world_wall_blocked(p_space, ctx.map) b;

  -- Kaplamalar (yalnızca odalarda)
  for slot, cat in values ('floor', 'zemin'), ('wall', 'duvar') loop
    if coalesce(p_layout ->> slot, '') <> '' then
      select * into def from public.item_defs where id = p_layout ->> slot;
      if not indoor or def.id is null or def.category <> cat or public.world_owned(uid, def, ctx.minutes, ctx.trees) < 1 then
        raise exception 'Bu kaplama sende yok';
      end if;
    end if;
  end loop;

  -- Yüzeyler: üstüne küçük eşya konabilen eşyaların karoları
  for it in select * from jsonb_array_elements(p_layout -> 'items') loop
    select * into def from public.item_defs where id = it ->> 'item';
    if def.id is null or not coalesce((def.def ->> 'surface')::boolean, false) or def.placement = 'wall'
       or coalesce(it ->> 'x', '') !~ '^-?\d{1,3}$' or coalesce(it ->> 'y', '') !~ '^-?\d{1,3}$' or coalesce(it ->> 'rot', '') !~ '^\d{1,3}$' then
      continue;
    end if;
    rot := (it ->> 'rot')::integer;
    fw := case when rot % 180 = 0 then def.w else def.h end;
    fh := case when rot % 180 = 0 then def.h else def.w end;
    for gx in (it ->> 'x')::integer .. (it ->> 'x')::integer + fw - 1 loop
      for gy in (it ->> 'y')::integer .. (it ->> 'y')::integer + fh - 1 loop
        surf := surf || (gx || ',' || gy);
      end loop;
    end loop;
  end loop;

  -- Eşyalar: tür, alan, yön, sınır, sabit karo, katman ve çakışma
  -- Katmanlar: z zemin (halı, yol), e eşya, u masa üstü, d duvar
  for it in select * from jsonb_array_elements(p_layout -> 'items') loop
    select * into def from public.item_defs where id = it ->> 'item';
    if def.id is null or def.placement is null then raise exception 'Bu eşya yerleştirilemez'; end if;
    if def.placement = 'wall' then
      if not indoor then raise exception 'Duvar süsü yalnızca odalara asılır'; end if;
    elsif def.placement <> 'both' and (not indoor) <> (def.placement = 'outdoor') then
      raise exception '% %', def.def ->> 'name', case when indoor then 'dışarıda durur' else 'içeride durur' end;
    end if;
    if coalesce(it ->> 'x', '') !~ '^-?\d{1,3}$' or coalesce(it ->> 'y', '') !~ '^-?\d{1,3}$' or coalesce(it ->> 'rot', '') !~ '^\d{1,3}$' then
      raise exception 'Yerleşim geçersiz';
    end if;
    px := (it ->> 'x')::integer;
    py := (it ->> 'y')::integer;
    rot := (it ->> 'rot')::integer;
    if def.placement = 'wall' then
      if (px = -1) = (py = -1) or rot <> (case when py = -1 and px >= 0 then 0 else 270 end) then
        raise exception 'Duvar süsü yalnızca duvara asılır';
      end if;
      for i in 0 .. def.w - 1 loop
        gx := case when py = -1 then px + i else -1 end;
        gy := case when py = -1 then -1 else py + i end;
        if gx >= sz.w or gy >= sz.h or gx < -1 or gy < -1 then raise exception 'Duvarın dışına taşıyor'; end if;
        k := gx || ',' || gy;
        if k = any(wallb) then raise exception 'Duvarın bu kısmı boş değil'; end if;
        if ('d' || k) = any(taken) then raise exception 'Duvarın bu kısmı dolu'; end if;
        taken := taken || ('d' || k);
      end loop;
      continue;
    end if;
    if not rot = any(def.rotations) then raise exception 'Bu eşya böyle döndürülemez'; end if;
    fw := case when rot % 180 = 0 then def.w else def.h end;
    fh := case when rot % 180 = 0 then def.h else def.w end;
    on_cnt := 0;
    cnt := 0;
    for gx in px .. px + fw - 1 loop
      for gy in py .. py + fh - 1 loop
        if gx < 0 or gy < 0 or gx >= sz.w or gy >= sz.h then raise exception 'Alanın dışına taşıyor'; end if;
        k := gx || ',' || gy;
        if k = any(fixed) then raise exception 'Bu karo boş değil'; end if;
        cnt := cnt + 1;
        if k = any(surf) then on_cnt := on_cnt + 1; end if;
      end loop;
    end loop;
    layer := case
      when coalesce((def.def ->> 'walk')::boolean, false) then 'z'
      when not coalesce((def.def ->> 'small')::boolean, false) or on_cnt = 0 then 'e'
      when on_cnt = cnt then 'u'
    end;
    if layer is null then raise exception 'Yarısı yüzeyin dışında kalıyor'; end if;
    for gx in px .. px + fw - 1 loop
      for gy in py .. py + fh - 1 loop
        k := layer || gx || ',' || gy;
        if k = any(taken) then raise exception 'Bu karo dolu'; end if;
        taken := taken || k;
      end loop;
    end loop;
  end loop;

  -- Envanter: bu alandaki + diğer alanlardaki adet, sahip olunandan fazla olamaz
  for k, n in select e ->> 'item', count(*) from jsonb_array_elements(p_layout -> 'items') e group by 1 loop
    select * into def from public.item_defs where id = k;
    select count(*) into other from public.user_spaces s, jsonb_array_elements(s.layout -> 'items') e
     where s.user_id = uid and s.space <> p_space and e ->> 'item' = def.id;
    if n + other > public.world_owned(uid, def, ctx.minutes, ctx.trees) then
      raise exception '% envanterinde yok', def.def ->> 'name';
    end if;
  end loop;

  insert into public.user_spaces (user_id, space, layout, updated_at)
    values (uid, p_space, p_layout, now())
    on conflict (user_id, space) do update set layout = excluded.layout, updated_at = now();
  return p_layout;
end $$;

-- ---------- Taşınma ----------
-- Yalnızca ileri ve açılmış haritaya. Evin alanları silinir: eşyalar envantere döner (envanter = sahip olunan − yerleştirilen).
create or replace function public.move_map(p_map text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ctx record;
  target jsonb;
  cur integer;
  nxt integer;
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  select * into ctx from public.world_ctx(uid);
  select m, o into target, nxt from jsonb_array_elements(public.economy_cfg() #> '{world,maps}') with ordinality e(m, o) where m ->> 'id' = p_map;
  if target is null then raise exception 'Harita bulunamadı'; end if;
  select o into cur from jsonb_array_elements(public.economy_cfg() #> '{world,maps}') with ordinality e(m, o) where m ->> 'id' = ctx.map;
  if nxt <= coalesce(cur, 1) then raise exception 'Yalnızca yeni bir haritaya taşınabilirsin'; end if;
  if ctx.minutes < (target ->> 'hours')::integer * 60 then
    raise exception '% için toplam % saat çalışmalısın', target ->> 'name', target ->> 'hours';
  end if;
  delete from public.user_spaces where user_id = uid and space in ('room', 'library', 'garden');
  insert into public.user_world (user_id, map, moved_at) values (uid, p_map, now())
    on conflict (user_id) do update set map = excluded.map, moved_at = excluded.moved_at;
  return p_map;
end $$;

-- ---------- Görünüş ----------
-- Giyilen parça kıyafet olmalı ve sahip olunmalı (ücretsiz, satın alınmış ya da saat/seviye/ağaçla açılmış)
create or replace function public.equipped_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ctx record;
  s text;
  part text;
  def public.item_defs;
begin
  if new.equipped is null or new.equipped -> 'look' is null then return new; end if;
  if tg_op = 'UPDATE' and new.equipped is not distinct from old.equipped then return new; end if;
  select * into ctx from public.world_ctx(new.user_id);
  foreach s in array array['hair', 'top', 'bottom', 'shoes', 'hat', 'glasses', 'back'] loop
    part := new.equipped -> 'look' ->> s;
    if part is null then continue; end if;
    select * into def from public.item_defs where id = part;
    if def.id is null or def.category <> 'kiyafet' or def.def ->> 'slot' <> s then raise exception 'Görünüş geçersiz'; end if;
    if public.world_owned(new.user_id, def, ctx.minutes, ctx.trees) < 1 then raise exception '% sende yok', def.def ->> 'name'; end if;
  end loop;
  return new;
end $$;

drop trigger if exists equipped_check on public.family_settings;
create trigger equipped_check before insert or update on public.family_settings
  for each row execute function public.equipped_check();

-- ---------- Eski kataloğun taşınması ----------
-- Hazır karakterler ve aksesuarlar kalktı, yatak/ayaklı lamba/saksı artık başlangıçta ücretsiz:
-- bunlar için harcanan Elmas geri verilir (aile hediyesi olarak deftere).
do $$
begin
  perform set_config('economy.server', 'on', true);
  insert into public.crystal_ledger (user_id, currency, kind, ref, amount, note)
  select o.user_id, 'crystal', 'gift', 'iade:' || o.id, -l.amount, 'Eski eşya iadesi: ' || o.item_id
    from public.owned_items o
    join public.crystal_ledger l on l.user_id = o.user_id and l.currency = 'crystal' and l.kind = 'buy' and l.ref = o.id::text
   where (o.item_id like 'char:%' or o.item_id like 'acc:%' or o.item_id in ('mob:yatak', 'isik:ayakli', 'bitki:saksi'))
     and l.amount < 0
  on conflict (user_id, currency, kind, ref) do nothing;
  perform set_config('economy.server', 'off', true);
end $$;

-- Yeniden adlandırılan eşyalar (halılar kendi kategorisine, çalı dış mekâna)
update public.owned_items set item_id = 'hali:dikdortgen' where item_id = 'mob:hali';
update public.owned_items set item_id = 'hali:yuvarlak' where item_id = 'mob:hali-yuvarlak';
update public.owned_items set item_id = 'dis:cali' where item_id = 'bitki:cali';
update public.user_spaces
   set layout = replace(replace(replace(layout::text, '"mob:hali"', '"hali:dikdortgen"'), '"mob:hali-yuvarlak"', '"hali:yuvarlak"'), '"bitki:cali"', '"dis:cali"')::jsonb
 where layout::text like any (array['%"mob:hali"%', '%"mob:hali-yuvarlak"%', '%"bitki:cali"%']);
