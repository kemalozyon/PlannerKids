-- Hangi migration'lar uygulanmış? Supabase SQL Editor'de çalıştır; her satırda ok = true ise o dosya çalışmış.
-- Config dosyaları (0011, 0014, 0016, 0018…) birbirinin yerine geçer: yalnızca en sonuncusunu çalıştırmak yeter.
select m, ok from (values
  ('0001_init', to_regclass('public.courses') is not null),
  ('0002_forest', to_regclass('public.forest_trees') is not null),
  ('0003_reading', to_regclass('public.books') is not null),
  ('0004_reports', to_regclass('public.report_settings') is not null),
  ('0005_plans_family', to_regclass('public.study_plans') is not null),
  ('0006_one_tree_per_day', to_regclass('public.forest_trees_user_date_key') is not null),
  ('0007_abandoned_sessions', to_regclass('public.abandoned_sessions') is not null),
  ('0008_economy', to_regclass('public.crystal_ledger') is not null),
  ('0009_sessions', to_regclass('public.study_sessions') is not null),
  ('0010_economy_v2', exists (select 1 from pg_proc where proname = 'collect_star')),
  ('0012_spaces', to_regclass('public.user_spaces') is not null),
  ('0013_books_shelf', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'books' and column_name = 'favorite_part')),
  ('0015_world_v2', exists (select 1 from pg_constraint where conname = 'item_defs_placement_check' and pg_get_constraintdef(oid) like '%wall%')),
  ('0017_world_v3', exists (select 1 from pg_proc where proname = 'world_ctx' and prosrc like '%mins%') and not exists (select 1 from pg_proc where proname = 'move_map')),
  ('0018_config', exists (select 1 from public.item_defs where id = 'dis:salincak')),
  ('0019_config', public.economy_cfg() #> '{world,rooms}' is not null),
  ('0020_rooms', exists (select 1 from pg_proc where proname = 'economy_best_streak')),
  ('0023_user_rooms', to_regclass('public.user_rooms') is not null),
  ('0024_config', public.economy_cfg() #> '{world,roomShapes}' is not null)
) v(m, ok)
order by m;
