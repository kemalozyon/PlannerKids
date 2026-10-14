-- Dünyam v4: seriyle açılan odalar (mutfak, yatak odası, banyo, oyun odası).
--
-- * Odalar economy_config → world.rooms'ta, sırayla odanın doğusunda. En iyi seri (gün) bir odanın `streak`
--   değerine ulaşınca oda açılır ve kalıcıdır (seri sonra düşse de). Saklanmaz: en iyi seri kayıtlardan türer
--   (economy_best_streak, istemcide src/lib/economy.ts → bestStreakOf / streak.ts → computeStreak.best).
-- * Oda derinliği haritanın odasıyla aynı (aşamayla güneye büyür), eni sabit. Kapılar ve pencereler
--   world.rooms[].fixed'te; odanın doğu kapısı her harita aşamasının room.fixed'inde.
-- * Kurallar istemcideki world.ts ile aynı. Önce 0019_config.sql'i çalıştır (world.rooms orada), sonra bunu.

-- ---------- En iyi seri ----------
-- economy_streak'in (0010) döngüsü; kaçırılan hafta içi günü bir kademe düşürür, hafta sonu bozmaz,
-- dondurma bir düşüşü engeller. Döner: ulaşılan en uzun seri.
create or replace function public.economy_best_streak(uid uuid) returns integer
language plpgsql stable as $$
declare
  c jsonb := public.economy_cfg();
  tiers jsonb := c #> '{elmas,streak,tiers}';
  cover integer := (c #>> '{freeze,coverDays}')::integer;
  freezes date[];
  run integer := 0;
  best integer := 0;
  k integer;
  i integer;
  day date;
  mins integer;
begin
  select coalesce(array_agg(created_at::date order by created_at, id), '{}') into freezes
    from public.owned_items where user_id = uid and item_id = 'freeze';
  for day, mins in
    select g::date, coalesce(x.m, 0)
      from generate_series((select min(e.d) from public.economy_days(uid) e), (select max(e.d) from public.economy_days(uid) e), interval '1 day') g
      left join public.economy_days(uid) x on x.d = g::date
     order by g
  loop
    if mins > 0 then
      run := run + 1;
    elsif extract(isodow from day) in (6, 7) or run = 0 then
      null;                                                    -- seriyi bozmaz
    else
      i := null;
      for k in 1 .. coalesce(array_length(freezes, 1), 0) loop
        if freezes[k] <= day + cover then i := k; exit; end if;
      end loop;
      if i is not null then
        freezes := freezes[1:i - 1] || freezes[i + 1:];
      else
        select count(*) into k from jsonb_array_elements(tiers) t where run >= (t->>'days')::integer;
        run := case when k >= 2 then (tiers -> (k - 2) ->> 'days')::integer else 0 end;
      end if;
    end if;
    best := greatest(best, run);
  end loop;
  return best;
end $$;

-- ---------- İlerleme ----------
-- 0017'deki gibi, artı en iyi seri (odalar)
drop function if exists public.world_ctx(uuid);
create function public.world_ctx(uid uuid, out minutes integer, out books integer, out trees integer, out map text, out best integer)
language sql stable as $$
  with t as (
    select coalesce(sum(duration_minutes), 0)::integer mins from public.study_logs where user_id = uid and source <> 'manual'
  )
  select t.mins,
         (select count(*) from public.books where user_id = uid and status = 'done')::integer,
         (select count(distinct date) from public.study_logs where user_id = uid and duration_minutes > 0)::integer,
         coalesce(
           (select e.m ->> 'id'
              from jsonb_array_elements(public.economy_cfg() #> '{world,maps}') with ordinality e(m, o)
             where (e.m ->> 'hours')::numeric * 60 <= t.mins
             order by e.o desc limit 1),
           public.economy_cfg() #>> '{world,maps,0,id}'),
         public.economy_best_streak(uid)
    from t
$$;

-- ---------- Odalar ----------
create or replace function public.world_room(p_space text) returns jsonb
language sql stable as $$
  select r from jsonb_array_elements(public.economy_cfg() #> '{world,rooms}') r where r ->> 'id' = p_space
$$;

alter table public.user_spaces drop constraint if exists user_spaces_space_check;
alter table public.user_spaces add constraint user_spaces_space_check
  check (space in ('room', 'library', 'garden', 'kitchen', 'bedroom', 'bath', 'playroom') or space ~ '^m:\d{4}-(0[1-9]|1[0-2])$');

-- Alanın ölçüsü: evin alanları haritadan, odalar kendi eniyle ve haritanın odasının derinliğiyle, aylık bahçe sabit
create or replace function public.world_size(p_space text, p_map text, out w integer, out h integer)
language sql stable as $$
  select case when r is not null then (r ->> 'w')::integer else (s ->> 'w')::integer end,
         case when r is not null then (public.world_map(p_map) #>> '{room,h}')::integer else (s ->> 'h')::integer end
    from (
      select public.world_room(p_space) r,
             case when p_space ~ '^m:' then public.economy_cfg() #> '{world,monthGarden}' else public.world_map(p_map) -> p_space end s
    ) x
$$;

-- Alanın sabit tanımları: oda → world.rooms[].fixed, evin alanları → haritadan, ay bahçesi → yok (ekim yerleri ayrı)
create or replace function public.world_fixed_defs(p_space text, p_map text) returns jsonb
language sql stable as $$
  select case
    when p_space ~ '^m:' then '[]'::jsonb
    when public.world_room(p_space) is not null then public.world_room(p_space) -> 'fixed'
    else coalesce(public.world_map(p_map) -> p_space -> 'fixed', '[]'::jsonb)
  end
$$;

create or replace function public.world_fixed(p_space text, p_map text) returns table (x integer, y integer)
language sql stable as $$
  with c as (select public.economy_cfg() -> 'world' w),
  sz as (select * from public.world_size(p_space, p_map)),
  home as (
    select gx, gy
      from sz, jsonb_array_elements(public.world_fixed_defs(p_space, p_map)) f,
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

-- Evin içi mi (duvar süsü, kaplama, iç mekân eşyası)
create or replace function public.world_indoor(p_space text) returns boolean
language sql immutable as $$
  select p_space in ('room', 'library', 'kitchen', 'bedroom', 'bath', 'playroom')
$$;

-- Duvarda eşya asılamayan yerler (evin bütün içi): pencereler, kapıların ve gömme rafların üstü
create or replace function public.world_wall_blocked(p_space text, p_map text) returns setof text
language sql stable as $$
  select z.k
    from jsonb_array_elements(case when public.world_indoor(p_space) then public.world_fixed_defs(p_space, p_map) else '[]'::jsonb end) f,
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
-- 0015'teki gibi; ek olarak odalar (kilitliyse reddedilir) ve evin bütün içi "içeride" sayılır.
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
  if room is not null and ctx.best < (room ->> 'streak')::integer then
    raise exception '% % günlük seriyle açılır', room ->> 'name', room ->> 'streak';
  end if;
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
