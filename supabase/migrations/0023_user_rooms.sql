-- Dünyam v5: çocuğun eklediği odalar (kilit yok, en çok world.maxRooms, ücretsiz).
--
-- * Odalar artık seriyle açılmaz: user_rooms'ta her kullanıcının kendi odaları (tür, şablon şekil, boyut, ad, sıra).
--   Alan anahtarı r:<id>. Türler economy_config → world.rooms (ad, simge, varsayılan kaplama), şekiller
--   world.roomShapes (Habbo'daki oda modelleri gibi: Kare, L, Basamak…; her biri s/m/l ölçüsünde, `cut` zeminden
--   çıkarılan dikdörtgenler). Arka sıra ve sol sütun hep dolu; kapılar (0,5) batı ve (w-1,5) doğu.
-- * Yazma yalnızca add_room / update_room / delete_room ile (RLS salt okunur). Silinen odanın yerleşimi de silinir:
--   eşyaları envantere döner. Şekil küçülünce sığmayan eşyaları istemci bir kez kaydedip düşürür.
-- * Kesik karolar sabit sayılır (world_fixed): eşya konmaz. save_space 0022'deki gibi, seri kilidi yok.
-- * Eski seri odalarının (kitchen, bedroom, bath, playroom) kayıtlı yerleşimleri odaya dönüşür (Kare, büyük).
-- * Kurallar istemcideki src/lib/world.ts (roomFixed, roomInputProblem) ile aynı. Bu dosyadan önce ya da sonra
--   0024_config.sql'i çalıştır (world.roomShapes orada).

