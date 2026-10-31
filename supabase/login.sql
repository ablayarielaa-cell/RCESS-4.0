-- RCESS login only — safe to paste on its own, and idempotent.
-- Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- No Supabase Auth, no email, no JWT. An account is one row in public.profiles
-- with a username, a role and a bcrypt password hash. The login page calls
-- sign_in(username, password) and gets back the role.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  role text not null default 'viewer'
    check (role in ('guest', 'viewer', 'admin', 'staff', 'sports')),
  password_hash text not null default '',
  created_at timestamptz not null default now()
);

-- In case this project once attached profiles to auth.users.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'f'
  loop
    execute format('alter table public.profiles drop constraint %I', v_con);
  end loop;
end;
$$;

alter table public.profiles add column if not exists password_hash text not null default '';

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
    -- Same cost as a real check, so usernames cannot be listed by timing.
    perform crypt(p_password, gen_salt('bf', 10));
    return null;
  end if;

  if not (crypt(p_password, v_hash) = v_hash) then
    return null;
  end if;

  return jsonb_build_object('role', v_role, 'username', v_username);
end;
$$;

-- The data API must not read the hashes; only sign_in() may.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated, service_role;
grant execute on function public.sign_in(text, text) to anon, authenticated;

-- First account. Replace the password, then run this once per person.
insert into public.profiles (username, role, password_hash)
values ('admin', 'admin', crypt('change-this-password', gen_salt('bf')))
on conflict (username)
  do update set role = excluded.role, password_hash = excluded.password_hash;

-- Change a password later:
--   update public.profiles
--      set password_hash = crypt('new-password-here', gen_salt('bf'))
--    where username = 'admin';
