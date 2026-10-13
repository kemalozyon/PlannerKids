-- Elmas (💎) sunucuda hesaplanır: economy_sync() kayıtlardan bütün kazançları hesaplayıp deftere yazar.
-- İstemci artık deftere yazamaz (0008'deki "talep" yolu kapanır); yıldız ve hediye de RPC ile.
-- Kurallar istemcide de var (src/lib/economy.ts, src/lib/streak.ts); bütün sayılar economy_config'ten.
--
-- Yalnızca sayaçla ölçülen (timer) ve eski (legacy) kayıtlar sayılır; elle yazılan (manual) Elmas vermez.
-- Kazanç hiç azalmaz: kayıt silinse de yazılmış Elmas kalır (silmek bir şey kazandırmaz).
-- ⭐ yıldız artık para değil: gezintide toplanan bir sayaçtır, harcanmaz.

-- ---------- Defter ----------
alter table public.crystal_ledger drop constraint if exists crystal_ledger_kind_check;
alter table public.crystal_ledger add constraint crystal_ledger_kind_check
  check (kind in ('study', 'streak', 'plan', 'reflection', 'book', 'quest', 'star', 'gift', 'buy'));

-- Deftere yalnızca sunucu fonksiyonları yazar (`economy.server` bayrağı)
create or replace function public.ledger_check() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('economy.server', true), '') <> 'on' then
    raise exception 'Defter yalnızca sunucu tarafından yazılır';
  end if;
  if tg_op = 'UPDATE' and (new.user_id, new.currency, new.kind, new.ref) is distinct from (old.user_id, old.currency, old.kind, old.ref) then
    raise exception 'Defter satırının türü değiştirilemez';
  end if;
  return new;
end $$;

drop policy if exists "own insert" on public.crystal_ledger;
drop policy if exists "own update" on public.crystal_ledger;

-- ---------- Kurallar ----------
-- Güvenilir günlük dakikalar
create or replace function public.economy_days(uid uuid) returns table (d date, m integer)
language sql stable as $$
  select date, sum(duration_minutes)::integer from public.study_logs
   where user_id = uid and source <> 'manual' and date <= current_date + 1
   group by date having sum(duration_minutes) > 0
$$;

-- Azalan getiri: kademeler ({upTo, minutesPer}), en fazla dailyCap
create or replace function public.economy_study_elmas(m integer) returns integer
language plpgsql stable as $$
declare
  t jsonb;
  prev integer := 0;
  total integer := 0;
