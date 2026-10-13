-- Dünyam v3: tek bağlı dünya, arazi yerinde büyür.
--
-- * Taşınma kalktı. Arazinin aşaması (economy_config → world.maps) güvenilir toplam dakikadan türer:
--   hours * 60 ≤ dakika olan son aşama. Saklanmaz; user_world tablosu durur ama artık okunmaz.
-- * Aşamalar yalnızca doğuya ve güneye büyür, kapı/pencere yerleri sabit kalır: kayıtlı yerleşimler geçerli kalır.
-- * Alanlar (oda, kütüphane, bahçe, ay bahçeleri) yine ayrı ayrı user_spaces'te; dünyadaki yerleri istemcide
--   hesaplanır (src/lib/worldPlan.ts). world_fixed, world_wall_blocked ve save_space değişmedi.
-- Sonra 0018_config.sql'i çalıştır (yeni aşamalar ve eşyalar).

create or replace function public.world_ctx(uid uuid, out minutes integer, out books integer, out trees integer, out map text)
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
           public.economy_cfg() #>> '{world,maps,0,id}')
    from t
$$;

drop function if exists public.move_map(text);
