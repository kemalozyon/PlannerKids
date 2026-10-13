-- Dünya alanları: oda, kütüphane odası ve bahçe aynı karo ızgarasını kullanır. Her alanın durumu tek bir
-- jsonb: { "floor": "zemin:ahsap", "wall": "duvar:krem", "items": [{ "item": "mob:koltuk-mavi", "x": 3, "y": 2, "rot": 90 }] }
-- Yazma yalnızca save_space() ile: alan sınırı, sabit karolar (kapı, ev, su…), çakışma ve envanter sunucuda
-- doğrulanır. Kurallar istemcide de var (src/lib/world.ts → layoutProblem); sayılar economy_config → world.
-- Satır user_id'ye bağlı: ileride salt okunur ziyaret için bir okuma politikası eklenebilir.

create table if not exists public.user_spaces (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  space       text not null check (space in ('room', 'library', 'garden')),
  layout      jsonb not null default '{"items": []}',
  updated_at  timestamptz not null default now(),
  primary key (user_id, space)
);

alter table public.user_spaces enable row level security;
drop policy if exists "own read" on public.user_spaces;
create policy "own read" on public.user_spaces for select using (user_id = auth.uid());

-- Alan kurallarını etkileyen ilerleme: güvenilir toplam dakika, biten kitap, ağaç sayısı
create or replace function public.world_ctx(uid uuid, out minutes integer, out books integer, out trees integer)
language sql stable as $$
  select coalesce((select sum(duration_minutes) from public.study_logs where user_id = uid and source <> 'manual'), 0)::integer,
         (select count(*) from public.books where user_id = uid and status = 'done')::integer,
         (select count(*) from public.study_logs where user_id = uid and source <> 'manual')::integer
$$;

