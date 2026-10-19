-- Dünyam v3 (Habbo gibi tek tek odalar): teras odası, blok düzenleyici, süslenmeyen ağaç bahçeleri.
--
-- * Odanın şekli karo karo çizilebilir: user_rooms.cells = {w, h, cut: [[x, y, en, boy]…]} (yoksa şablon). Kurallar
--   room_cells_check (istemcide world.ts → roomCellsProblem): kutu 3…world.roomMax, kesikler kutunun içinde, arka
--   sıra (y 0) ve sol sütun (x 0) hep dolu, en az 6 karo, hepsi bağlı. add_room / update_room artık p_cells alır.
-- * Kapılar: batı (0, d) ve doğu (o satırın en doğudaki zemini), d = en(5, boy − 1). Terasta pencere yok.
-- * Teras: world.rooms'ta `outdoor: true` olan tür. İçeride sayılmaz (world_indoor): duvar süsü ve kaplama yok,
--   dış mekân eşyaları konur.
-- * Evin önündeki bahçe ('garden') kalktı: eşyası olan her kullanıcıya bir teras eklenir (bahçenin ölçüsünde) ve
--   bahçenin yerleşimi oraya taşınır (sabit karolara düşen eşyaları istemci ilk açılışta envantere döndürür).
--   Ağaç bahçeleri ('m:YYYY-MM', Bahçem sayfası) artık süslenmez: kayıtlı yerleşimleri silinir, eşyaları envantere
--   döner (sahiplik ayrı sayılır). user_spaces yalnızca oda, kütüphane ve eklenen odaları tutar.
--
-- Önce 0033_garden.sql'i, bu dosyadan SONRA 0035_config.sql'i çalıştır (taşınan bahçenin ölçüsü eski
-- yapılandırmadan okunur; 0035 evin önündeki bahçeyi haritalardan siler ve world.roomMax'ı ekler).

-- ---------- Odanın şekli ----------
alter table public.user_rooms add column if not exists cells jsonb;

-- Karo odanın zemini mi (kutunun içinde, kesik değil)
create or replace function public.room_in_cells(c jsonb, px integer, py integer) returns boolean
language sql immutable as $$
  select px >= 0 and py >= 0 and px < (c ->> 'w')::integer and py < (c ->> 'h')::integer
     and not exists (
       select 1 from jsonb_array_elements(coalesce(c -> 'cut', '[]'::jsonb)) k
        where px >= (k ->> 0)::integer and px < (k ->> 0)::integer + (k ->> 2)::integer
          and py >= (k ->> 1)::integer and py < (k ->> 1)::integer + (k ->> 3)::integer)
$$;

-- Blok düzenleyicinin şekli (world.ts → roomCellsProblem ile aynı)
create or replace function public.room_cells_check(c jsonb) returns void
language plpgsql stable as $$
declare
  mw integer := coalesce((public.economy_cfg() #>> '{world,roomMax,w}')::integer, 42);
  mh integer := coalesce((public.economy_cfg() #>> '{world,roomMax,h}')::integer, 20);
  w integer;
  h integer;
  k jsonb;
  n integer;
  reach integer;
begin
  if c is null or jsonb_typeof(c) <> 'object' or jsonb_typeof(c -> 'w') <> 'number' or jsonb_typeof(c -> 'h') <> 'number'
     or (c ->> 'w')::numeric <> floor((c ->> 'w')::numeric) or (c ->> 'h')::numeric <> floor((c ->> 'h')::numeric) then
    raise exception 'Odanın şekli geçersiz';
  end if;
  w := (c ->> 'w')::integer;
  h := (c ->> 'h')::integer;
  if w < 3 or h < 3 or w > mw or h > mh then raise exception 'Oda en az 3×3, en çok %×% karo olur', mw, mh; end if;
  if c ? 'cut' and (jsonb_typeof(c -> 'cut') <> 'array' or jsonb_array_length(c -> 'cut') > w * h) then raise exception 'Odanın şekli geçersiz'; end if;
  for k in select * from jsonb_array_elements(coalesce(c -> 'cut', '[]'::jsonb)) loop
    if jsonb_typeof(k) <> 'array' or jsonb_array_length(k) <> 4
       or exists (select 1 from jsonb_array_elements(k) v where jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)) then
      raise exception 'Odanın şekli geçersiz';
    end if;
    if (k ->> 2)::integer < 1 or (k ->> 3)::integer < 1 or (k ->> 0)::integer < 0 or (k ->> 1)::integer < 0
       or (k ->> 0)::integer + (k ->> 2)::integer > w or (k ->> 1)::integer + (k ->> 3)::integer > h then
      raise exception 'Odanın şekli geçersiz';
    end if;
    if (k ->> 0)::integer = 0 or (k ->> 1)::integer = 0 then raise exception 'Arka sıra ve sol sütun duvar dibi: hep dolu kalır'; end if;
  end loop;
  select count(*) into n from generate_series(0, w - 1) gx, generate_series(0, h - 1) gy where public.room_in_cells(c, gx, gy);
  if n < 6 then raise exception 'Oda en az 6 karo olur'; end if;
  -- Bağlı mı: (0,0)'dan yayıl
  with recursive cells as (
    select gx x, gy y from generate_series(0, w - 1) gx, generate_series(0, h - 1) gy where public.room_in_cells(c, gx, gy)
  ), r(x, y) as (
    select 0, 0
    union
    select q.x, q.y from r join cells q on abs(q.x - r.x) + abs(q.y - r.y) = 1
  )
  select count(*) into reach from r;
  if reach <> n then raise exception 'Odanın bütün karoları birbirine bağlı olmalı'; end if;
end $$;

-- Oturumdaki kullanıcının odası: {id, kind, outdoor, w, h, fixed} (kapılar, arka duvarda pencere, kesikler)
create or replace function public.world_room(p_space text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'id', 'r:' || r.id, 'kind', r.kind, 'name', r.name, 'outdoor', o.v, 'w', s.w, 'h', s.h,
           'fixed', jsonb_build_array(jsonb_build_object('kind', 'door', 'x', 0, 'y', d.y, 'edge', 'w'))
                    || case when e.x > 0 then jsonb_build_array(jsonb_build_object('kind', 'door', 'x', e.x, 'y', d.y, 'edge', 'e')) else '[]'::jsonb end
                    || case when o.v or s.w < 4 then '[]'::jsonb
                            else jsonb_build_array(jsonb_build_object('kind', 'window', 'x', greatest(1, s.w / 2 - 1), 'y', -1, 'w', 2)) end
                    || coalesce((select jsonb_agg(jsonb_build_object('kind', 'void', 'x', k -> 0, 'y', k -> 1, 'w', k -> 2, 'h', k -> 3))
                                   from jsonb_array_elements(coalesce(x.c -> 'cut', '[]'::jsonb)) k), '[]'::jsonb))
    from public.user_rooms r,
         lateral (select coalesce(r.cells, public.room_cells(r.shape, r.size)) c) x,
         lateral (select (x.c ->> 'w')::integer w, (x.c ->> 'h')::integer h) s,
         lateral (select least(5, s.h - 1) y) d,
         lateral (select coalesce((select max(gx) from generate_series(1, s.w - 1) gx where public.room_in_cells(x.c, gx, d.y)), 0) x) e,
         lateral (select coalesce((select (k ->> 'outdoor')::boolean from jsonb_array_elements(public.economy_cfg() #> '{world,rooms}') k
                                    where k ->> 'id' = r.kind), false) v) o
   where p_space ~ '^r:' and r.user_id = auth.uid() and 'r:' || r.id = p_space
$$;

-- Evin içi mi (duvar süsü, kaplama, iç mekân eşyası): oda, kütüphane ve teras olmayan eklenen odalar
create or replace function public.world_indoor(p_space text) returns boolean
language sql stable as $$
  select p_space in ('room', 'library')
      or (p_space ~ '^r:' and not coalesce((public.world_room(p_space) ->> 'outdoor')::boolean, false))
$$;

-- ---------- Oda ekle / değiştir (şekliyle) ----------
drop function if exists public.add_room(text, text, text, text);
drop function if exists public.update_room(text, text, text, text, text);

create or replace function public.add_room(p_kind text, p_shape text, p_size text, p_name text, p_cells jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n integer;
  r public.user_rooms;
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform public.room_input_check(p_kind, p_shape, p_size, p_name);
  if p_cells is not null and p_cells <> 'null'::jsonb then perform public.room_cells_check(p_cells); end if;
  perform pg_advisory_xact_lock(hashtext('rooms:' || uid::text));
  select count(*) into n from public.user_rooms where user_id = uid;
  if n >= coalesce((public.economy_cfg() #>> '{world,maxRooms}')::integer, 12) then
    raise exception 'En çok % oda eklenebilir', coalesce((public.economy_cfg() #>> '{world,maxRooms}')::integer, 12);
  end if;
  insert into public.user_rooms (user_id, id, kind, shape, size, cells, name, pos)
    values (uid, substr(md5(random()::text || clock_timestamp()::text), 1, 8), p_kind, p_shape, p_size, nullif(p_cells, 'null'::jsonb), btrim(p_name),
            coalesce((select max(pos) + 1 from public.user_rooms where user_id = uid), 0))
    returning * into r;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'shape', r.shape, 'size', r.size, 'cells', r.cells, 'name', r.name, 'pos', r.pos);
end $$;

create or replace function public.update_room(p_id text, p_kind text, p_shape text, p_size text, p_name text, p_cells jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform public.room_input_check(p_kind, p_shape, p_size, p_name);
  if p_cells is not null and p_cells <> 'null'::jsonb then perform public.room_cells_check(p_cells); end if;
  update public.user_rooms set kind = p_kind, shape = p_shape, size = p_size, cells = nullif(p_cells, 'null'::jsonb), name = btrim(p_name)
   where user_id = uid and id = p_id;
  if not found then raise exception 'Bu oda yok'; end if;
end $$;

revoke all on function public.add_room(text, text, text, text, jsonb) from public, anon;
revoke all on function public.update_room(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.add_room(text, text, text, text, jsonb) to authenticated;
grant execute on function public.update_room(text, text, text, text, text, jsonb) to authenticated;

-- ---------- Evin önündeki bahçe → teras; ağaç bahçeleri süslenmez ----------
do $$
declare
  s record;
  n integer;
  rid text;
  g jsonb;
  max_rooms integer := coalesce((public.economy_cfg() #>> '{world,maxRooms}')::integer, 12);
begin
  for s in
    select us.user_id, us.layout from public.user_spaces us
     where us.space = 'garden' and jsonb_array_length(coalesce(us.layout -> 'items', '[]'::jsonb)) > 0
  loop
    select count(*) into n from public.user_rooms where user_id = s.user_id;
    -- Oda sınırı doluysa terası olmaz: eşyalar envantere döner
    continue when n >= max_rooms;
    g := coalesce(public.world_map((select c.map from public.world_ctx(s.user_id) c)) -> 'garden', '{"w": 24, "h": 12}'::jsonb);
    rid := substr(md5(random()::text || clock_timestamp()::text || s.user_id::text), 1, 8);
    insert into public.user_rooms (user_id, id, kind, shape, size, cells, name, pos)
      values (s.user_id, rid, 'teras', 'genis', 'l',
              jsonb_build_object('w', least((g ->> 'w')::integer, 42), 'h', least((g ->> 'h')::integer, 20)), 'Teras',
              coalesce((select max(pos) + 1 from public.user_rooms where user_id = s.user_id), 0));
    insert into public.user_spaces (user_id, space, layout) values (s.user_id, 'r:' || rid, jsonb_build_object('items', s.layout -> 'items'));
  end loop;
end $$;

delete from public.user_spaces where space = 'garden' or space ~ '^m:';

alter table public.user_spaces drop constraint if exists user_spaces_space_check;
alter table public.user_spaces add constraint user_spaces_space_check
  check (space in ('room', 'library') or space ~ '^r:[a-z0-9]{1,12}$');

-- save_space (0027) evin önündeki bahçeyi ve ay bahçelerini hâlâ kabul eder: yazılmadan anlaşılır bir hatayla durur
create or replace function public.user_spaces_v3() returns trigger
language plpgsql as $$
begin
  if new.space ~ '^m:' then raise exception 'Ağaç bahçesi süslenmez'; end if;
  if new.space = 'garden' then raise exception 'Evin önündeki bahçe kalktı: dış eşyaları terasa koy'; end if;
  return new;
end $$;
drop trigger if exists user_spaces_v3 on public.user_spaces;
create trigger user_spaces_v3 before insert or update on public.user_spaces for each row execute function public.user_spaces_v3();
