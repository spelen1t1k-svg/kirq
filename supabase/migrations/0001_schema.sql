-- KIRQ · 0001 — core schema
-- Conventions: all game-state WRITES go through SECURITY DEFINER functions /
-- the service role; clients only ever SELECT (see 0002_rls.sql).

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.game_mode as enum ('1v1', '2v2_point');
create type public.region as enum ('NA', 'EU', 'ASIA');
create type public.match_status as enum (
  'veto_region',      -- captains ban regions
  'veto_map',         -- captains ban maps
  'lobby',            -- host creates the room, players connect
  'ready',            -- everyone pressed READY, host sets start time
  'live',             -- start time announced, match is being played
  'awaiting_results', -- at least one side submitted a score
  'disputed',         -- scores mismatch, admin queue
  'completed',
  'cancelled'
);
create type public.verify_status as enum ('none', 'pending', 'verified', 'rejected');
create type public.dispute_status as enum ('open', 'resolved');

-- ---------- users ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  banned_until timestamptz,
  ban_reason text,
  created_at timestamptz not null default now()
);

create table public.kirka_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  kirka_nick text not null,
  method text not null check (method in ('api', 'screenshot')),
  verify_code text,
  status public.verify_status not null default 'pending',
  screenshot_path text,
  stats jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

-- ---------- seasons & ratings ----------
create table public.seasons (
  id serial primary key,
  name text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default false
);
create unique index seasons_one_active on public.seasons (active) where active;

create table public.ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode public.game_mode not null,
  season_id int not null references public.seasons (id),
  elo int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  peak int not null default 1000,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode, season_id)
);
create index ratings_leaderboard on public.ratings (season_id, mode, elo desc);

-- ---------- map pool (synced from /public/maps by the app) ----------
create table public.map_pool (
  mode public.game_mode not null,
  id text not null,          -- filename stem, e.g. 'Clash1v1'
  name text not null,        -- display name, e.g. 'CLASH'
  has_code boolean not null default false,
  active boolean not null default true,
  ord int not null default 0,
  primary key (mode, id)
);

-- ---------- queue ----------
create table public.queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mode public.game_mode not null,
  elo int not null,
  joined_at timestamptz not null default now()
);
create index queue_mode_idx on public.queue (mode, joined_at);

-- ---------- matches ----------
create table public.matches (
  id bigint generated always as identity primary key,
  mode public.game_mode not null,
  season_id int not null references public.seasons (id),
  status public.match_status not null default 'veto_region',
  map_pool text[] not null default '{}',   -- snapshot of map ids at creation
  region public.region,
  map_id text,
  map_name text,
  host_user_id uuid references public.profiles (id),
  veto_turn uuid references public.profiles (id),
  veto_deadline timestamptz,
  room_link text,
  start_time_text text,                    -- in-game Kirka clock, e.g. '58:30'
  score_a int,
  score_b int,
  winner_team smallint check (winner_team in (1, 2)),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index matches_status_idx on public.matches (status);

create table public.match_players (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team smallint not null check (team in (1, 2)),
  elo_at_start int not null,
  is_captain boolean not null default false,
  is_host boolean not null default false,
  primary key (match_id, user_id)
);
create index match_players_user_idx on public.match_players (user_id, match_id desc);

create table public.region_bans (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  region public.region not null,
  banned_by uuid references public.profiles (id),
  auto boolean not null default false,
  ord smallint not null,
  created_at timestamptz not null default now(),
  unique (match_id, region)
);

create table public.map_bans (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  map_id text not null,
  banned_by uuid references public.profiles (id),
  auto boolean not null default false,
  ord smallint not null,
  created_at timestamptz not null default now(),
  unique (match_id, map_id)
);

create table public.match_chat (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid references public.profiles (id),  -- null = system message
  username text,                                  -- denormalized for cheap rendering
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index match_chat_idx on public.match_chat (match_id, id);

create table public.room_links (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  url text not null,
  posted_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.match_ready (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ready_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- ---------- results & disputes ----------
create table public.results (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  submitted_by uuid not null references public.profiles (id),
  team smallint not null check (team in (1, 2)),
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  screenshot_path text not null,   -- mandatory scoreboard screenshot in Storage
  created_at timestamptz not null default now(),
  unique (match_id, team)          -- one submission per side
);

create table public.disputes (
  id bigint generated always as identity primary key,
  match_id bigint not null unique references public.matches (id) on delete cascade,
  status public.dispute_status not null default 'open',
  resolution text,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------- elo history & admin ----------
create table public.elo_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode public.game_mode not null,
  season_id int not null references public.seasons (id),
  match_id bigint references public.matches (id) on delete set null,
  delta int not null,
  elo_after int not null,
  reason text not null,   -- 'match' | 'penalty_noshow' | 'admin_adjust' | ...
  created_at timestamptz not null default now()
);
create index elo_history_user_idx on public.elo_history (user_id, mode, id desc);

create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id),
  action text not null,
  target_user uuid references public.profiles (id),
  match_id bigint references public.matches (id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------- rate limiting (server-side, per user+action) ----------
create table public.rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null default now(),
  count int not null default 0,
  primary key (user_id, action)
);

-- ---------- realtime ----------
alter publication supabase_realtime add table
  public.queue,
  public.matches,
  public.match_players,
  public.match_chat,
  public.region_bans,
  public.map_bans,
  public.room_links,
  public.match_ready,
  public.results;
