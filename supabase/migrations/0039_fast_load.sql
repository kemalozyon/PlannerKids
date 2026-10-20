-- Hızlı açılış: uygulama her yüklemede economy_sync + economy_pending çağırıyordu; ikisi de bütün kazançları
-- (economy_entries) baştan hesaplıyordu. economy_refresh ikisini tek çağrıda, kazançları bir kez hesaplayarak yapar.
-- economy_sync / economy_pending / claim_day olduğu gibi kalır (eski istemciler ve ağaçtan Elmas alma).

create or replace function public.economy_refresh() returns table (d date, amount integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  since date := public.economy_claim_from();
begin
  if uid is null then raise exception 'Giriş gerekli'; end if;
  perform pg_advisory_xact_lock(hashtext('economy:' || uid::text));
  perform set_config('economy.server', 'on', true);
  return query
  with e as materialized (
    select * from public.economy_entries(uid)
  ), ins as (
    -- economy_sync'in yazdığı: güne bağlı olmayanlar ve claim.from'dan önceki günler (kazanç hiç azalmaz)
    insert into public.crystal_ledger (user_id, currency, kind, ref, amount)
    select uid, 'crystal', e.kind, e.ref, e.amount from e where e.day is null or e.day < since
    on conflict (user_id, currency, kind, ref) do update set amount = excluded.amount
      where excluded.amount > public.crystal_ledger.amount
  )
  -- economy_pending'in döndürdüğü: ağaçlarda bekleyenler. Yukarıdaki yazma bu satırlara dokunmaz (day >= since),
  -- bu yüzden defterin yazmadan önceki hâlini okumak doğru sonuç verir.
  select e.day, sum(e.amount - coalesce(l.amount, 0))::integer
    from e
    left join public.crystal_ledger l
      on l.user_id = uid and l.currency = 'crystal' and l.kind = e.kind and l.ref = e.ref
   where e.day is not null and e.day >= since and e.amount > coalesce(l.amount, 0)
   group by e.day
   order by e.day;
  perform set_config('economy.server', 'off', true);
end $$;

revoke all on function public.economy_refresh() from public, anon;
grant execute on function public.economy_refresh() to authenticated;

-- Eksik indeksler: kitap kazançları/haftalık kitap görevi ve RLS altında açılış ekranının beklediği ders listesi
create index if not exists books_user_finished on public.books (user_id, finished_on);
create index if not exists courses_user on public.courses (user_id);
