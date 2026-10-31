-- RCESS account profile — run once in Supabase Dashboard -> SQL Editor.
-- Runs after supabase/login.sql (it reads public.profiles for the password check).
--
-- Gives every signed-in account a profile picture and a way to change the
-- password they were given, without switching to Supabase Auth.
--
-- Like the rest of this project there is no JWT, so every call arrives as
-- "anon" and the database cannot tell one account from another. The picture is
-- therefore keyed to the username the app already holds, and change_password()
-- insists on the current password before it writes a new hash.

-- One row per account, so an avatar follows the user to another device.
create table if not exists public.account_profiles (
  username text primary key,
  avatar_path text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.account_profiles enable row level security;

drop policy if exists "account_profiles_read" on public.account_profiles;
create policy "account_profiles_read" on public.account_profiles
  for select to anon, authenticated using (true);

drop policy if exists "account_profiles_insert" on public.account_profiles;
create policy "account_profiles_insert" on public.account_profiles
  for insert to anon, authenticated with check (true);

drop policy if exists "account_profiles_update" on public.account_profiles;
create policy "account_profiles_update" on public.account_profiles
  for update to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.account_profiles to anon, authenticated;

-- Pictures are resized to a square in the browser and saved as one file per
-- account, so replacing a picture cannot leave the feed full of dead objects.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_storage_read" on storage.objects;
create policy "avatars_storage_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');

drop policy if exists "avatars_storage_upload" on storage.objects;
create policy "avatars_storage_upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'avatars');

drop policy if exists "avatars_storage_update" on storage.objects;
create policy "avatars_storage_update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

drop policy if exists "avatars_storage_delete" on storage.objects;
create policy "avatars_storage_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'avatars');

-- Password change. Returns {'ok': true} or {'ok': false, 'error': '…'} instead of
-- raising, so the app shows one message for a wrong password and another for a
-- dropped connection.
create or replace function public.change_password(
  p_username text,
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_username text;
  v_hash     text;
  v_matches  boolean;
begin
  v_username := lower(btrim(coalesce(p_username, '')));

  if v_username = '' then
    return jsonb_build_object('ok', false, 'error', 'Sign in again and try once more.');
  end if;

  if coalesce(p_current_password, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter your current password.');
  end if;

  if char_length(coalesce(p_new_password, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'The new password needs at least 6 characters.');
  end if;

  select p.password_hash
    into v_hash
    from public.profiles p
   where lower(btrim(p.username)) = v_username
   limit 1;

  if v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'That account does not exist any more.');
  end if;

  -- Accounts made through the Table editor can have an empty hash. Nothing can
  -- be verified against it, so the administrator has to set the first password.
  if left(v_hash, 3) <> '$2' then
    return jsonb_build_object('ok', false, 'error', 'This account has no password yet. Ask an administrator to set one.');
  end if;

  -- coalesce: crypt() answers NULL for a unusable hash, and "if not (null)" would
  -- otherwise fall through and let the update run.
  select coalesce(crypt(p_current_password, v_hash) = v_hash, false)
    into v_matches;

  if not v_matches then
    return jsonb_build_object('ok', false, 'error', 'Your current password is not correct.');
  end if;

  update public.profiles
     set password_hash = crypt(p_new_password, gen_salt('bf', 10))
   where lower(btrim(username)) = v_username;

  return jsonb_build_object('ok', true);
end;
$$;

-- The data API still cannot read public.profiles; only this function touches it.
revoke all on function public.change_password(text, text, text) from public;
grant execute on function public.change_password(text, text, text) to anon, authenticated;
