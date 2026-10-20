-- Günlük ebeveyn raporu: ayarlar ve gönderim kaydı (günde en fazla bir rapor).

create table if not exists public.report_settings (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  parent_email  text check (parent_email is null or parent_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  child_name    text check (child_name is null or char_length(child_name) <= 40),
  send_hour     smallint not null default 21 check (send_hour between 0 and 23), -- yedek gönderim saati (yerel)
  timezone      text not null default 'Europe/Istanbul',
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date          date not null,
  trigger       text not null check (trigger in ('button', 'schedule')),
  status        text not null default 'sending' check (status in ('sending', 'sent')),
  subject       text,
  html          text,
  generated_by  text check (generated_by in ('llm', 'fallback')),
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.report_settings enable row level security;
alter table public.daily_reports   enable row level security;

drop policy if exists "own rows" on public.report_settings;
create policy "own rows" on public.report_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Raporlar: kullanıcı kendi raporlarını görür. Ekleme/güncelleme/silme Edge Function üzerinden
-- (buton modunda kullanıcının JWT'siyle) yapılır; kullanıcı yalnızca kendi satırına dokunabilir.
drop policy if exists "own rows" on public.daily_reports;
create policy "own rows" on public.daily_reports for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Zamanlayıcı (pg_cron + pg_net): 0040_report_cron.sql.