-- Alanın ölçüsü: oda ve kütüphane sabit, bahçe açılan son araziye göre
create or replace function public.world_size(p_space text, p_minutes integer, out w integer, out h integer)
language sql stable as $$
  select (s->>'w')::integer, (s->>'h')::integer from (
    select case when p_space = 'garden' then (
             select l from jsonb_array_elements(public.economy_cfg() #> '{world,garden,lands}') with ordinality e(l, o)
              where p_minutes >= (l->>'hours')::integer * 60 order by o desc limit 1)
           else public.economy_cfg() -> 'world' -> p_space end s
  ) x
$$;

-- Eşya konamayan sabit karolar (kapı, ev, su, köprü, tepe, koru); arazisi açılmamış ya da kitabı yetmeyen atlanır
create or replace function public.world_fixed(p_space text, p_minutes integer, p_books integer)
returns table (x integer, y integer)
language sql stable as $$
  with c as (select public.economy_cfg() -> 'world' w),
  sz as (select * from public.world_size(p_space, p_minutes)),
  lands as (
    select l->>'id' id from c, jsonb_array_elements(c.w #> '{garden,lands}') l
     where p_minutes >= (l->>'hours')::integer * 60
  )
  select distinct gx, gy
    from c, sz, jsonb_array_elements(c.w -> p_space -> 'fixed') f,
         generate_series((f->>'x')::integer, least(sz.w, (f->>'x')::integer + coalesce((f->>'w')::integer, 1)) - 1) gx,
         generate_series((f->>'y')::integer, least(sz.h, (f->>'y')::integer + coalesce((f->>'h')::integer, 1)) - 1) gy
   where (f->>'land' is null or f->>'land' in (select id from lands))
     and (f->>'books' is null or p_books >= (f->>'books')::integer)
$$;

-- Bir eşyadan kaç tane yerleştirilebilir: satılan/sandık eşyası sahip olunan adet kadar; saat, seviye ya da
-- ağaç sayısıyla açılan eşya açıldıysa 1; ücretsiz başlangıç eşyası 1; ücretsiz kaplama sınırsız
create or replace function public.world_owned(uid uuid, d public.item_defs, p_minutes integer, p_trees integer) returns integer
language plpgsql stable as $$
declare
  u jsonb := d.def -> 'unlock';
  lvl integer;
begin
  if d.price is not null or coalesce((d.def->>'chest')::boolean, false) then
    return (select count(*) from public.owned_items where user_id = uid and item_id = d.id);
  end if;
  if u is not null then
    if u->>'by' = 'hours' then
      return case when p_minutes >= (u->>'target')::integer * 60 then 1 else 0 end;
    elsif u->>'by' = 'trees' then
      return case when p_trees >= (u->>'target')::integer then 1 else 0 end;
    elsif u->>'by' = 'level' then
      select count(*) - 1 into lvl from jsonb_array_elements(public.economy_cfg() -> 'levelHours') hh where p_minutes >= (hh::text)::integer * 60;
      return case when lvl >= (u->>'target')::integer then 1 else 0 end;
    end if;
    return 0;
  end if;
  return case when d.placement is null then 1000 else 1 end;
end $$;

create or replace function public.save_space(p_space text, p_layout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ctx record;
  sz record;
  fixed text[];
  taken text[] := '{}';
  it jsonb;
  def public.item_defs;
  slot text;
  cat text;
  px integer;
  py integer;
  rot integer;
  fw integer;
  fh integer;
  layer text;
  k text;
  n integer;
  other integer;
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  if p_space is null or p_space not in ('room', 'library', 'garden') then raise exception 'Alan geçersiz'; end if;
  select * into ctx from public.world_ctx(uid);
  if p_space = 'library' and ctx.books < public.cfg_int('{world,library,books}') then
    raise exception 'Kütüphane odası henüz açılmadı';
  end if;
  if jsonb_typeof(p_layout) <> 'object' or jsonb_typeof(p_layout -> 'items') <> 'array' or jsonb_array_length(p_layout -> 'items') > 150 then
    raise exception 'Yerleşim geçersiz';
  end if;
  select * into sz from public.world_size(p_space, ctx.minutes);
  select coalesce(array_agg(f.x || ',' || f.y), '{}') into fixed from public.world_fixed(p_space, ctx.minutes, ctx.books) f;

  -- Kaplamalar (yalnızca iç mekân)
  for slot, cat in values ('floor', 'zemin'), ('wall', 'duvar') loop
    if coalesce(p_layout ->> slot, '') <> '' then
      select * into def from public.item_defs where id = p_layout ->> slot;
      if p_space = 'garden' or def.id is null or def.category <> cat or public.world_owned(uid, def, ctx.minutes, ctx.trees) < 1 then
        raise exception 'Bu kaplama sende yok';
      end if;
    end if;
  end loop;

  -- Eşyalar: tür, yön, sınır, sabit karo, çakışma (zemin katmanı ile eşya katmanı ayrı)
  for it in select * from jsonb_array_elements(p_layout -> 'items') loop
    select * into def from public.item_defs where id = it ->> 'item';
    if def.id is null or def.placement is null then raise exception 'Bu eşya yerleştirilemez'; end if;
    if not (def.placement = 'both' or (p_space = 'garden') = (def.placement = 'outdoor')) then
      raise exception '% %', def.def ->> 'name', case when p_space = 'garden' then 'içeride durur' else 'dışarıda durur' end;
    end if;
    if coalesce(it ->> 'x', '') !~ '^-?\d{1,3}$' or coalesce(it ->> 'y', '') !~ '^-?\d{1,3}$' or coalesce(it ->> 'rot', '') !~ '^\d{1,3}$' then
      raise exception 'Yerleşim geçersiz';
    end if;
    px := (it ->> 'x')::integer;
    py := (it ->> 'y')::integer;
    rot := (it ->> 'rot')::integer;
    if not rot = any(def.rotations) then raise exception 'Bu eşya böyle döndürülemez'; end if;
    fw := case when rot % 180 = 0 then def.w else def.h end;
    fh := case when rot % 180 = 0 then def.h else def.w end;
    layer := case when coalesce((def.def ->> 'walk')::boolean, false) then 'z' else 'e' end;
    for gx in px .. px + fw - 1 loop
      for gy in py .. py + fh - 1 loop
        if gx < 0 or gy < 0 or gx >= sz.w or gy >= sz.h then raise exception 'Alanın dışına taşıyor'; end if;
        k := gx || ',' || gy;
        if k = any(fixed) then raise exception 'Bu karo boş değil'; end if;
        if (layer || k) = any(taken) then raise exception 'Bu karo dolu'; end if;
        taken := taken || (layer || k);
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
