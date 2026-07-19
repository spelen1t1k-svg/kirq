-- KIRQ · 0002 — Row Level Security
-- Philosophy: clients are read-only. Every mutation goes through the app's
-- API routes (service role) or SECURITY DEFINER functions with validation.

-- ---------- helpers ----------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

create or replace function public.is_match_participant(mid bigint, uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.match_players where match_id = mid and user_id = uid
  );
$$;

-- ---------- enable RLS everywhere ----------
alter table public.profiles      enable row level security;
alter table public.kirka_accounts enable row level security;
alter table public.seasons       enable row level security;
alter table public.ratings       enable row level security;
alter table public.map_pool      enable row level security;
alter table public.queue         enable row level security;
alter table public.matches       enable row level security;
alter table public.match_players enable row level security;
alter table public.region_bans   enable row level security;
alter table public.map_bans      enable row level security;
alter table public.match_chat    enable row level security;
alter table public.room_links    enable row level security;
alter table public.match_ready   enable row level security;
alter table public.results       enable row level security;
alter table public.disputes      enable row level security;
alter table public.elo_history   enable row level security;
alter table public.admin_actions enable row level security;
alter table public.rate_limits   enable row level security;

-- ---------- public/authenticated reads ----------
-- Profiles, seasons, ratings, elo history and the map pool are public data
-- (leaderboards & profiles are visible before sign-in, per landing design).
create policy "profiles readable" on public.profiles for select using (true);
create policy "seasons readable" on public.seasons for select using (true);
create policy "ratings readable" on public.ratings for select using (true);
create policy "map_pool readable" on public.map_pool for select using (true);
create policy "elo_history readable" on public.elo_history for select using (true);

-- Matches & players & veto results are readable by signed-in users
-- (needed for profiles' match history and the live match window).
create policy "matches readable" on public.matches
  for select using (auth.role() = 'authenticated');
create policy "match_players readable" on public.match_players
  for select using (auth.role() = 'authenticated');
create policy "region_bans readable" on public.region_bans
  for select using (auth.role() = 'authenticated');
create policy "map_bans readable" on public.map_bans
  for select using (auth.role() = 'authenticated');

-- Queue rows are visible to signed-in users (live counters); only mode+time
-- matter to others, but rows carry no secrets.
create policy "queue readable" on public.queue
  for select using (auth.role() = 'authenticated');

-- ---------- participant-only reads ----------
create policy "chat for participants" on public.match_chat
  for select using (
    public.is_match_participant(match_id, auth.uid()) or public.is_admin(auth.uid())
  );
create policy "room links for participants" on public.room_links
  for select using (
    public.is_match_participant(match_id, auth.uid()) or public.is_admin(auth.uid())
  );
create policy "ready for participants" on public.match_ready
  for select using (
    public.is_match_participant(match_id, auth.uid()) or public.is_admin(auth.uid())
  );
create policy "results for participants" on public.results
  for select using (
    public.is_match_participant(match_id, auth.uid()) or public.is_admin(auth.uid())
  );
create policy "disputes for participants" on public.disputes
  for select using (
    public.is_match_participant(match_id, auth.uid()) or public.is_admin(auth.uid())
  );

-- ---------- own-only reads ----------
create policy "own kirka account" on public.kirka_accounts
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ---------- admin-only ----------
create policy "admin actions readable by admins" on public.admin_actions
  for select using (public.is_admin(auth.uid()));

-- rate_limits: no client access at all (service role only).

-- NOTE: there are deliberately NO insert/update/delete policies for
-- authenticated users on any table. The service role bypasses RLS.
