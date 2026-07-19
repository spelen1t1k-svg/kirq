-- KIRQ · 0003 — game logic as SECURITY DEFINER functions.
-- The app's API routes call these via the service role. Numbers mirrored from
-- src/config/game.ts: ELO_K=32, MM_BASE_WINDOW=100, MM_EXPAND_PER_30S=50,
-- VETO_TURN_SECONDS=30, RESULT_AUTOCONFIRM_MIN=15, DODGE_PENALTY=25.

-- ---------- new-user bootstrap ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    new.raw_user_meta_data ->> 'global_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, 'player'), '@', 1)
  );
  insert into public.profiles (id, username, avatar_url)
  values (new.id, left(v_name, 24), new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- season & rating helpers ----------
create or replace function public.current_season()
returns int
language sql stable security definer set search_path = public
as $$
  select id from public.seasons where active limit 1;
$$;

create or replace function public.ensure_rating(p_user uuid, p_mode public.game_mode)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_season int := public.current_season();
  v_elo int;
begin
  insert into public.ratings (user_id, mode, season_id)
  values (p_user, p_mode, v_season)
  on conflict (user_id, mode, season_id) do nothing;
  select elo into v_elo from public.ratings
  where user_id = p_user and mode = p_mode and season_id = v_season;
  return v_elo;
end;
$$;

-- ---------- rate limiting ----------
-- Returns true if the action is ALLOWED (and consumes one unit).
create or replace function public.rate_limit_allow(
  p_user uuid, p_action text, p_max int, p_window_seconds int
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  insert into public.rate_limits (user_id, action, window_start, count)
  values (p_user, p_action, now(), 1)
  on conflict (user_id, action) do update
    set count = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then 1 else public.rate_limits.count + 1 end,
        window_start = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then now() else public.rate_limits.window_start end
  returning * into v;
  return v.count <= p_max;
end;
$$;

-- ---------- chat ----------
create or replace function public.sys_msg(p_match bigint, p_body text)
returns void
language sql security definer set search_path = public
as $$
  insert into public.match_chat (match_id, user_id, username, body)
  values (p_match, null, null, p_body);
$$;

create or replace function public.post_chat(p_match bigint, p_user uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if not public.is_match_participant(p_match, p_user) then
    raise exception 'not a participant';
  end if;
  if not public.rate_limit_allow(p_user, 'chat', 20, 30) then
    raise exception 'rate limited';
  end if;
  select username into v_name from public.profiles where id = p_user;
  insert into public.match_chat (match_id, user_id, username, body)
  values (p_match, p_user, v_name, left(p_body, 500));
end;
$$;

-- ---------- queue ----------
create or replace function public.join_queue(p_user uuid, p_mode public.game_mode)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_elo int;
begin
  if not public.rate_limit_allow(p_user, 'queue', 12, 60) then
    raise exception 'rate limited';
  end if;
  if exists (select 1 from public.profiles where id = p_user and banned_until > now()) then
    raise exception 'banned';
  end if;
  if not exists (select 1 from public.kirka_accounts where user_id = p_user and status = 'verified') then
    raise exception 'kirka account not verified';
  end if;
  -- awaiting_results / disputed matches don't block re-queueing
  if exists (
    select 1 from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = p_user
      and m.status in ('veto_region', 'veto_map', 'lobby', 'ready', 'live')
  ) then
    raise exception 'already in an active match';
  end if;
  v_elo := public.ensure_rating(p_user, p_mode);
  insert into public.queue (user_id, mode, elo)
  values (p_user, p_mode, v_elo)
  on conflict (user_id) do update set mode = excluded.mode, elo = excluded.elo, joined_at = now();
end;
$$;

create or replace function public.leave_queue(p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.queue where user_id = p_user;
$$;

-- ---------- match creation ----------
create or replace function public.create_match(
  p_mode public.game_mode, p_users uuid[], p_teams smallint[]
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_match bigint;
  v_season int := public.current_season();
  v_pool text[];
  v_host uuid;
  v_first_captain uuid;
  i int;
begin
  select coalesce(array_agg(id order by id), '{}') into v_pool
  from public.map_pool where mode = p_mode and active;

  insert into public.matches (mode, season_id, status, map_pool, veto_deadline)
  values (p_mode, v_season, 'veto_region', v_pool, now() + interval '30 seconds')
  returning id into v_match;

  for i in 1 .. array_length(p_users, 1) loop
    insert into public.match_players (match_id, user_id, team, elo_at_start)
    values (
      v_match, p_users[i], p_teams[i],
      (select elo from public.queue where user_id = p_users[i])
    );
  end loop;

  -- captains: highest elo per team; host & first veto turn: highest elo overall
  update public.match_players mp set is_captain = true
  where mp.match_id = v_match
    and mp.user_id in (
      select distinct on (team) user_id from public.match_players
      where match_id = v_match order by team, elo_at_start desc, user_id
    );

  select user_id into v_host from public.match_players
  where match_id = v_match order by elo_at_start desc, user_id limit 1;
  update public.match_players set is_host = true where match_id = v_match and user_id = v_host;

  select user_id into v_first_captain from public.match_players
  where match_id = v_match and is_captain order by elo_at_start desc, user_id limit 1;

  update public.matches set host_user_id = v_host, veto_turn = v_first_captain
  where id = v_match;

  delete from public.queue where user_id = any (p_users);

  perform public.sys_msg(v_match, 'MATCH #' || v_match || ' CREATED · REGION VETO BEGINS');
  return v_match;
end;
$$;

-- ---------- matchmaker ----------
-- Elo window: 100 + 50 per full 30s waited (mirrors config).
create or replace function public.mm_window(p_joined timestamptz)
returns int
language sql stable
as $$
  select 1000000;  -- match any Elo gap (low online); matchmaker still prefers closest first
$$;

create or replace function public.run_matchmaker()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_created int := 0;
  q1 record;
  q2 record;
  grp record;
  v_skip uuid[] := '{}';
  v_found boolean;
begin
  -- one matchmaker at a time
  perform pg_advisory_xact_lock(hashtext('kirq_matchmaker'));

  -- ===== 1v1 =====
  loop
    select * into q1 from public.queue
    where mode = '1v1' and not (user_id = any (v_skip))
    order by joined_at limit 1;
    exit when not found;

    select * into q2 from public.queue
    where mode = '1v1' and user_id <> q1.user_id
      and abs(elo - q1.elo) <= greatest(public.mm_window(q1.joined_at), public.mm_window(joined_at))
    order by abs(elo - q1.elo), joined_at limit 1;

    if found then
      perform public.create_match('1v1', array[q1.user_id, q2.user_id], array[1, 2]::smallint[]);
      v_created := v_created + 1;
    else
      v_skip := v_skip || q1.user_id;
    end if;
  end loop;

  -- ===== 2v2_point: sliding window of 4 by elo =====
  loop
    v_found := false;
    for grp in
      select u1.user_id a, u2.user_id b, u3.user_id c, u4.user_id d,
             u4.elo - u1.elo as spread,
             greatest(public.mm_window(u1.joined_at), public.mm_window(u2.joined_at),
                      public.mm_window(u3.joined_at), public.mm_window(u4.joined_at)) as win
      from (
        select user_id, elo, joined_at,
               row_number() over (order by elo, joined_at) rn
        from public.queue where mode = '2v2_point'
      ) u1
      join lateral (select * from (
        select user_id, elo, joined_at, row_number() over (order by elo, joined_at) rn
        from public.queue where mode = '2v2_point') t where t.rn = u1.rn + 1) u2 on true
      join lateral (select * from (
        select user_id, elo, joined_at, row_number() over (order by elo, joined_at) rn
        from public.queue where mode = '2v2_point') t where t.rn = u1.rn + 2) u3 on true
      join lateral (select * from (
        select user_id, elo, joined_at, row_number() over (order by elo, joined_at) rn
        from public.queue where mode = '2v2_point') t where t.rn = u1.rn + 3) u4 on true
      order by spread
      limit 1
    loop
      if grp.spread <= grp.win then
        -- balanced teams: strongest + weakest vs the middle two
        perform public.create_match(
          '2v2_point',
          array[grp.a, grp.d, grp.b, grp.c],
          array[1, 1, 2, 2]::smallint[]
        );
        v_created := v_created + 1;
        v_found := true;
      end if;
    end loop;
    exit when not v_found;
  end loop;

  return v_created;
end;
$$;

-- ---------- veto ----------
create or replace function public.other_captain(p_match bigint, p_user uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select user_id from public.match_players
  where match_id = p_match and is_captain and user_id <> p_user
  limit 1;
$$;

create or replace function public.lock_map_if_one_left(p_match bigint)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  v_left text[];
  v_name text;
begin
  select * into m from public.matches where id = p_match for update;
  select coalesce(array_agg(x), '{}') into v_left
  from unnest(m.map_pool) x
  where x not in (select map_id from public.map_bans where match_id = p_match);

  if array_length(v_left, 1) = 1 then
    select name into v_name from public.map_pool where mode = m.mode and id = v_left[1];
    update public.matches
    set status = 'lobby', map_id = v_left[1], map_name = coalesce(v_name, v_left[1]),
        veto_turn = null, veto_deadline = null
    where id = p_match;
    perform public.sys_msg(p_match,
      'VETO COMPLETE · MAP: ' || coalesce(v_name, v_left[1]) || ' / ' || m.region ||
      ' · WAITING FOR HOST TO PUBLISH THE ROOM');
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.perform_region_ban(
  p_match bigint, p_actor uuid, p_region public.region, p_auto boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  v_ord smallint;
  v_left public.region[];
  v_name text;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status <> 'veto_region' then raise exception 'not in region veto'; end if;
  if m.veto_turn is distinct from p_actor then raise exception 'not your turn'; end if;
  if exists (select 1 from public.region_bans where match_id = p_match and region = p_region) then
    raise exception 'region already banned';
  end if;

  select coalesce(max(ord), 0) + 1 into v_ord from public.region_bans where match_id = p_match;
  insert into public.region_bans (match_id, region, banned_by, auto, ord)
  values (p_match, p_region, p_actor, p_auto, v_ord);

  select username into v_name from public.profiles where id = p_actor;
  perform public.sys_msg(p_match, upper(coalesce(v_name, '?')) || ' BANNED REGION ' || p_region ||
    case when p_auto then ' (AUTO)' else '' end);

  select coalesce(array_agg(r), '{}') into v_left
  from unnest(enum_range(null::public.region)) r
  where r not in (select region from public.region_bans where match_id = p_match);

  if array_length(v_left, 1) = 1 then
    update public.matches
    set region = v_left[1], status = 'veto_map',
        veto_turn = public.other_captain(p_match, p_actor),
        veto_deadline = now() + interval '30 seconds'
    where id = p_match;
    perform public.sys_msg(p_match, 'REGION LOCKED: ' || v_left[1] || ' · MAP VETO BEGINS');
    -- degenerate pools (0/1 maps) skip straight to lobby
    perform public.lock_map_if_one_left(p_match);
  else
    update public.matches
    set veto_turn = public.other_captain(p_match, p_actor),
        veto_deadline = now() + interval '30 seconds'
    where id = p_match;
  end if;
end;
$$;

create or replace function public.perform_map_ban(
  p_match bigint, p_actor uuid, p_map text, p_auto boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  v_ord smallint;
  v_name text;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status <> 'veto_map' then raise exception 'not in map veto'; end if;
  if m.veto_turn is distinct from p_actor then raise exception 'not your turn'; end if;
  if not (p_map = any (m.map_pool)) then raise exception 'unknown map'; end if;
  if exists (select 1 from public.map_bans where match_id = p_match and map_id = p_map) then
    raise exception 'map already banned';
  end if;

  select coalesce(max(ord), 0) + 1 into v_ord from public.map_bans where match_id = p_match;
  insert into public.map_bans (match_id, map_id, banned_by, auto, ord)
  values (p_match, p_map, p_actor, p_auto, v_ord);

  select username into v_name from public.profiles where id = p_actor;
  perform public.sys_msg(p_match, upper(coalesce(v_name, '?')) || ' BANNED ' ||
    upper(regexp_replace(p_map, '(1v1|2v2)$', '')) || case when p_auto then ' (AUTO)' else '' end);

  if not public.lock_map_if_one_left(p_match) then
    update public.matches
    set veto_turn = public.other_captain(p_match, p_actor),
        veto_deadline = now() + interval '30 seconds'
    where id = p_match;
  end if;
end;
$$;

-- ---------- lobby / ready / start ----------
create or replace function public.publish_room(p_match bigint, p_actor uuid, p_url text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status not in ('lobby', 'ready') then raise exception 'room can only be set in lobby'; end if;
  if m.host_user_id is distinct from p_actor then raise exception 'only the host publishes the room'; end if;
  if not public.rate_limit_allow(p_actor, 'room', 10, 60) then raise exception 'rate limited'; end if;

  insert into public.room_links (match_id, url, posted_by) values (p_match, p_url, p_actor);
  update public.matches set room_link = p_url where id = p_match;
  perform public.sys_msg(p_match, 'HOST PUBLISHED THE ROOM → ' || p_url);
end;
$$;

create or replace function public.set_ready(p_match bigint, p_actor uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  v_total int;
  v_ready int;
  v_name text;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status <> 'lobby' then raise exception 'ready is only available in lobby'; end if;
  if m.room_link is null then raise exception 'room not published yet'; end if;
  if not public.is_match_participant(p_match, p_actor) then raise exception 'not a participant'; end if;

  insert into public.match_ready (match_id, user_id) values (p_match, p_actor)
  on conflict do nothing;

  select username into v_name from public.profiles where id = p_actor;
  perform public.sys_msg(p_match, upper(coalesce(v_name, '?')) || ' IS READY');

  select count(*) into v_total from public.match_players where match_id = p_match;
  select count(*) into v_ready from public.match_ready where match_id = p_match;
  if v_ready >= v_total then
    update public.matches set status = 'ready' where id = p_match;
    perform public.sys_msg(p_match, 'ALL PLAYERS READY · HOST SETS THE START TIME');
  end if;
end;
$$;

create or replace function public.set_start_time(p_match bigint, p_actor uuid, p_time text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status <> 'ready' then raise exception 'all players must be ready first'; end if;
  if m.host_user_id is distinct from p_actor then raise exception 'only the host sets start time'; end if;
  if p_time !~ '^\d{1,2}:\d{2}$' then raise exception 'time must look like 58:30'; end if;

  update public.matches set start_time_text = p_time, status = 'live' where id = p_match;
  perform public.sys_msg(p_match, 'START AT ' || p_time || ' (KIRKA CLOCK) · MATCH IS LIVE');
end;
$$;

-- ---------- results & elo ----------
create or replace function public.finalize_match(
  p_match bigint, p_sa int, p_sb int, p_reason text default 'match'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  v_winner smallint;
  avg1 numeric;
  avg2 numeric;
  exp1 numeric;
  d1 int;
  p record;
  v_delta int;
  v_new int;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status in ('completed', 'cancelled') then raise exception 'match already closed'; end if;
  if p_sa = p_sb then raise exception 'draws are not allowed'; end if;
  v_winner := case when p_sa > p_sb then 1 else 2 end;

  select avg(elo_at_start) filter (where team = 1),
         avg(elo_at_start) filter (where team = 2)
  into avg1, avg2
  from public.match_players where match_id = p_match;

  exp1 := 1 / (1 + power(10, (avg2 - avg1) / 400.0));
  d1 := round(32 * ((case when v_winner = 1 then 1 else 0 end) - exp1));

  for p in select * from public.match_players where match_id = p_match loop
    v_delta := case when p.team = 1 then d1 else -d1 end;
    perform public.ensure_rating(p.user_id, m.mode);
    update public.ratings
    set elo = elo + v_delta,
        wins = wins + case when p.team = v_winner then 1 else 0 end,
        losses = losses + case when p.team = v_winner then 0 else 1 end,
        peak = greatest(peak, elo + v_delta),
        updated_at = now()
    where user_id = p.user_id and mode = m.mode and season_id = m.season_id
    returning elo into v_new;
    insert into public.elo_history (user_id, mode, season_id, match_id, delta, elo_after, reason)
    values (p.user_id, m.mode, m.season_id, p_match, v_delta, v_new, p_reason);
  end loop;

  update public.matches
  set status = 'completed', score_a = p_sa, score_b = p_sb,
      winner_team = v_winner, completed_at = now()
  where id = p_match;
  update public.disputes set status = 'resolved', resolved_at = now()
  where match_id = p_match and status = 'open';
  perform public.sys_msg(p_match, 'MATCH COMPLETE · ' || p_sa || ':' || p_sb || ' · ELO UPDATED');
end;
$$;

create or replace function public.submit_result(
  p_match bigint, p_actor uuid, p_sa int, p_sb int, p_screenshot text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  v_team smallint;
  r1 public.results;
  r2 public.results;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status not in ('live', 'awaiting_results') then
    raise exception 'match is not accepting results';
  end if;
  select team into v_team from public.match_players
  where match_id = p_match and user_id = p_actor;
  if v_team is null then raise exception 'not a participant'; end if;
  if p_screenshot is null or length(p_screenshot) < 5 then
    raise exception 'scoreboard screenshot is required';
  end if;
  if not public.rate_limit_allow(p_actor, 'result', 6, 60) then raise exception 'rate limited'; end if;

  insert into public.results (match_id, submitted_by, team, score_a, score_b, screenshot_path)
  values (p_match, p_actor, v_team, p_sa, p_sb, p_screenshot)
  on conflict (match_id, team) do update
    set submitted_by = excluded.submitted_by,
        score_a = excluded.score_a, score_b = excluded.score_b,
        screenshot_path = excluded.screenshot_path, created_at = now();

  update public.matches set status = 'awaiting_results' where id = p_match;

  select * into r1 from public.results where match_id = p_match and team = 1;
  select * into r2 from public.results where match_id = p_match and team = 2;

  if r1 is not null and r2 is not null then
    if r1.score_a = r2.score_a and r1.score_b = r2.score_b and r1.score_a <> r1.score_b then
      perform public.finalize_match(p_match, r1.score_a, r1.score_b);
    else
      update public.matches set status = 'disputed' where id = p_match;
      insert into public.disputes (match_id) values (p_match)
      on conflict (match_id) do update set status = 'open', resolved_at = null;
      perform public.sys_msg(p_match,
        'RESULT DISPUTED · ' || r1.score_a || ':' || r1.score_b || ' vs ' ||
        r2.score_a || ':' || r2.score_b || ' · SENT TO MODERATORS');
    end if;
  end if;
end;
$$;

-- ---------- penalties & cancellation ----------
create or replace function public.apply_penalty(
  p_user uuid, p_mode public.game_mode, p_season int, p_amount int, p_reason text, p_match bigint
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_new int;
begin
  perform public.ensure_rating(p_user, p_mode);
  update public.ratings set elo = greatest(0, elo - p_amount), updated_at = now()
  where user_id = p_user and mode = p_mode and season_id = p_season
  returning elo into v_new;
  insert into public.elo_history (user_id, mode, season_id, match_id, delta, elo_after, reason)
  values (p_user, p_mode, p_season, p_match, -p_amount, v_new, p_reason);
end;
$$;

create or replace function public.cancel_match(
  p_match bigint, p_reason text, p_penalize uuid[] default '{}'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches;
  u uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status in ('completed', 'cancelled') then return; end if;
  update public.matches set status = 'cancelled', completed_at = now() where id = p_match;
  perform public.sys_msg(p_match, 'MATCH CANCELLED · ' || p_reason);
  foreach u in array p_penalize loop
    perform public.apply_penalty(u, m.mode, m.season_id, 25, 'penalty_noshow', p_match);
  end loop;
end;
$$;

-- ---------- timeouts sweep (cron + lazy) ----------
create or replace function public.apply_timeouts()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m record;
  v_opt text;
  v_region public.region;
  r public.results;
  v_noshows uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('kirq_timeouts'));

  -- 1) veto turn expired → auto-ban a random remaining option
  for m in
    select * from public.matches
    where status in ('veto_region', 'veto_map') and veto_deadline < now()
  loop
    if m.status = 'veto_region' then
      select r2 into v_region from unnest(enum_range(null::public.region)) r2
      where r2 not in (select region from public.region_bans where match_id = m.id)
      order by random() limit 1;
      if v_region is not null then
        perform public.perform_region_ban(m.id, m.veto_turn, v_region, true);
      end if;
    else
      select x into v_opt from unnest(m.map_pool) x
      where x not in (select map_id from public.map_bans where match_id = m.id)
      order by random() limit 1;
      if v_opt is not null then
        perform public.perform_map_ban(m.id, m.veto_turn, v_opt, true);
      end if;
    end if;
  end loop;

  -- 2) single-sided result auto-confirms after 15 minutes
  for m in
    select mt.* from public.matches mt
    where mt.status = 'awaiting_results'
      and (select count(*) from public.results r2 where r2.match_id = mt.id) = 1
      and (select max(r2.created_at) from public.results r2 where r2.match_id = mt.id)
          < now() - interval '15 minutes'
  loop
    select * into r from public.results where match_id = m.id limit 1;
    if r.score_a <> r.score_b then
      perform public.finalize_match(m.id, r.score_a, r.score_b, 'auto_confirm');
    end if;
  end loop;

  -- 3) stale lobbies: cancel after 60 min; players who never readied while at
  --    least one opponent was ready take the no-show penalty (−25)
  for m in
    select * from public.matches
    where status in ('lobby', 'ready') and created_at < now() - interval '60 minutes'
  loop
    if exists (select 1 from public.match_ready where match_id = m.id) then
      select coalesce(array_agg(mp.user_id), '{}') into v_noshows
      from public.match_players mp
      where mp.match_id = m.id
        and mp.user_id not in (select user_id from public.match_ready where match_id = m.id);
    else
      v_noshows := '{}';
    end if;
    perform public.cancel_match(m.id, 'LOBBY TIMED OUT', v_noshows);
  end loop;

  -- 4) live matches with no result for 3h → cancel without penalties
  for m in
    select * from public.matches
    where status = 'live' and created_at < now() - interval '3 hours'
      and not exists (select 1 from public.results r2 where r2.match_id = matches.id)
  loop
    perform public.cancel_match(m.id, 'NO RESULTS SUBMITTED', '{}');
  end loop;
end;
$$;

-- ---------- admin ----------
create or replace function public.admin_log(
  p_admin uuid, p_action text, p_target uuid, p_match bigint, p_details jsonb
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.admin_actions (admin_id, action, target_user, match_id, details)
  values (p_admin, p_action, p_target, p_match, p_details);
$$;

create or replace function public.admin_resolve_dispute(
  p_admin uuid, p_match bigint, p_sa int, p_sb int
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_admin) then raise exception 'admin only'; end if;
  perform public.finalize_match(p_match, p_sa, p_sb, 'admin_resolve');
  perform public.admin_log(p_admin, 'resolve_dispute', null, p_match,
    jsonb_build_object('score_a', p_sa, 'score_b', p_sb));
end;
$$;

create or replace function public.admin_cancel_match(
  p_admin uuid, p_match bigint, p_reason text, p_penalize uuid[] default '{}'
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_admin) then raise exception 'admin only'; end if;
  perform public.cancel_match(p_match, coalesce(p_reason, 'CANCELLED BY MODERATOR'), p_penalize);
  update public.disputes set status = 'resolved', resolved_by = p_admin, resolved_at = now(),
    resolution = coalesce(p_reason, 'cancelled')
  where match_id = p_match and status = 'open';
  perform public.admin_log(p_admin, 'cancel_match', null, p_match,
    jsonb_build_object('reason', p_reason, 'penalized', p_penalize));
end;
$$;

create or replace function public.admin_adjust_elo(
  p_admin uuid, p_user uuid, p_mode public.game_mode, p_delta int, p_reason text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_season int := public.current_season();
  v_new int;
begin
  if not public.is_admin(p_admin) then raise exception 'admin only'; end if;
  perform public.ensure_rating(p_user, p_mode);
  update public.ratings set elo = greatest(0, elo + p_delta), updated_at = now()
  where user_id = p_user and mode = p_mode and season_id = v_season
  returning elo into v_new;
  insert into public.elo_history (user_id, mode, season_id, delta, elo_after, reason)
  values (p_user, p_mode, v_season, p_delta, v_new, 'admin_adjust');
  perform public.admin_log(p_admin, 'adjust_elo', p_user, null,
    jsonb_build_object('mode', p_mode, 'delta', p_delta, 'reason', p_reason));
end;
$$;

create or replace function public.admin_ban_user(
  p_admin uuid, p_user uuid, p_until timestamptz, p_reason text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_admin) then raise exception 'admin only'; end if;
  update public.profiles set banned_until = p_until, ban_reason = p_reason where id = p_user;
  delete from public.queue where user_id = p_user;
  perform public.admin_log(p_admin, 'ban_user', p_user, null,
    jsonb_build_object('until', p_until, 'reason', p_reason));
end;
$$;

create or replace function public.admin_review_kirka(
  p_admin uuid, p_user uuid, p_approve boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_admin) then raise exception 'admin only'; end if;
  update public.kirka_accounts
  set status = case when p_approve then 'verified'::public.verify_status else 'rejected'::public.verify_status end,
      verified_at = case when p_approve then now() else null end
  where user_id = p_user;
  perform public.admin_log(p_admin, 'review_kirka', p_user, null,
    jsonb_build_object('approved', p_approve));
end;
$$;
