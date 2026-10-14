-- Eşya davranışları ve eşyanın kendi durumu (Aşama 2).
--
-- * item_defs.def artık `behaviors` dizisini taşır (SIT, LAY, TOGGLE, OPEN_CLOSE, GATE, WALK_THROUGH, STACKABLE,
--   ON_SURFACE, STORAGE, DISPENSE, PLAY_ANIMATION, PLAY_SOUND, CHANGE_COLOR, INTERACT_PET, BOOKS; bkz.
--   src/lib/config.ts → BEHAVIORS). Katman kuralları eski `walk/surface/small` bayraklarına da bakar: bu dosya
--   0021_config.sql'den önce ya da sonra çalıştırılabilir.
-- * Yerleştirilen eşya kendi durumunu taşır: on (TOGGLE), open (OPEN_CLOSE/GATE), color (CHANGE_COLOR, palette
--   sırası), stored (STORAGE, en çok capacity eşya; depo eşyası depoya konmaz), fed (INTERACT_PET, YYYY-MM-DD).
--   Başka alan kabul edilmez. Depoya konan eşyalar envanterden sayılır (başka yere yerleştirilemez).
-- * Kurallar istemcideki src/lib/world.ts → stateProblem / layoutProblem / itemCounts ile aynı.

-- Eşyanın bu davranışı var mı (eski bayraklar da sayılır)
create or replace function public.item_has(def public.item_defs, b text) returns boolean
language sql stable as $$
  select coalesce(def.def -> 'behaviors' ? b, false)
      or (b = 'WALK_THROUGH' and coalesce((def.def ->> 'walk')::boolean, false))
      or (b = 'STACKABLE' and coalesce((def.def ->> 'surface')::boolean, false))
      or (b = 'ON_SURFACE' and coalesce((def.def ->> 'small')::boolean, false))
$$;

-- Bir yerleşimin envanterden düşen eşyaları: yerleştirilenler ve depolara konanlar (her biri bir satır)
create or replace function public.layout_item_ids(p_layout jsonb) returns table (id text)
language sql immutable as $$
  select e ->> 'item' from jsonb_array_elements(coalesce(p_layout -> 'items', '[]'::jsonb)) e
  union all
  select s #>> '{}'
    from jsonb_array_elements(coalesce(p_layout -> 'items', '[]'::jsonb)) e,
         jsonb_array_elements(case when jsonb_typeof(e -> 'stored') = 'array' then e -> 'stored' else '[]'::jsonb end) s
$$;

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
