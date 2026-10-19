-- Ağaçtan Elmas talebi (Bahçem): güne bağlı kazançlar elmas.claim.from gününden itibaren deftere kendiliğinden
-- yazılmaz; o günün ağacında bekler, çocuk ağaca dokunup "Elmas'ı al" deyince claim_day yazar. Hiç kaybolmaz; o
-- gün daha çok çalışılırsa artış yine ağaçta birikir. İstemcideki karşılığı src/lib/economy.ts → claimable,
-- pendingEarnings, dayEarnings, treeElmasOf.
--
-- * Güne bağlı: ders, canlı bonus, elle yazılan, seri, plan, "nasıl geçti", günlük görevler ve aile görevleri
--   (görevin tarihi). Haftalık görevler ve kitaplar kendiliğinden gelir (day boş).
-- * economy_sync'in kazanç sorgusu economy_entries'e taşındı (aynı tutarlar, yanında `day`). economy_sync yalnızca
--   day boş ya da claim.from'dan önceki satırları yazar; claim_day bir günün satırlarını yazar; economy_pending
--   ağaçlarda bekleyen tutarları verir. Bakiye ve owned_check değişmedi: alınmamış Elmas defterde yok.
--
-- Önce 0035_config.sql'i çalıştır (elmas.claim.from orada; yoksa her şey eskisi gibi kendiliğinden yazılır).

