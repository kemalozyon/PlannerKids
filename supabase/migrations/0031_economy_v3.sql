-- Ekonomi v3: canlı seans bonusu, elle yazılan süreye düşük tavanlı Elmas, aile görevleri, günün tohumu.
-- Önce 0030_config.sql'i çalıştır (elmas.live / manual / task ve tohum eşyaları orada), sonra bunu.
--
-- * Canlı bonus (live): günün sayaçla ölçülen (timer) dakikalarının elmas.live.bonus oranı kadar 💎.
-- * Elle yazılan (manual): elmas.manual.minutesPer dakikaya 1 💎, günde en çok capPerDay; kayıt gününden en çok
--   lateDays gün sonra yazılan kayıtlar sayılır (geçmişe toplu yazı Elmas vermez). Seri, sandık, görevler ve arazi
--   hâlâ yalnızca güvenilir (timer + legacy) kayıtları sayar.
-- * Ders + canlı bonus + elle yazılan birlikte günde en çok elmas.study.dailyCap (önce ders, sonra bonus, sonra elle).
--   Canlı bonus ve elle yazılan yalnızca from gününden itibaren (eski günler geriye dönük kazandırmaz).
-- * Aile görevi (task): aile panelinden verilen görev (tasks.from_parent) bitince elmas.task.each; günün ilk perDay
--   aile görevi sayılır (bitmemişler de sırayı tutar: birini geri alıp başkasını bitirmek fazladan vermez).
--   Aile paneli PIN'i istemcide bir çocuk kilididir; tavan zararı sınırlar.
-- * Günün tohumu (day_seeds): o günün ağacının türü. Yalnızca bugün (±1 gün), sahip olunan (ücretsiz ya da alınmış
--   tohum:<tür>) ve mevsiminde olan tür. Kurallar istemcide: src/lib/economy.ts, src/lib/seeds.ts.

-- ---------- Defter ----------
alter table public.crystal_ledger drop constraint if exists crystal_ledger_kind_check;
alter table public.crystal_ledger add constraint crystal_ledger_kind_check
  check (kind in ('study', 'live', 'manual', 'task', 'streak', 'plan', 'reflection', 'book', 'quest', 'star', 'gift', 'buy'));

-- ---------- Aile görevleri ----------
alter table public.tasks add column if not exists from_parent boolean not null default false;
create index if not exists tasks_parent_idx on public.tasks (user_id, date) where from_parent;

-- ---------- Günün Elmas'ı ----------
-- Her kayıtlı gün için ders, canlı bonus ve elle yazılan Elmas (src/lib/economy.ts → dayElmas)
create or replace function public.economy_day_elmas(uid uuid) returns table (d date, study integer, live integer, manual integer)
language plpgsql stable as $$
declare
  c jsonb := public.economy_cfg();
  cap integer := (c #>> '{elmas,study,dailyCap}')::integer;
  live_bonus numeric := (c #>> '{elmas,live,bonus}')::numeric;
  live_from date := (c #>> '{elmas,live,from}')::date;
  man_per integer := (c #>> '{elmas,manual,minutesPer}')::integer;
  man_cap integer := (c #>> '{elmas,manual,capPerDay}')::integer;
  man_late integer := (c #>> '{elmas,manual,lateDays}')::integer;
  man_from date := (c #>> '{elmas,manual,from}')::date;
  r record;
begin
  for r in
    select l.date dd,
           coalesce(sum(l.duration_minutes) filter (where l.source <> 'manual'), 0)::integer t,
           coalesce(sum(l.duration_minutes) filter (where l.source = 'timer'), 0)::integer tm,
           coalesce(sum(l.duration_minutes) filter (where l.source = 'manual' and l.created_at::date <= l.date + man_late), 0)::integer mm
      from public.study_logs l
     where l.user_id = uid and l.date <= current_date + 1
     group by l.date
  loop
    d := r.dd;
    study := public.economy_study_elmas(r.t);
    live := case when r.dd >= live_from then greatest(0, least(floor(r.tm * live_bonus)::integer, cap - study)) else 0 end;
    manual := case when r.dd >= man_from then greatest(0, least(r.mm / man_per, man_cap, cap - study - live)) else 0 end;
    return next;
  end loop;
end $$;

-- 0010'daki gibi; ders satırı artık economy_day_elmas'tan (aynı tutar) ve yanında live, manual, task
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
    select v.kind, x.d::text ref, v.amount
      from public.economy_day_elmas(uid) x
     cross join lateral (values ('study', x.study), ('live', x.live), ('manual', x.manual)) v(kind, amount)
    union all
    -- Aile görevleri: günün ilk perDay aile görevi, bitmişse
    select 'task', t.id::text, (c #>> '{elmas,task,each}')::integer from (
      select id, done, row_number() over (partition by date order by created_at, id) rn
        from public.tasks where user_id = uid and from_parent and date <= current_date + 1
    ) t where t.done and t.rn <= (c #>> '{elmas,task,perDay}')::integer
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

-- ---------- Günün tohumu ----------
create table if not exists public.day_seeds (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  species     text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.day_seeds enable row level security;
drop policy if exists "own read" on public.day_seeds;
drop policy if exists "own insert" on public.day_seeds;
drop policy if exists "own update" on public.day_seeds;
create policy "own read" on public.day_seeds for select using (user_id = auth.uid());
create policy "own insert" on public.day_seeds for insert with check (user_id = auth.uid());
create policy "own update" on public.day_seeds for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Yalnızca bugünün (±1 gün) tohumu; tür config'te olmalı, tohumu ücretsiz ya da alınmış, mevsiminde
create or replace function public.day_seeds_check() returns trigger
language plpgsql as $$
declare
  sp jsonb;
  def public.item_defs;
begin
  if new.date not between current_date - 1 and current_date + 1
     or (tg_op = 'UPDATE' and (new.user_id, new.date) is distinct from (old.user_id, old.date)) then
    raise exception 'Yalnızca bugünün tohumu seçilebilir';
  end if;
  select s into sp from jsonb_array_elements(public.economy_cfg() #> '{world,species}') s where s->>'id' = new.species;
  select * into def from public.item_defs where id = 'tohum:' || new.species;
  if sp is null or def.id is null then raise exception 'Böyle bir tohum yok'; end if;
  if def.price is not null and not exists (select 1 from public.owned_items where user_id = new.user_id and item_id = def.id) then
    raise exception 'Bu tohum sende değil';
  end if;
  if sp ? 'months' and not (sp -> 'months') @> to_jsonb(extract(month from new.date)::integer) then
    raise exception '% yalnızca mevsiminde ekilir', sp->>'name';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists day_seeds_check on public.day_seeds;
create trigger day_seeds_check before insert or update on public.day_seeds
  for each row execute function public.day_seeds_check();
