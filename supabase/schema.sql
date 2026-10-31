-- RCESS portal schema for Supabase.
-- Run in Supabase Dashboard -> SQL Editor.
--
-- LOGIN MODEL: no Supabase Auth. An account is a row in public.profiles holding
-- a username, a role and a bcrypt password hash. The login page sends the
-- username and password to the sign_in() function below, which checks them and
-- answers with the role. Email is never involved anywhere.
--
-- Add an account (once per person):
--
--   insert into public.profiles (username, role, password_hash)
--   values ('admin', 'admin', crypt('type-a-password-here', gen_salt('bf')))
--   on conflict (username)
--     do update set role = excluded.role,
--                   password_hash = excluded.password_hash;
--
-- Change a password later:
--
--   update public.profiles
--      set password_hash = crypt('new-password-here', gen_salt('bf'))
--    where username = 'admin';
--
-- Roles: admin does everything including Settings; staff and sports edit the
-- modules the admin ticks in Settings; viewer reads only.
--
-- The password is stored as a bcrypt hash and public.profiles is granted to
-- nobody, so the data API cannot read it; only sign_in() sees it.

create extension if not exists pgcrypto;

-- Accounts -------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  role text not null default 'viewer'
    check (role in ('guest', 'viewer', 'admin', 'staff', 'sports')),
  password_hash text not null default '',
  created_at timestamptz not null default now()
);

-- If this project previously ran the Supabase Auth version of this file, the
-- table above already exists and "create table if not exists" changed nothing.
-- Detach it from auth.users and add the password column, so one paste of this
-- file is enough to move an existing project over.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
  loop
    execute format('alter table public.profiles drop constraint %I', v_con);
  end loop;
end;
$$;

alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists password_hash text not null default '';

-- SECURITY DEFINER so the caller never needs read access to public.profiles and
-- the hash itself never leaves the database.
create or replace function public.sign_in(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_username text;
  v_role     text;
  v_hash     text;
begin
  v_username := lower(btrim(coalesce(p_username, '')));

  if v_username = '' or coalesce(p_password, '') = '' then
    return null;
  end if;

  select p.role, p.password_hash
    into v_role, v_hash
    from public.profiles p
   where lower(btrim(p.username)) = v_username
   limit 1;

  if v_hash is null then
    -- Spend the same effort as a real check so a fast "no such account"
    -- answer cannot be used to list which usernames exist.
    perform crypt(p_password, gen_salt('bf', 10));
    return null;
  end if;

  if not (crypt(p_password, v_hash) = v_hash) then
    return null;
  end if;

  return jsonb_build_object('role', v_role, 'username', v_username);
end;
$$;

-- Single-row modules ---------------------------------------------------------

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  countdown_iso text not null default '2026-08-01T00:00:00+08:00',
  countdown_closed boolean not null default false,
  bracket_auto_advance boolean not null default true,

  -- The admin-authored catalogue: [{ id, name, placements, entryPoints,
  -- noEntryPoints, events: [{ id, name }] }]. A category's award table is shared
  -- by every event in it (Basketball and Volleyball pay the same in Sports), so
  -- a flat text array cannot hold it.
  events jsonb not null default '[]'::jsonb,

  -- Derived from the catalogue by the app, and still written so a project opened
  -- by an older build sees its events.
  sports text[] not null default '{}',
  permissions jsonb not null default '{
    "settingsEditors": ["admin"],
    "newsEditors": ["admin"],
    "summitEditors": ["admin"],
    "leaderboardEditors": ["admin"],
    "bracketEditors": ["admin"],
    "scheduleEditors": ["admin"],
    "mapEditors": ["admin"]
  }'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.summit_info (
  id int primary key default 1 check (id = 1),
  title text not null default '',
  subtitle text not null default '',
  venue text not null default '',
  date_label text not null default '',
  notes text not null default ''
);

create table if not exists public.map_info (
  id int primary key default 1 check (id = 1),
  embed_url text not null default '',
  notes text not null default '',
  locations jsonb not null default '[]'::jsonb
);

-- Multi-row modules ----------------------------------------------------------

create table if not exists public.news (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  body text not null default '',
  type text not null default 'Announcement'
    check (type in ('Announcement', 'Update', 'Reminder')),
  posted_at_iso text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

create table if not exists public.schedule_posts (
  id text primary key default gen_random_uuid()::text,
  -- No longer editable: a post has no sport, but the column is NOT NULL, so the
  -- app writes 'General' for every row.
  sport text not null,
  title text not null,
  location text not null default '',

  -- Whatever the admin typed as the time, shown to viewers verbatim. The name is
  -- kept because the deployed table already uses this column; rows posted before
  -- it became free text hold an ISO stamp, which the app renders as a time.
  time_iso text not null,

  -- No longer editable: the app writes 'Starting' for every row because the
  -- check constraint below is part of tables that already exist.
  status text not null default 'Starting'
    check (status in ('Starting', 'In Game')),
  posted_at_iso text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),

  -- When the post appears in, and disappears from, the viewer's Schedule tab.
  -- Empty means unbounded, so an admin can post all event days at once.
  visible_from_iso text not null default '',
  visible_to_iso text not null default ''
);

-- Projects created before the schedule window existed.
alter table public.schedule_posts add column if not exists visible_from_iso text not null default '';
alter table public.schedule_posts add column if not exists visible_to_iso text not null default '';

create table if not exists public.leaderboard_rows (
  id text primary key default gen_random_uuid()::text,
  team text not null,
  points integer not null default 0,
  sport text not null default 'Overall'
);