create or replace function public.economy_claim_from() returns date
language sql stable as $$
  select coalesce((public.economy_cfg() #>> '{elmas,claim,from}')::date, date '9999-12-31')
$$;

-- Kayıtların hak ettirdiği bütün Elmas kazançları; güne bağlıysa day (0031'deki economy_sync sorgusunun aynısı)
create or replace function public.economy_entries(uid uuid) returns table (kind text, ref text, amount integer, day date)
language sql stable security definer set search_path = public as $$
  with c as (select public.economy_cfg() v)
  select e.kind, e.ref, e.amount, e.day from (
    select v.kind, x.d::text as ref, v.amount, x.d as day
      from public.economy_day_elmas(uid) x
     cross join lateral (values ('study', x.study), ('live', x.live), ('manual', x.manual)) v(kind, amount)
    union all
    -- Aile görevleri: günün ilk perDay aile görevi, bitmişse (görevin gününün ağacında)
    select 'task', t.id::text, (c.v #>> '{elmas,task,each}')::integer, t.date from c, (
      select id, date, done, row_number() over (partition by date order by created_at, id) rn
        from public.tasks where user_id = uid and from_parent and date <= current_date + 1
    ) t where t.done and t.rn <= (c.v #>> '{elmas,task,perDay}')::integer
    union all
    select 'streak', s.d::text, s.bonus, s.d from public.economy_streak(uid) s
    union all
    select 'plan', x.d::text, (c.v #>> '{elmas,plan}')::integer, x.d from c, public.economy_days(uid) x where public.economy_plan_done(uid, x.d)
    union all
    select 'reflection', r.date::text, (c.v #>> '{elmas,reflection,bonus}')::integer, r.date
      from c, public.daily_reflections r join public.economy_days(uid) x on x.d = r.date
     where r.user_id = uid and r.rating is not null
       and char_length(btrim(coalesce(r.note, ''))) >= (c.v #>> '{elmas,reflection,minNote}')::integer
    union all
    select 'book', b.id::text, (c.v #>> '{elmas,book,bonus}')::integer, null::date from c, (
      select id, row_number() over (partition by finished_on - (extract(isodow from finished_on)::integer - 1) order by finished_on, created_at, id) rn
        from public.books where user_id = uid and finished_on is not null and finished_on <= current_date + 1
    ) b where b.rn <= (c.v #>> '{elmas,book,perWeek}')::integer
    union all
    -- Günlük görevler: çalışılan her gün (o günün ağacında)
    select 'quest', (q ->> 'id') || ':' || x.d, (q ->> 'reward')::integer, x.d
      from c, jsonb_array_elements(c.v #> '{elmas,quests}') q cross join public.economy_days(uid) x
     where q ->> 'scope' = 'day' and public.economy_quest_progress(uid, q ->> 'id', x.d) >= (q ->> 'target')::integer
    union all
    -- Haftalık görevler: çalışılan ya da kitap bitirilen her hafta (kendiliğinden)
    select 'quest', (q ->> 'id') || ':' || w.p, (q ->> 'reward')::integer, null::date
      from c, jsonb_array_elements(c.v #> '{elmas,quests}') q
     cross join (
       select distinct x.d - (extract(isodow from x.d)::integer - 1) p from public.economy_days(uid) x
       union
       select distinct finished_on - (extract(isodow from finished_on)::integer - 1) from public.books
        where user_id = uid and finished_on is not null and finished_on <= current_date + 1
     ) w
     where q ->> 'scope' = 'week' and public.economy_quest_progress(uid, q ->> 'id', w.p) >= (q ->> 'target')::integer
  ) e
  where e.amount > 0
$$;
revoke all on function public.economy_entries(uuid) from public, anon, authenticated;

-- Kendiliğinden yazılanlar: güne bağlı olmayanlar ve claim.from'dan önceki günler (kazanç hiç azalmaz)
create or replace function public.economy_sync() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  since date := public.economy_claim_from();
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform pg_advisory_xact_lock(hashtext('economy:' || uid::text));
  perform set_config('economy.server', 'on', true);
  insert into public.crystal_ledger (user_id, currency, kind, ref, amount)
  select uid, 'crystal', e.kind, e.ref, e.amount from public.economy_entries(uid) e
   where e.day is null or e.day < since
  on conflict (user_id, currency, kind, ref) do update set amount = excluded.amount
    where excluded.amount > public.crystal_ledger.amount;
  perform set_config('economy.server', 'off', true);
end $$;

-- Ağaçlarda bekleyen Elmas: gün → tutar (yalnızca artışlar)
create or replace function public.economy_pending() returns table (d date, amount integer)
language sql stable security definer set search_path = public as $$
  select e.day, sum(e.amount - coalesce(l.amount, 0))::integer
    from public.economy_entries(auth.uid()) e
    left join public.crystal_ledger l
      on l.user_id = auth.uid() and l.currency = 'crystal' and l.kind = e.kind and l.ref = e.ref
   where auth.uid() is not null and e.day is not null and e.day >= public.economy_claim_from()
     and e.amount > coalesce(l.amount, 0)
   group by e.day
   order by e.day
$$;

-- Bir günün ağacındaki Elması al: o günün satırları deftere yazılır; alınan tutar döner
create or replace function public.claim_day(p_date date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gain integer;
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Bu günün ağacı yok'; end if;
  perform pg_advisory_xact_lock(hashtext('economy:' || uid::text));
  select coalesce(sum(e.amount - coalesce(l.amount, 0)), 0)::integer into gain
    from public.economy_entries(uid) e
    left join public.crystal_ledger l on l.user_id = uid and l.currency = 'crystal' and l.kind = e.kind and l.ref = e.ref
   where e.day = p_date and p_date >= public.economy_claim_from() and e.amount > coalesce(l.amount, 0);
  if gain = 0 then return 0; end if;
  perform set_config('economy.server', 'on', true);
  insert into public.crystal_ledger (user_id, currency, kind, ref, amount)
  select uid, 'crystal', e.kind, e.ref, e.amount from public.economy_entries(uid) e
   where e.day = p_date and p_date >= public.economy_claim_from()
  on conflict (user_id, currency, kind, ref) do update set amount = excluded.amount
    where excluded.amount > public.crystal_ledger.amount;
  perform set_config('economy.server', 'off', true);
  return gain;
end $$;

revoke all on function public.economy_pending() from public, anon;
revoke all on function public.claim_day(date) from public, anon;
grant execute on function public.economy_pending() to authenticated;
grant execute on function public.claim_day(date) to authenticated;
