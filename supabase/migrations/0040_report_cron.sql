-- Günlük raporun zamanlayıcısı: pg_cron her saat :05'te daily-report Edge Function'ını çağırır,
-- function gönderim saati gelmiş kullanıcılara raporu yollar (core.ts → dueReportDate).
--
-- ÖNCE (bir kez, SQL Editor'de): CRON_SECRET'ı Vault'a koy — function secret'ıyla aynı değer olmalı.
--   select vault.create_secret('<CRON_SECRET>', 'daily_report_cron_secret');
-- Değiştirmek için:
--   select vault.update_secret((select id from vault.secrets where name = 'daily_report_cron_secret'), '<YENİ>');
-- Böylece gizli değer git'e girmez.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Aynı adla tekrar çalıştırmak işi günceller.
-- timeout: pg_net'in varsayılanı 5 sn; Gemini daha uzun sürer, yarıda kesilmesin.
select cron.schedule(
  'daily-report-hourly',
  '5 * * * *',
  $$ select net.http_post(
       url     := 'https://nvchshjxvwgktsqhtuax.supabase.co/functions/v1/daily-report',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'daily_report_cron_secret')
       ),
       body    := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);

-- Kontrol:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'daily-report-hourly') order by start_time desc limit 5;
--   select id, status_code, left(content, 300), error_msg, created from net._http_response order by created desc limit 5;
