-- RCESS Evaluation — run once in Supabase Dashboard -> SQL Editor.
-- The admin authors one evaluation form and schedules when it opens; everyone
-- signed in submits ratings during that window; the admin sees the averages.

create table if not exists public.evaluation_form (
  id int primary key default 1 check (id = 1),
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

insert into public.evaluation_form (id) values (1) on conflict (id) do nothing;

-- Same model as the other portal content: no Supabase Auth means every caller
-- is "anon", so the open window and the admin-only results are enforced by the
-- app.
do $$
declare
  tname text;
begin
  for tname in select x.table_name from (values
    ('evaluation_form'),
    ('evaluation_responses')
  ) as x(table_name)
  loop
    execute format('alter table public.%I enable row level security', tname);
    execute format('drop policy if exists "%1$s_read" on public.%1$I', tname);
    execute format('create policy "%1$s_read" on public.%1$I for select to anon, authenticated using (true)', tname);
    execute format('drop policy if exists "%1$s_insert" on public.%1$I', tname);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to anon, authenticated with check (true)', tname);
    execute format('drop policy if exists "%1$s_update" on public.%1$I', tname);
    execute format('create policy "%1$s_update" on public.%1$I for update to anon, authenticated using (true) with check (true)', tname);
  end loop;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.evaluation_form to anon, authenticated;
grant select, insert on public.evaluation_responses to anon, authenticated;
