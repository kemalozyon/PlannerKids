-- Planlama ve aile: günlük ders planı, aile ayarları (PIN, plan onayı), ebeveyn notları, ödül hedefleri.

-- Günlük plan: bir günde bir derse kaç dakika ayrıldığı.
create table if not exists public.study_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  course_id   uuid not null references public.courses(id) on delete cascade,
  minutes     integer not null check (minutes between 5 and 600),
  note        text check (char_length(note) <= 120),
  approved    boolean not null default true,   -- aile onayı açıksa çocuğun değişikliği false gelir
  created_at  timestamptz not null default now(),
  unique (user_id, date, course_id)
);
create index if not exists study_plans_user_date_idx on public.study_plans (user_id, date);

-- Aile paneli ayarları. PIN düz metin değil, SHA-256 özeti olarak tutulur.
-- Not: PIN bir çocuk kilidi, güvenlik önlemi değil (aynı hesapla girilir).
create table if not exists public.family_settings (
  user_id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  pin_hash                text,
  require_plan_approval   boolean not null default false,
  updated_at              timestamptz not null default now()
);

-- Ebeveynin çocuğa bıraktığı not; çocuk "teşekkürler" ya da "kalp" ile yanıt verebilir.
create table if not exists public.parent_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 500),
  reaction    text check (reaction in ('thanks', 'heart')),
  created_at  timestamptz not null default now()
);
create index if not exists parent_notes_user_created_idx on public.parent_notes (user_id, created_at desc);

-- Gerçek ödül hedefleri. İlerleme start_date'ten itibaren kayıtlardan hesaplanır; orman parasını harcamaz.
create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  kind        text not null check (kind in ('minutes', 'streak', 'books', 'plans')),
  target      integer not null check (target between 1 and 100000),
  given_by    text check (char_length(given_by) <= 40),
  start_date  date not null default current_date,
  claimed_on  date,                                -- ebeveyn ödülü verdi
  created_at  timestamptz not null default now()
);

alter table public.study_plans     enable row level security;
alter table public.family_settings enable row level security;
alter table public.parent_notes    enable row level security;
alter table public.rewards         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['study_plans','family_settings','parent_notes','rewards'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all
         using (user_id = auth.uid())
         with check (user_id = auth.uid())', t);
  end loop;
end $$;
