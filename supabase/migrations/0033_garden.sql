-- Aylık bahçe v2: 4 aşamalı ağaçlar (Fidan · Genç · Tam · Nadir), kuru ağaç yok, nadir ağaç ödülü.
-- Önce 0032_config.sql'i çalıştır (world.stages, world.drop ve drop eşyaları orada), sonra bunu.
--
-- * Ağaçlar saklanmaz (istemcide dayTrees); aşamalar yalnızca config'te. Yarım kalan seans artık kuru ağaç olmaz
--   (abandoned_sessions yine yazılır, oyunda kullanılmaz).
-- * Nadir ağaç ödülü: bir günde world.drop.minutes güvenilir (sayaç + eski) dakika → items.json'da drop: true olan
--   eşyalardan biri, o gün için bir kez (owned_items via 'drop', ref = tarih; unique (user_id, via, ref)).
--   Yalnızca world.drop.from gününden (geriye dönük yok). Hangi eşyanın çıkacağını istemci tarihe göre seçer
--   (src/lib/economy.ts → dropPrize); sunucu sandıktaki gibi eşyanın havuzda olduğunu ve günün hak edildiğini denetler.

-- ---------- Sahiplik ----------
alter table public.owned_items drop constraint if exists owned_items_via_check;
alter table public.owned_items add constraint owned_items_via_check check (via in ('buy', 'chest', 'drop'));

-- 0010'daki gibi; drop dalı eklendi
create or replace function public.owned_check() returns trigger
language plpgsql as $$
declare
  def public.item_defs;
  bal integer;
  p date;
  n integer;
  m integer;
begin
  select * into def from public.item_defs where id = new.item_id;
  if new.via = 'buy' then
    if def.price is null then raise exception 'Bu eşya satılmıyor'; end if;
    -- Aynı anda iki satın alma bakiyeyi iki kez harcamasın
    perform pg_advisory_xact_lock(hashtext('economy:' || new.user_id::text));
    if not def.repeat and exists (select 1 from public.owned_items where user_id = new.user_id and item_id = new.item_id) then
      raise exception 'Bu eşya zaten sende';
    end if;
    select coalesce(sum(amount), 0) into bal from public.crystal_ledger where user_id = new.user_id and currency = 'crystal';
    if bal < def.price then
      raise exception 'Bakiye yetmiyor: % lazım, % var', def.price, bal;
    end if;
    new.ref := null;
  elsif new.via = 'drop' then
    if def.id is null or not coalesce((def.def->>'drop')::boolean, false) then raise exception 'Bu eşya nadir ağaçtan çıkmaz'; end if;
    if new.ref is null or new.ref !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Nadir ağaç günü geçersiz'; end if;
    p := new.ref::date;
    if p < (public.economy_cfg() #>> '{world,drop,from}')::date or p > current_date + 1 then raise exception 'Nadir ağaç günü geçersiz'; end if;
    select coalesce(sum(e.m), 0) into m from public.economy_days(new.user_id) e where e.d = p;
    if m < public.cfg_int('{world,drop,minutes}') then
      raise exception 'Bu gün nadir ağaç ödülü yok (% dk sayaçla çalışıldı, % gerekir)', m, public.cfg_int('{world,drop,minutes}');
    end if;
  else
    if def.id is null or not def.in_chest then raise exception 'Bu eşya sandıktan çıkmaz'; end if;
    if new.ref is null or new.ref !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Sandık haftası geçersiz'; end if;
    p := new.ref::date;
    if extract(isodow from p) <> 1 or p > current_date + 1 then raise exception 'Sandık haftası geçersiz'; end if;
    select count(*), coalesce(sum(e.m), 0) into n, m from public.economy_days(new.user_id) e where e.d between p and p + 6;
    if n < public.cfg_int('{chest,days}') or m < public.cfg_int('{chest,minutes}') then
      raise exception 'Bu haftanın sandığı henüz açılmadı (% gün, % dk)', n, m;
    end if;
  end if;
  return new;
end $$;

-- 0012'deki gibi; nadir ağaç eşyaları da sahip olunan adet kadar yerleştirilir
create or replace function public.world_owned(uid uuid, d public.item_defs, p_minutes integer, p_trees integer) returns integer
language plpgsql stable as $$
declare
  u jsonb := d.def -> 'unlock';
  lvl integer;
begin
  if d.price is not null or coalesce((d.def->>'chest')::boolean, false) or coalesce((d.def->>'drop')::boolean, false) then
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
