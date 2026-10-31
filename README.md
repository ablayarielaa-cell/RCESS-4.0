# RCESS Portal

React + Vite single-page portal: public countdown (`Home`), username login (`Login`)
and the role-gated dashboard (`Dashboard`). Accounts and all portal content live
in Supabase; `localStorage` is only a first-paint cache plus the signed-in badge.

Login is **username + password only**. Supabase Auth is not used and email does
not exist anywhere in this project — an account is a row in `public.profiles`.

## Setup

1. Create a Supabase project and copy its **Project URL** and **publishable /
   anon key** from Project Settings -> API.
2. `cp .env.example .env`, then fill both values. `.env` is gitignored.
3. Open the Supabase SQL editor and run [`supabase/schema.sql`](supabase/schema.sql).
   It is safe to re-run and upgrades a project that previously used the
   Supabase Auth version of the schema.
   - To start over instead — dropping all content and every account — run
     [`supabase/rebuild.sql`](supabase/rebuild.sql) first, then `schema.sql`.
4. Add the accounts, one per person, in the SQL editor:

   ```sql
   insert into public.profiles (username, role, password_hash)
   values ('admin', 'admin', crypt('type-a-password-here', gen_salt('bf')))
   on conflict (username)
     do update set role = excluded.role,
                   password_hash = excluded.password_hash;
   ```

   The username and the password you type are exactly what the login page
   expects. Only the bcrypt hash is stored. Repeat for `staff`, `sports` and
   `viewer` accounts.
   - New password for someone:
     `update public.profiles set password_hash = crypt('new-password', gen_salt('bf')) where username = 'staff01';`
   - Remove an account: `delete from public.profiles where username = 'staff01';`
   - Roles: `admin`, `staff`, `sports`, `viewer`.
   - You may add rows through Table editor -> `profiles`, but then the password
     column has to be filled with the `crypt(...)` statement above — a password
     typed as plain text there will never match.

5. `npm install && npm run dev`, then open `/#/login`.

## Roles

- **admin** — every module plus Settings, including who may edit what.
- **staff / sports** — only the modules the admin ticks in Settings.
- **viewer** — reads everything, edits nothing. Gets the guided tour once.
- **guest** — the "Continue as Guest" pass: News and Leaderboard only.

Permissions live in `app_settings.permissions` and are checked in the app before
a save is offered.

## How it is wired

- `src/lib/supabase.ts` — client built from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`,
  with the Auth client switched off. Missing values throw at start rather than
  failing later.
- `src/lib/auth.ts` — calls the `sign_in()` SQL function, stores the returned
  role in `localStorage`, and provides the guest pass.
- `src/lib/store.ts` — portal types, bracket helpers and the local cache.
- `src/lib/storeCloud.ts` — reads the portal from Supabase and writes back only
  the modules that changed.
- `supabase/schema.sql` — tables, `sign_in(p_username, p_password)` and
  row-level security.

## What this login model does and does not protect

The password check happens in Postgres and `public.profiles` is granted to
nobody, so hashes are not readable and a stolen publishable key does not hand
over an account.

But because there is no Supabase Auth session, every API request arrives as the
`anon` role: the database cannot tell who is calling. Content tables are
therefore open to read and write through the REST API, and the role rules are
enforced by the app rather than by Postgres. The login gate keeps honest users
in the right section; it does not stop someone who posts directly to the API.
To get database-enforced roles the project has to go back through Supabase Auth
(or a server-side component that holds a `service_role` key), which is what this
version deliberately avoids.

Saving shows a "Saving to Supabase…" line and, on failure, an alert naming the
table Supabase rejected; the retry happens on the next save. The Home countdown
writes `countdownClosed` to `localStorage` only, so a visitor's browser closing
it does not change the saved target for everyone.
