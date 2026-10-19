-- Dükkân v2: adetli alım ve hazır döşenmiş ilk oda.
-- Sonra 0038_config.sql'i çalıştır (items.json'daki "starter" adetleri item_defs.def'e orada yazılır).
--
-- * buy_items(eşya, adet): bir eşyadan 1–20 tane birden alır. Her satır ayrı insert olduğundan owned_check (fiyat,
--   bakiye, kilit) ve owned_charge (eksi defter satırı) her tanede çalışır; biri tutmazsa (bakiye yetmez) hiçbiri yazılmaz.
-- * Başlangıç eşyaları: items.json'da "starter": N olan eşyadan herkesin N tanesi bedava vardır (hiçbir yere yazılmaz,
--   sahip olunan adede eklenir). Yeni evin odası (istemcide DEFAULT_ROOM) bunlarla döşeli gelir.

create or replace function public.buy_items(p_item text, p_qty integer) returns integer
language plpgsql as $$
declare
  i integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 20 then raise exception 'Bir seferde 1–20 tane alınabilir'; end if;
  for i in 1 .. p_qty loop
    insert into public.owned_items (item_id, via) values (p_item, 'buy');
  end loop;
  return p_qty;
end $$;

revoke all on function public.buy_items(text, integer) from public;
grant execute on function public.buy_items(text, integer) to authenticated;

-- 0033'teki gibi; başlangıç adedi eklendi
create or replace function public.world_owned(uid uuid, d public.item_defs, p_minutes integer, p_trees integer) returns integer
language plpgsql stable as $$
declare
  u jsonb := d.def -> 'unlock';
  lvl integer;
begin
  if d.price is not null or coalesce((d.def->>'chest')::boolean, false) or coalesce((d.def->>'drop')::boolean, false) then
    return (select count(*) from public.owned_items where user_id = uid and item_id = d.id)
      + coalesce((d.def->>'starter')::integer, 0);
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
