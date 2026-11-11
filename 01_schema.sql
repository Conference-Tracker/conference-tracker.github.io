-- Conference Tracker: database schema
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- Two kinds of data are kept apart:
--   1. Conference data (table: conferences), maintained by the host (admin).
--   2. Personal data (profiles, user_marks, suggestions, feedback), owned by each user.
-- Conferences are never deleted, only archived, so personal links to them always survive updates.

create extension if not exists pgcrypto;

-- ---------- Admins (the host) ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Conference data ----------
create table if not exists public.conferences (
  id            text primary key,              -- permanent ID, e.g. 'euram27'. Never reuse or change.
  series        text,                          -- links editions, e.g. 'euram'
  name          text not null,
  host          text not null,
  host_score    smallint not null check (host_score between 1 and 5),
  host_note     text,
  region        text not null,                 -- 'India' or 'International'
  continent     text,                          -- 'India', 'Europe', 'Varies', ...
  country       text,
  city          text,
  mode          text,
  start_date    date,
  end_date      date,
  date_text     text,                          -- used when exact dates are not announced
  deadline      date,
  deadline_note text,
  areas         text[] not null default '{}',
  journals      jsonb  not null default '[]',  -- [{n: name, a: 'A*'|'A'|'B'|'C'|null, t: 'route'|'assoc'|'pdw'|'proc'}]
  url           text,
  note          text,
  override      jsonb,                         -- {tier, reason} when the host adjusts a tier
  placeholder   boolean not null default false,-- a top-30 school whose conference is to be confirmed
  archived      boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- ---------- Personal data ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default '',
  title         text,
  institution   text,
  role          text,
  country       text,
  discs         text[] not null default '{}',
  specs         text[] not null default '{}',
  own_topic     text,
  regions       text[] not null default '{}',
  tiers         text[] not null default '{"A*","A","B"}',
  inapp         boolean not null default true,
  system_notif  boolean not null default false,
  consent_at    timestamptz,                   -- when the person accepted the privacy policy
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.user_marks (
  user_id        uuid not null references auth.users (id) on delete cascade,
  conference_id  text not null references public.conferences (id) on delete restrict,
  status         text check (status in ('considering','planning','submitted','accepted','registered','attended','hidden')),
  bell           boolean not null default false,
  paper_title    text,
  decision_date  date,
  reg_deadline   date,
  attend_role    text,
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (user_id, conference_id)
);

create table if not exists public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  organiser   text not null,
  details     jsonb not null default '{}',    -- every other answer; "I don't know" is stored as such
  status      text not null default 'under_review' check (status in ('under_review','added','declined')),
  editor_note text,
  created_at  timestamptz not null default now()
);

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  would_use   text,
  missing     text,
  how_today   text,
  rating      smallint check (rating between 1 and 5),
  created_at  timestamptz not null default now()
);

-- ---------- Keep updated_at current ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_conferences_touch on public.conferences;
create trigger trg_conferences_touch before update on public.conferences for each row execute function public.touch_updated_at();
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_marks_touch on public.user_marks;
create trigger trg_marks_touch before update on public.user_marks for each row execute function public.touch_updated_at();

-- ---------- Row-level security: who can see and change what ----------
alter table public.admins      enable row level security;
alter table public.conferences enable row level security;
alter table public.profiles    enable row level security;
alter table public.user_marks  enable row level security;
alter table public.suggestions enable row level security;
alter table public.feedback    enable row level security;

-- Admins table: only admins can read it; changes are made in the SQL editor.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated using (public.is_admin());

-- Conferences: everyone (even signed out) can read; only the host can add or edit; nobody can delete.
drop policy if exists conf_read on public.conferences;
create policy conf_read on public.conferences for select to anon, authenticated using (true);
drop policy if exists conf_insert on public.conferences;
create policy conf_insert on public.conferences for insert to authenticated with check (public.is_admin());
drop policy if exists conf_update on public.conferences;
create policy conf_update on public.conferences for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: each person reads and writes only their own. The host can read profiles (for context on feedback).
drop policy if exists prof_select on public.profiles;
create policy prof_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists prof_insert on public.profiles;
create policy prof_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists prof_update on public.profiles;
create policy prof_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists prof_delete on public.profiles;
create policy prof_delete on public.profiles for delete to authenticated using (id = auth.uid());

-- Statuses and reminders: strictly private to each person (the host cannot read them either).
drop policy if exists marks_all on public.user_marks;
create policy marks_all on public.user_marks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Suggestions: anyone signed in can send one; they see their own; the host sees and reviews all.
drop policy if exists sug_insert on public.suggestions;
create policy sug_insert on public.suggestions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists sug_select on public.suggestions;
create policy sug_select on public.suggestions for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists sug_update on public.suggestions;
create policy sug_update on public.suggestions for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Feedback: anyone signed in can send it; they see their own; the host sees all.
drop policy if exists fb_insert on public.feedback;
create policy fb_insert on public.feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists fb_select on public.feedback;
create policy fb_select on public.feedback for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Lets the signed-in app ask "am I the host?" without exposing the admins list.
grant execute on function public.is_admin() to authenticated;
