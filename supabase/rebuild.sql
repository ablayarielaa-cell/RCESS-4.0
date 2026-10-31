-- RCESS portal: wipe everything the app owns, then rebuild.
--
-- Run THIS file first in Supabase -> SQL Editor, then run schema.sql, then the
-- insert at the bottom of this file. You lose every news post, bracket, schedule
-- row and account; the portal content comes back as the "Coming soon" seeds.
--
-- Safe to re-run.

-- 1. the trigger that came with the old Supabase Auth version
drop trigger if exists on_auth_user_created on auth.users;

-- 2. every function this project ever created
drop function if exists public.sign_in(text, text);
drop function if exists public.handle_new_user();
drop function if exists public.current_role();
drop function if exists public.can_edit(text);
drop function if exists public.create_account(text, text, text);
drop function if exists public.reset_account(text, text);
drop function if exists public.remove_account(text);

-- 3. the tables. Dropping a table drops its row-level security policies with it.
drop table if exists
  public.news,
  public.schedule_posts,
  public.leaderboard_rows,
  public.brackets,
  public.app_settings,
  public.summit_info,
  public.map_info,
  public.profiles
cascade;

-- ---------------------------------------------------------------------------
-- NOW RUN schema.sql, THEN create your account with a real hashed password:
--
--   insert into public.profiles (username, role, password_hash)
--   values ('admin', 'admin', crypt('type-your-password-here', gen_salt('bf')))
--   on conflict (username)
--     do update set role = excluded.role,
--                   password_hash = excluded.password_hash;
--
-- The crypt(...) call is what was missing before: the password column has to
-- hold the 60-character hash it produces, never the password itself.
-- ---------------------------------------------------------------------------
