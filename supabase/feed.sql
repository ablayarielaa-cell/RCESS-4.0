-- RCESS News Feed — run once in Supabase Dashboard -> SQL Editor.
-- Viewers post one or more pictures with or without a caption, and every signed
-- in user sees everyone's posts; the admin is the only role offered downloads.
--
-- Without Supabase Auth every API call arrives as "anon", so the database
-- cannot tell an admin from a viewer. The app hides download and delete from
-- non-admins; these policies allow anyone holding the anon key to post and read.

create table if not exists public.feed_posts (
  id text primary key default gen_random_uuid()::text,
  image_paths text[] not null default '{}',
  caption text not null default '',
  posted_by text not null default '',
  posted_at_iso text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

alter table public.feed_posts enable row level security;

drop policy if exists "feed_posts_read" on public.feed_posts;
create policy "feed_posts_read" on public.feed_posts
  for select to anon, authenticated using (true);

drop policy if exists "feed_posts_insert" on public.feed_posts;
create policy "feed_posts_insert" on public.feed_posts
  for insert to anon, authenticated with check (true);

drop policy if exists "feed_posts_delete" on public.feed_posts;
create policy "feed_posts_delete" on public.feed_posts
  for delete to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, delete on public.feed_posts to anon, authenticated;

-- Storage bucket for the pictures. Public read, so the feed can render them
-- straight from the URL; the download button in the app stays admin-only.
insert into storage.buckets (id, name, public)
values ('feed', 'feed', true)
on conflict (id) do nothing;

drop policy if exists "feed_storage_read" on storage.objects;
create policy "feed_storage_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'feed');

drop policy if exists "feed_storage_upload" on storage.objects;
create policy "feed_storage_upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'feed');

drop policy if exists "feed_storage_update" on storage.objects;
create policy "feed_storage_update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'feed') with check (bucket_id = 'feed');

drop policy if exists "feed_storage_delete" on storage.objects;
create policy "feed_storage_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'feed');
