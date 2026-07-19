-- KIRQ · 0004 — storage buckets, policies, seed data, scheduling

-- ---------- storage: single private bucket for all screenshots ----------
-- Paths:
--   kirka/<user_id>/<file>          — kirka account verification screenshots
--   results/<match_id>/<user_id>-<file> — scoreboard screenshots
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 8388608,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "upload own screenshots" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (
      name like 'kirka/' || auth.uid() || '/%'
      or name ~ ('^results/[0-9]+/' || auth.uid() || '-')
    )
  );

create policy "read own screenshots" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'screenshots'
    and (
      name like 'kirka/' || auth.uid() || '/%'
      or name ~ ('^results/[0-9]+/' || auth.uid() || '-')
      or public.is_admin(auth.uid())
    )
  );
-- (Match participants view each other's evidence via short-lived signed URLs
--  minted by the API after a participant check — no broad read policy needed.)

-- ---------- seed: first season ----------
insert into public.seasons (name, active, starts_at)
select 'Season 1', true, now()
where not exists (select 1 from public.seasons);

-- ---------- scheduling (OPTIONAL but recommended) ----------
-- The Vercel cron hits /api/cron/tick every minute, and clients waiting in
-- queue trigger the matchmaker every 5s via /api/queue/poll. For a fully
-- server-side 5-second cadence, enable pg_cron (Dashboard → Database →
-- Extensions) and run:
--
--   select cron.schedule('kirq-matchmaker', '5 seconds',
--     $$ select public.run_matchmaker(); select public.apply_timeouts(); $$);
--
-- Supabase pg_cron supports sub-minute schedules ('5 seconds').
