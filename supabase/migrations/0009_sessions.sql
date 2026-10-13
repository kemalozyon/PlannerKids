-- Güvenilir süre takibi: çalışma seansı sunucunun saatiyle tutulur, dakikayı sunucu hesaplar.
-- İstemci yalnızca başlat / buradayım / duraklat / sürdür / bitir / bırak der (aşağıdaki RPC'ler).
-- Kurallar istemcide de var (src/lib/session.ts); sayılar src/config/economy.json → economy_config tablosu.
--
-- Sayaç açıkken istemci dakikada bir session_beat çağırır. Son beat'ten sonra en fazla graceSeconds sayılır:
-- sekme kapanır, telefon kilitlenir ya da internet giderse süre kendiliğinden durur.
--
-- study_logs: sayaçtan gelen kayıtlar source = 'timer' (yalnızca session_finish yazar). İstemcinin doğrudan
-- eklediği kayıt her zaman 'manual' olur ve Elmas/ağaç vermez. Bu migration'dan önceki kayıtlar 'legacy'.

-- ---------- Config (tek satır; 0011_config.sql ve sonraki `npm run config:sql` migration'ları doldurur) ----------
create table if not exists public.economy_config (
  id          integer primary key default 1 check (id = 1),
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Eşya tanımları (src/config/items.json)
create table if not exists public.item_defs (
  id          text primary key,
  category    text not null,
  price       integer check (price > 0),                -- Elmas; null = satılmaz
  repeat      boolean not null default false,
  in_chest    boolean not null default false,           -- haftalık sandıktan çıkabilir
  w           integer not null default 1 check (w between 1 and 8),
  h           integer not null default 1 check (h between 1 and 8),
  rotations   integer[] not null default '{0}',
  placement   text check (placement in ('indoor', 'outdoor', 'both')),
  def         jsonb not null
);

alter table public.economy_config enable row level security;
alter table public.item_defs      enable row level security;
drop policy if exists "read" on public.economy_config;
drop policy if exists "read" on public.item_defs;
create policy "read" on public.economy_config for select using (true);
create policy "read" on public.item_defs for select using (true);

-- Config'ten bir değer: economy_cfg() #>> '{session,graceSeconds}'
create or replace function public.economy_cfg() returns jsonb
language sql stable as $$
  select coalesce((select value from public.economy_config where id = 1), '{}'::jsonb)
$$;

create or replace function public.cfg_int(path text[]) returns integer
language sql stable as $$
  select (public.economy_cfg() #>> path)::integer
$$;

-- ---------- Seanslar ----------
create table if not exists public.study_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id      uuid not null references public.courses(id) on delete cascade,
  date           date not null,                                   -- seansın başladığı yerel gün
  status         text not null default 'running' check (status in ('running', 'paused', 'finished', 'abandoned')),
  started_at     timestamptz not null default now(),
  active_ms      bigint not null default 0 check (active_ms >= 0),  -- kapanmış dilimlerin toplamı
  segment_start  timestamptz,                                     -- açık dilimin başı (duraklatılmışsa null)
  last_beat      timestamptz,
  ended_at       timestamptz,
  minutes        integer,
  note           text,
  log_id         uuid references public.study_logs(id) on delete set null
);
create index if not exists study_sessions_user_date_idx on public.study_sessions (user_id, date);
-- Aynı anda tek açık seans
create unique index if not exists study_sessions_one_open on public.study_sessions (user_id) where status in ('running', 'paused');

alter table public.study_sessions enable row level security;
-- Yalnızca okunur; her değişiklik aşağıdaki security definer fonksiyonlardan
drop policy if exists "own read" on public.study_sessions;
create policy "own read" on public.study_sessions for select using (user_id = auth.uid());

-- ---------- study_logs: kaynak ----------
alter table public.study_logs add column if not exists source text not null default 'legacy'
  check (source in ('legacy', 'timer', 'manual'));
alter table public.study_logs alter column source set default 'manual';
alter table public.study_logs add column if not exists session_id uuid references public.study_sessions(id) on delete set null;
create unique index if not exists study_logs_session_key on public.study_logs (session_id) where session_id is not null;

-- İstemcinin doğrudan eklediği kayıt elle yazılmıştır; süre, gün ve kaynak sonradan değiştirilemez.
-- Sunucu fonksiyonları `study.server` bayrağıyla yazar.
create or replace function public.study_logs_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('study.server', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.source := 'manual';
    new.session_id := null;
    return new;
  end if;
  if (new.duration_minutes, new.date, new.source, new.session_id, new.user_id)
     is distinct from (old.duration_minutes, old.date, old.source, old.session_id, old.user_id) then
    raise exception 'Kaydın süresi ve günü değiştirilemez';
  end if;
  return new;
end $$;

drop trigger if exists study_logs_guard on public.study_logs;
create trigger study_logs_guard before insert or update on public.study_logs
  for each row execute function public.study_logs_guard();

-- ---------- Seans RPC'leri ----------
-- İstemciye dönen biçim: seans satırı + sunucunun saati
create or replace function public.session_json(s public.study_sessions) returns jsonb
language sql stable as $$
  select jsonb_build_object('session', to_jsonb(s) - 'user_id', 'serverNow', now())
$$;

-- Açık dilimi kapatır: sayılan son an = şimdi - back ile son beat + tolerans'ın erken olanı
create or replace function public.session_close(s public.study_sessions, back_sec integer) returns public.study_sessions
language plpgsql stable as $$
declare
  grace interval := make_interval(secs => public.cfg_int('{session,graceSeconds}'));
  max_back integer := public.cfg_int('{session,idleMinutes}') * 60 + public.cfg_int('{session,idleAnswerSeconds}');
  stop timestamptz;
begin
  if s.status <> 'running' or s.segment_start is null then return s; end if;
  stop := least(now() - make_interval(secs => least(greatest(coalesce(back_sec, 0), 0), max_back)), s.last_beat + grace);
  s.active_ms := s.active_ms + greatest(0, floor(extract(epoch from (stop - s.segment_start)) * 1000))::bigint;
  s.segment_start := null;
  s.status := 'paused';
  return s;
end $$;

-- Kullanıcının seansını kilitleyerek okur
create or replace function public.session_get(p_id uuid) returns public.study_sessions
language plpgsql as $$
declare
  s public.study_sessions;
begin
  select * into s from public.study_sessions where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Seans bulunamadı'; end if;
  return s;
end $$;

create or replace function public.session_save(s public.study_sessions) returns jsonb
language plpgsql as $$
begin
  update public.study_sessions
     set status = s.status, active_ms = s.active_ms, segment_start = s.segment_start, last_beat = s.last_beat,
         ended_at = s.ended_at, minutes = s.minutes, note = s.note, course_id = s.course_id, log_id = s.log_id
   where id = s.id;
  return public.session_json(s);
end $$;

create or replace function public.session_open() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.session_json(s) from public.study_sessions s
   where s.user_id = auth.uid() and s.status in ('running', 'paused')
$$;

create or replace function public.session_start(p_course uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.study_sessions;
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if not exists (select 1 from public.courses where id = p_course and user_id = auth.uid()) then
    raise exception 'Ders bulunamadı';
  end if;
  -- Yerel gün sunucunun gününden en fazla bir gün farklı olabilir (saat dilimi)
  if p_date is null or p_date not between current_date - 1 and current_date + 1 then
    raise exception 'Seans günü geçersiz';
  end if;
  if exists (select 1 from public.study_sessions where user_id = auth.uid() and status in ('running', 'paused')) then
    raise exception 'Zaten açık bir seansın var';
  end if;
  insert into public.study_sessions (user_id, course_id, date, segment_start, last_beat)
    values (auth.uid(), p_course, p_date, now(), now())
    returning * into s;
  return public.session_json(s);
end $$;

create or replace function public.session_beat(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.study_sessions := public.session_get(p_id);
begin
  if s.status = 'running' then
    if now() > s.last_beat + make_interval(secs => public.cfg_int('{session,graceSeconds}')) then
      s := public.session_close(s, 0);       -- haber gelmedi: son beat + toleransta durmuş sayılır
    else
      s.last_beat := now();
    end if;
  end if;
  return public.session_save(s);
end $$;

create or replace function public.session_pause(p_id uuid, p_back integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.session_save(public.session_close(public.session_get(p_id), p_back));
end $$;

create or replace function public.session_resume(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.study_sessions := public.session_get(p_id);
begin
  if s.status = 'paused' then
    s.status := 'running';
    s.segment_start := now();
    s.last_beat := now();
  end if;
  return public.session_save(s);
end $$;

create or replace function public.session_finish(p_id uuid, p_course uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.study_sessions := public.session_get(p_id);
  n text := btrim(coalesce(p_note, ''));
  m integer;
  l public.study_logs;
begin
  if s.status not in ('running', 'paused') then raise exception 'Bu seans kapanmış'; end if;
  if char_length(n) < public.cfg_int('{session,noteMin}') then
    raise exception 'Ne çalıştığını kısaca yaz (en az % harf)', public.cfg_int('{session,noteMin}');
  end if;
  if char_length(n) > public.cfg_int('{session,noteMax}') then raise exception 'Not çok uzun'; end if;
  if p_course is not null and p_course <> s.course_id then
    if not exists (select 1 from public.courses where id = p_course and user_id = auth.uid()) then
      raise exception 'Ders bulunamadı';
    end if;
    s.course_id := p_course;
  end if;
  s := public.session_close(s, 0);
  m := least(public.cfg_int('{session,maxMinutes}'), (s.active_ms / 60000)::integer);
  if m < 1 then raise exception 'En az 1 dakika çalışınca kaydedebilirsin'; end if;
  perform set_config('study.server', 'on', true);
  insert into public.study_logs (user_id, course_id, date, duration_minutes, note, source, session_id)
    values (s.user_id, s.course_id, s.date, m, n, 'timer', s.id)
    returning * into l;
  perform set_config('study.server', 'off', true);
  s.status := 'finished';
  s.ended_at := now();
  s.minutes := m;
  s.note := n;
  s.log_id := l.id;
  perform public.session_save(s);
  -- Elmas hemen güncellensin (0010 çalıştırılmadıysa atla)
  if to_regprocedure('public.economy_sync()') is not null then
    execute 'select public.economy_sync()';
  end if;
  return jsonb_build_object('session', to_jsonb(s) - 'user_id', 'log', to_jsonb(l) - 'user_id');
end $$;

create or replace function public.session_abandon(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.study_sessions := public.session_get(p_id);
begin
  if s.status not in ('running', 'paused') then raise exception 'Bu seans kapanmış'; end if;
  s := public.session_close(s, 0);
  s.status := 'abandoned';
  s.ended_at := now();
  s.minutes := least(public.cfg_int('{session,maxMinutes}'), (s.active_ms / 60000)::integer);
  -- Uzun süren yarım seans adada solgun fidan bırakır (0007)
  if s.minutes >= public.cfg_int('{session,wiltMinutes}') then
    insert into public.abandoned_sessions (user_id, date, minutes) values (s.user_id, s.date, s.minutes);
  end if;
  perform public.session_save(s);
  return to_jsonb(s) - 'user_id';
end $$;

-- Yardımcılar dışarıdan çağrılmasın
revoke execute on function public.session_close(public.study_sessions, integer) from public, anon, authenticated;
revoke execute on function public.session_get(uuid) from public, anon, authenticated;
revoke execute on function public.session_save(public.study_sessions) from public, anon, authenticated;
