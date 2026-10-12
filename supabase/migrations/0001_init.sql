-- Çalışma Takip Platformu — MVP şeması
-- Supabase SQL Editor'de çalıştırın (veya `supabase db push`).

create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text not null default '#4f7cff',
  created_at  timestamptz not null default now()
);

create table if not exists public.study_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id         uuid not null references public.courses(id) on delete cascade,
  date              date not null,
  duration_minutes  integer not null check (duration_minutes > 0 and duration_minutes <= 1440),
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists study_logs_user_date_idx on public.study_logs (user_id, date);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id   uuid references public.courses(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 200),
  date        date not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists tasks_user_date_idx on public.tasks (user_id, date);

create table if not exists public.daily_reflections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  rating      smallint check (rating between 1 and 5),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (user_id, date)
);

-- RLS: her kullanıcı yalnızca kendi satırlarını görür/değiştirir
alter table public.courses           enable row level security;
alter table public.study_logs        enable row level security;
alter table public.tasks             enable row level security;
alter table public.daily_reflections enable row level security;

do $$
declare t text;
begin
  foreach t in array array['courses','study_logs','tasks','daily_reflections'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all
         using (user_id = auth.uid())
         with check (user_id = auth.uid())', t);
  end loop;
end $$;