begin
  for t in select * from jsonb_array_elements(public.economy_cfg() #> '{elmas,study,tiers}') loop
    total := total + greatest(0, least(m, (t->>'upTo')::integer) - prev) / (t->>'minutesPer')::integer;
    prev := (t->>'upTo')::integer;
  end loop;
  return least(total, public.cfg_int('{elmas,study,dailyCap}'));
end $$;

-- Bir günün planı tamamen bitti mi (güvenilir kayıtlarla)
create or replace function public.economy_plan_done(uid uuid, d date) returns boolean
language sql stable as $$
  select exists (select 1 from public.study_plans p where p.user_id = uid and p.date = d)
     and not exists (
       select 1 from public.study_plans p
        where p.user_id = uid and p.date = d
          and p.minutes > coalesce((
            select sum(l.duration_minutes) from public.study_logs l
             where l.user_id = uid and l.date = d and l.course_id = p.course_id and l.source <> 'manual'), 0))
$$;

-- Kademeli seri: kaçırılan hafta içi günü seriyi bir alt kademenin eşiğine düşürür; hafta sonu bozmaz;
-- seri dondurma (satın alındığı günden en çok coverDays gün önceki) bir düşüşü engeller.
-- Döner: seri bonusu alan günler. (src/lib/streak.ts → computeStreak)
create or replace function public.economy_streak(uid uuid) returns table (d date, bonus integer)
language plpgsql stable as $$
declare
  c jsonb := public.economy_cfg();
  tiers jsonb := c #> '{elmas,streak,tiers}';
  min_m integer := (c #>> '{elmas,streak,minMinutes}')::integer;
  cover integer := (c #>> '{freeze,coverDays}')::integer;
  freezes date[];
  run integer := 0;
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
      select count(*) into k from jsonb_array_elements(tiers) t where run >= (t->>'days')::integer;
      if k > 0 and mins >= min_m then
        d := day;
        bonus := (tiers -> (k - 1) ->> 'bonus')::integer;
        return next;
      end if;
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
  end loop;
end $$;

-- Görev ilerlemesi (gün ya da haftanın pazartesisi için)
create or replace function public.economy_quest_progress(uid uuid, q text, p date) returns integer
language plpgsql stable as $$
declare
  n integer;
begin
  if q = 'day30' then
    select coalesce(sum(duration_minutes), 0) into n from public.study_logs where user_id = uid and date = p and source <> 'manual';
  elsif q = 'week5days' then
    select count(*) into n from public.economy_days(uid) e where e.d between p and p + 6;
  elsif q = 'week3plans' then
    select count(*) into n from generate_series(p, p + 6, interval '1 day') g where public.economy_plan_done(uid, g::date);
  elsif q = 'week3courses' then
    select count(distinct course_id) into n from public.study_logs where user_id = uid and date between p and p + 6 and source <> 'manual';
  elsif q = 'weekBook' then
    select count(*) into n from public.books where user_id = uid and finished_on between p and p + 6;
  else
    n := 0;
  end if;
  return n;
end $$;

-- Bütün kazançları hesaplayıp deftere yazar (yeni olanı ekler, artanı günceller; hiç azaltmaz)
create or replace function public.economy_sync() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c jsonb := public.economy_cfg();
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform pg_advisory_xact_lock(hashtext('economy:' || uid::text));
  perform set_config('economy.server', 'on', true);
  insert into public.crystal_ledger (user_id, currency, kind, ref, amount)
  select uid, 'crystal', e.kind, e.ref, e.amount from (
    select 'study' kind, x.d::text ref, public.economy_study_elmas(x.m) amount from public.economy_days(uid) x
    union all
    select 'streak', s.d::text, s.bonus from public.economy_streak(uid) s
    union all
    select 'plan', x.d::text, (c #>> '{elmas,plan}')::integer from public.economy_days(uid) x where public.economy_plan_done(uid, x.d)
    union all
    select 'reflection', r.date::text, (c #>> '{elmas,reflection,bonus}')::integer
      from public.daily_reflections r join public.economy_days(uid) x on x.d = r.date
     where r.user_id = uid and r.rating is not null
       and char_length(btrim(coalesce(r.note, ''))) >= (c #>> '{elmas,reflection,minNote}')::integer
    union all
    select 'book', b.id::text, (c #>> '{elmas,book,bonus}')::integer from (
      select id, row_number() over (partition by finished_on - (extract(isodow from finished_on)::integer - 1) order by finished_on, created_at, id) rn
        from public.books where user_id = uid and finished_on is not null and finished_on <= current_date + 1
    ) b where b.rn <= (c #>> '{elmas,book,perWeek}')::integer
    union all
    -- Günlük görevler: çalışılan her gün
    select 'quest', (q->>'id') || ':' || x.d, (q->>'reward')::integer
      from jsonb_array_elements(c #> '{elmas,quests}') q cross join public.economy_days(uid) x
     where q->>'scope' = 'day' and public.economy_quest_progress(uid, q->>'id', x.d) >= (q->>'target')::integer
    union all
    -- Haftalık görevler: çalışılan ya da kitap bitirilen her hafta
    select 'quest', (q->>'id') || ':' || w.p, (q->>'reward')::integer
      from jsonb_array_elements(c #> '{elmas,quests}') q
     cross join (
       select distinct x.d - (extract(isodow from x.d)::integer - 1) p from public.economy_days(uid) x
       union
       select distinct finished_on - (extract(isodow from finished_on)::integer - 1) from public.books
        where user_id = uid and finished_on is not null and finished_on <= current_date + 1
     ) w
     where q->>'scope' = 'week' and public.economy_quest_progress(uid, q->>'id', w.p) >= (q->>'target')::integer
  ) e
  where e.amount > 0
  on conflict (user_id, currency, kind, ref) do update set amount = excluded.amount
    where excluded.amount > public.crystal_ledger.amount;
  perform set_config('economy.server', 'off', true);
end $$;

-- Gezintide yıldız: günde perDay tane (sıra 0…perDay-1), yalnızca bugün (saat dilimi için ±1 gün)
create or replace function public.collect_star(p_date date, p_index integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if p_date not between current_date - 1 and current_date + 1
     or p_index not between 0 and public.cfg_int('{stars,perDay}') - 1 then
    raise exception 'Bu yıldız toplanamaz';
  end if;
  perform set_config('economy.server', 'on', true);
  insert into public.crystal_ledger (user_id, currency, kind, ref, amount)
    values (auth.uid(), 'star', 'star', p_date::text || ':' || p_index, 1)
    on conflict (user_id, currency, kind, ref) do nothing;
  perform set_config('economy.server', 'off', true);
end $$;

-- Ebeveyn hediyesi (aile paneli PIN'i istemcide bir çocuk kilididir; tutar sunucuda sınırlı)
create or replace function public.gift_elmas(p_amount integer, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if p_amount not between 1 and public.cfg_int('{elmas,giftMax}') then
    raise exception 'Hediye 1–% Elmas olabilir', public.cfg_int('{elmas,giftMax}');
  end if;
  perform set_config('economy.server', 'on', true);
  insert into public.crystal_ledger (user_id, currency, kind, ref, amount, note)
    values (auth.uid(), 'crystal', 'gift', gen_random_uuid()::text, p_amount, nullif(left(btrim(coalesce(p_note, '')), 120), ''));
  perform set_config('economy.server', 'off', true);
end $$;

-- ---------- Satın alma ve sandık ----------
-- Fiyat item_defs'ten; bakiye yetmezse ret; yetiyorsa harcama satırı aynı işlemde yazılır.
-- Sandık: haftanın hedefi (güvenilir kayıtlarla) tuttuysa ve eşya sandık havuzundaysa bir kez.
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

create or replace function public.owned_charge() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pr integer;
begin
  if new.via = 'buy' then
    select price into pr from public.item_defs where id = new.item_id;
    perform set_config('economy.server', 'on', true);
    insert into public.crystal_ledger (user_id, currency, kind, ref, amount, note)
      values (new.user_id, 'crystal', 'buy', new.id::text, -pr, new.item_id);
    perform set_config('economy.server', 'off', true);
  end if;
  return new;
end $$;

-- 0008'in fiyat listesi artık item_defs'te
drop function if exists public.economy_allowed(uuid, text, text, text);
drop function if exists public.economy_quest(uuid, text, text);
drop function if exists public.shop_price(text);