create table if not exists public.brackets (
  id text primary key default gen_random_uuid()::text,
  sport text not null default 'Basketball',
  name text not null default 'Bracket',
  format text not null default 'single'
    check (format in ('single', 'double')),
  teams text[] not null default '{}',
  rounds jsonb not null default '[]'::jsonb,
  losers_rounds jsonb,
  grand_final jsonb
);

-- News Feed ------------------------------------------------------------------
-- Viewers post one or more pictures with or without a caption; everyone signed
-- in sees them, and the pictures live in the public "feed" storage bucket while
-- this row keeps their paths and metadata.

create table if not exists public.feed_posts (
  id text primary key default gen_random_uuid()::text,
  image_paths text[] not null default '{}',
  caption text not null default '',
  posted_by text not null default '',
  posted_at_iso text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

insert into storage.buckets (id, name, public)
values ('feed', 'feed', true)
on conflict (id) do nothing;

-- Evaluation -----------------------------------------------------------------
-- The admin builds the form and picks the open/close dates in Settings; that is
-- this one row. Every signed in user who answers adds a row to
-- evaluation_responses, and the admin's Evaluation tab aggregates them.
-- Responses are append-only: the app never updates or deletes them.

create table if not exists public.evaluation_form (
  id integer primary key default 1 check (id = 1),
  title text not null default 'Event Evaluation',
  description text not null default '',
  opens_at_iso text not null default '',
  closes_at_iso text not null default '',
  questions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluation_responses (
  id text primary key default gen_random_uuid()::text,
  username text not null default '',
  answers jsonb not null default '{}'::jsonb,
  comment text not null default '',
  submitted_at_iso text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

insert into public.evaluation_form (id) values (1)
  on conflict (id) do nothing;

-- Seed rows ------------------------------------------------------------------
-- A future countdown target, so a brand new project is not born closed.

insert into public.app_settings (id, sports, countdown_iso)
  values (
    1,
    array['Basketball', 'Volleyball', 'Badminton', 'Chess'],
    to_char((now() + interval '180 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  on conflict (id) do nothing;

insert into public.summit_info (id, title, subtitle, venue, date_label, notes)
  values (1, 'Regional Civil Engineering Students Summit', 'Summit Hub', 'Coming soon', 'Coming soon', 'Replace placeholders with official details.')
  on conflict (id) do nothing;

insert into public.map_info (id, notes) values (1, 'Paste a Google Maps embed URL here.')
  on conflict (id) do nothing;

-- Row Level Security ---------------------------------------------------------
-- Without Supabase Auth there is no JWT, so Postgres cannot tell an admin from a
-- visitor: every API call arrives as the "anon" role. Portal content is
-- therefore open to read and write through the data API, and the role rules in
-- app_settings.permissions are enforced by the app. public.profiles is the one
-- table the database still guards.

do $$
declare
  tname text;
  pol   record;
begin
  for tname in
    select x.table_name
    from (values
      ('app_settings'),
      ('summit_info'),
      ('map_info'),
      ('news'),
      ('schedule_posts'),
      ('leaderboard_rows'),
      ('brackets'),
      ('feed_posts'),
      ('evaluation_form'),
      ('evaluation_responses')
    ) as x(table_name)
  loop
    execute format('alter table public.%I enable row level security', tname);

    -- Rebuild from scratch so re-running this file is always safe.
    for pol in
      select p.polname
      from pg_policy p
      where p.polrelid = format('public.%I', tname)::regclass
    loop
      execute format('drop policy %I on public.%I', pol.polname, tname);
    end loop;

    execute format(
      'create policy "%1$s_read" on public.%1$I for select to anon, authenticated using (true)',
      tname
    );
    execute format(
      'create policy "%1$s_insert" on public.%1$I for insert to anon, authenticated with check (true)',
      tname
    );
    execute format(
      'create policy "%1$s_update" on public.%1$I for update to anon, authenticated using (true) with check (true)',
      tname
    );
    execute format(
      'create policy "%1$s_delete" on public.%1$I for delete to anon, authenticated using (true)',
      tname
    );
  end loop;

  -- Accounts: RLS on with zero policies means the data API sees an empty table.
  execute 'alter table public.profiles enable row level security';

  for pol in
    select p.polname from pg_policy p where p.polrelid = 'public.profiles'::regclass
  loop
    execute format('drop policy %I on public.profiles', pol.polname);
  end loop;
end;
$$;

-- Privileges -----------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.app_settings,
  public.summit_info,
  public.map_info,
  public.news,
  public.schedule_posts,
  public.leaderboard_rows,
  public.brackets,
  public.feed_posts
to anon, authenticated;

-- The form is a settings-style singleton; responses are append-only, so nobody
-- gets update or delete on them.
grant select, insert, update on public.evaluation_form to anon, authenticated;
grant select, insert on public.evaluation_responses to anon, authenticated;

-- No grants at all on the accounts table, and no help from the catch-all
-- grants a previous version of this file applied.
revoke all on public.profiles from anon, authenticated, service_role;

grant execute on function public.sign_in(text, text) to anon, authenticated;

-- Feed pictures: anyone with the app key may post and view them.
drop policy if exists "feed_storage_read" on storage.objects;
create policy "feed_storage_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'feed');

drop policy if exists "feed_storage_upload" on storage.objects;
create policy "feed_storage_upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'feed');

drop policy if exists "feed_storage_delete" on storage.objects;
create policy "feed_storage_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'feed');

-- Nothing here needs auth.users any more.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.current_role();
drop function if exists public.can_edit(text);
drop function if exists public.create_account(text, text, text);
drop function if exists public.reset_account(text, text);
drop function if exists public.remove_account(text);