create table if not exists public.user_rooms (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id          text not null check (id ~ '^[a-z0-9]{1,12}$'),
  kind        text not null,
  shape       text not null,
  size        text not null check (size in ('s', 'm', 'l')),
  name        text not null check (char_length(btrim(name)) between 1 and 24),
  pos         integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.user_rooms enable row level security;
drop policy if exists "own read" on public.user_rooms;
create policy "own read" on public.user_rooms for select using (user_id = auth.uid());

-- ---------- Alan anahtarı ----------
alter table public.user_spaces drop constraint if exists user_spaces_space_check;
alter table public.user_spaces add constraint user_spaces_space_check
  check (space in ('room', 'library', 'garden', 'kitchen', 'bedroom', 'bath', 'playroom') or space ~ '^r:[a-z0-9]{1,12}$' or space ~ '^m:\d{4}-(0[1-9]|1[0-2])$');

-- Eski seri odaları → kullanıcının odaları (aynı sırayla), yerleşimleri r:<id>'ye taşınır
insert into public.user_rooms (user_id, id, kind, shape, size, name, pos)
  select s.user_id, s.space, s.space, 'kare', 'l',
         case s.space when 'kitchen' then 'Mutfak' when 'bedroom' then 'Yatak odası' when 'bath' then 'Banyo' else 'Oyun odası' end,
         array_position(array['kitchen', 'bedroom', 'bath', 'playroom'], s.space) - 1
    from public.user_spaces s
   where s.space in ('kitchen', 'bedroom', 'bath', 'playroom')
  on conflict do nothing;
update public.user_spaces set space = 'r:' || space where space in ('kitchen', 'bedroom', 'bath', 'playroom');

alter table public.user_spaces drop constraint user_spaces_space_check;
alter table public.user_spaces add constraint user_spaces_space_check
  check (space in ('room', 'library', 'garden') or space ~ '^r:[a-z0-9]{1,12}$' or space ~ '^m:\d{4}-(0[1-9]|1[0-2])$');

-- ---------- Odanın ölçüsü ve sabitleri ----------
-- Şablonun boyuttaki ölçüsü ({w, h, cut}); bilinmeyen şablon: ilk şablonun küçüğü
create or replace function public.room_cells(p_shape text, p_size text) returns jsonb
language sql stable as $$
  select coalesce(
    (select s -> 'sizes' -> p_size from jsonb_array_elements(public.economy_cfg() #> '{world,roomShapes}') s where s ->> 'id' = p_shape),
    public.economy_cfg() #> '{world,roomShapes,0,sizes,s}')
$$;

-- Oturumdaki kullanıcının odası: {id, kind, w, h, fixed} (kapılar, arka duvarda pencere, kesikler)
create or replace function public.world_room(p_space text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'id', 'r:' || r.id, 'kind', r.kind, 'name', r.name,
           'w', (c ->> 'w')::integer, 'h', (c ->> 'h')::integer,
           'fixed', jsonb_build_array(
                      jsonb_build_object('kind', 'door', 'x', 0, 'y', 5, 'edge', 'w'),
                      jsonb_build_object('kind', 'door', 'x', (c ->> 'w')::integer - 1, 'y', 5, 'edge', 'e'),
                      jsonb_build_object('kind', 'window', 'x', greatest(1, (c ->> 'w')::integer / 2 - 1), 'y', -1, 'w', 2))
                    || coalesce((select jsonb_agg(jsonb_build_object('kind', 'void', 'x', k -> 0, 'y', k -> 1, 'w', k -> 2, 'h', k -> 3))
                                   from jsonb_array_elements(coalesce(c -> 'cut', '[]'::jsonb)) k), '[]'::jsonb))
    from public.user_rooms r, lateral (select public.room_cells(r.shape, r.size) c) x
   where p_space ~ '^r:' and r.user_id = auth.uid() and 'r:' || r.id = p_space
$$;

create or replace function public.world_size(p_space text, p_map text, out w integer, out h integer)
language sql stable as $$
  select case when r is not null then (r ->> 'w')::integer else (s ->> 'w')::integer end,
         case when r is not null then (r ->> 'h')::integer else (s ->> 'h')::integer end
    from (
      select public.world_room(p_space) r,
             case when p_space ~ '^m:' then public.economy_cfg() #> '{world,monthGarden}' else public.world_map(p_map) -> p_space end s
    ) x
$$;

create or replace function public.world_indoor(p_space text) returns boolean
language sql immutable as $$
  select p_space in ('room', 'library') or p_space ~ '^r:'
$$;

-- ---------- Oda ekle / değiştir / sil ----------
create or replace function public.room_input_check(p_kind text, p_shape text, p_size text, p_name text) returns void
language plpgsql stable as $$
begin
  if not exists (select 1 from jsonb_array_elements(public.economy_cfg() #> '{world,rooms}') k where k ->> 'id' = p_kind) then
    raise exception 'Oda türü yok';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.economy_cfg() #> '{world,roomShapes}') s where s ->> 'id' = p_shape) then
    raise exception 'Oda şekli yok';
  end if;
  if p_size is null or p_size not in ('s', 'm', 'l') then raise exception 'Oda boyu yok'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 24 then raise exception 'Odanın adı 1–24 harf olmalı'; end if;
end $$;

create or replace function public.add_room(p_kind text, p_shape text, p_size text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n integer;
  r public.user_rooms;
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform public.room_input_check(p_kind, p_shape, p_size, p_name);
  perform pg_advisory_xact_lock(hashtext('rooms:' || uid::text));
  select count(*) into n from public.user_rooms where user_id = uid;
  if n >= coalesce((public.economy_cfg() #>> '{world,maxRooms}')::integer, 12) then
    raise exception 'En çok % oda eklenebilir', coalesce((public.economy_cfg() #>> '{world,maxRooms}')::integer, 12);
  end if;
  insert into public.user_rooms (user_id, id, kind, shape, size, name, pos)
    values (uid, substr(md5(random()::text || clock_timestamp()::text), 1, 8), p_kind, p_shape, p_size, btrim(p_name),
            coalesce((select max(pos) + 1 from public.user_rooms where user_id = uid), 0))
    returning * into r;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'shape', r.shape, 'size', r.size, 'name', r.name, 'pos', r.pos);
end $$;

create or replace function public.update_room(p_id text, p_kind text, p_shape text, p_size text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform public.room_input_check(p_kind, p_shape, p_size, p_name);
  update public.user_rooms set kind = p_kind, shape = p_shape, size = p_size, name = btrim(p_name)
   where user_id = uid and id = p_id;
  if not found then raise exception 'Bu oda yok'; end if;
end $$;

create or replace function public.delete_room(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  delete from public.user_rooms where user_id = uid and id = p_id;
  if not found then raise exception 'Bu oda yok'; end if;
  delete from public.user_spaces where user_id = uid and space = 'r:' || p_id;
end $$;

revoke all on function public.add_room(text, text, text, text) from public, anon;
revoke all on function public.update_room(text, text, text, text, text) from public, anon;
revoke all on function public.delete_room(text) from public, anon;
grant execute on function public.add_room(text, text, text, text) to authenticated;
grant execute on function public.update_room(text, text, text, text, text) to authenticated;
grant execute on function public.delete_room(text) to authenticated;

-- ---------- Yerleşimi kaydet ----------
-- 0022'deki gibi; odalar user_rooms'tan (seri kilidi yok), kesik karolar sabit.
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
  room jsonb := public.world_room(p_space);
  indoor boolean := public.world_indoor(p_space);
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
  if p_space is null or not (p_space in ('room', 'library', 'garden') or room is not null or p_space ~ '^m:\d{4}-(0[1-9]|1[0-2])$') then
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

  -- Kaplamalar (yalnızca evin içinde)
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
    if def.id is null or not public.item_has(def, 'STACKABLE') or def.placement = 'wall'
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
    -- Eşyanın kendi durumu: yalnızca davranışına uyan alanlar (world.ts → stateProblem)
    if exists (select 1 from jsonb_object_keys(it) f where f not in ('item', 'x', 'y', 'rot', 'on', 'open', 'color', 'stored', 'fed')) then
      raise exception 'Yerleşim geçersiz';
    end if;
    if it ? 'on' and (jsonb_typeof(it -> 'on') <> 'boolean' or not public.item_has(def, 'TOGGLE')) then
      raise exception 'Bu eşya açılıp kapanmaz';
    end if;
    if it ? 'open' and (jsonb_typeof(it -> 'open') <> 'boolean' or not (public.item_has(def, 'OPEN_CLOSE') or public.item_has(def, 'GATE'))) then
      raise exception 'Bu eşya açılmaz';
    end if;
    if it ? 'color' and (not public.item_has(def, 'CHANGE_COLOR') or jsonb_typeof(it -> 'color') <> 'number' or coalesce(it ->> 'color', '') !~ '^\d{1,2}$'
                         or (it ->> 'color')::integer >= coalesce(jsonb_array_length(def.def -> 'palette'), 0)) then
      raise exception 'Bu renk yok';
    end if;
    if it ? 'fed' and (not public.item_has(def, 'INTERACT_PET') or jsonb_typeof(it -> 'fed') <> 'string' or (it ->> 'fed') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Yerleşim geçersiz';
    end if;
    if it ? 'stored' then
      if not public.item_has(def, 'STORAGE') or jsonb_typeof(it -> 'stored') <> 'array' then
        raise exception 'Bu eşyanın içine bir şey konmaz';
      end if;
      if jsonb_array_length(it -> 'stored') > coalesce((def.def ->> 'capacity')::integer, 0) then
        raise exception '% doldu', def.def ->> 'name';
      end if;
      if exists (
        select 1 from jsonb_array_elements(it -> 'stored') s
          left join public.item_defs sd on sd.id = s #>> '{}'
         where jsonb_typeof(s) <> 'string' or sd.id is null or sd.placement is null or public.item_has(sd, 'STORAGE')
      ) then
        raise exception 'Bu eşya içine konmaz';
      end if;
    end if;
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
      when public.item_has(def, 'WALK_THROUGH') then 'z'
      when not public.item_has(def, 'ON_SURFACE') or on_cnt = 0 then 'e'
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

  -- Envanter: bu alandaki + diğer alanlardaki adet (yerleştirilenler ve depolara konanlar), sahip olunandan fazla olamaz
  for k, n in select q.id, count(*) from public.layout_item_ids(p_layout) q group by 1 loop
    select * into def from public.item_defs where id = k;
    select count(*) into other from public.user_spaces s, public.layout_item_ids(s.layout) q
     where s.user_id = uid and s.space <> p_space and q.id = def.id;
    if n + other > public.world_owned(uid, def, ctx.minutes, ctx.trees) then
      raise exception '% envanterinde yok', def.def ->> 'name';
    end if;
  end loop;

  insert into public.user_spaces (user_id, space, layout, updated_at)
    values (uid, p_space, p_layout, now())
    on conflict (user_id, space) do update set layout = excluded.layout, updated_at = now();
  return p_layout;
end $$;
