-- RCESS Schedule — run once in Supabase Dashboard -> SQL Editor.
-- The Schedule tab (renamed from Match Schedule) now stores the window during
-- which each post is visible to viewers, so an admin can publish the whole
-- multi-day event schedule at once and have each day appear and disappear on
-- its own. Empty bounds mean unbounded: no start shows it immediately, no end
-- keeps it up until the admin deletes it.

alter table public.schedule_posts
  add column if not exists visible_from_iso text not null default '';

alter table public.schedule_posts
  add column if not exists visible_to_iso text not null default '';
