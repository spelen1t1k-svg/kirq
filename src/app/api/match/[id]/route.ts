import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { roomProviderFor } from "@/lib/roomProvider";
import { REGIONS, type Region } from "@/config/game";

export const dynamic = "force-dynamic";

async function loadState(matchId: number, userId: string) {
  const admin = supabaseAdmin();

  const { data: match } = await admin.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (!match) return null;

  const { data: players } = await admin
    .from("match_players")
    .select("user_id, team, elo_at_start, is_captain, is_host, profiles(username)")
    .eq("match_id", matchId)
    .order("team")
    .order("elo_at_start", { ascending: false });

  if (!players?.some((p) => p.user_id === userId)) return "forbidden" as const;

  const [{ data: regionBans }, { data: mapBans }, { data: ready }, { data: chat }, { data: results }] =
    await Promise.all([
      admin.from("region_bans").select("region, banned_by, auto, ord").eq("match_id", matchId).order("ord"),
      admin.from("map_bans").select("map_id, banned_by, auto, ord").eq("match_id", matchId).order("ord"),
      admin.from("match_ready").select("user_id, ready_at").eq("match_id", matchId),
      admin.from("match_chat").select("id, user_id, username, body, created_at").eq("match_id", matchId).order("id", { ascending: false }).limit(100),
      admin.from("results").select("team, score_a, score_b, submitted_by, created_at").eq("match_id", matchId),
    ]);

  return {
    match,
    players,
    regionBans: regionBans ?? [],
    mapBans: mapBans ?? [],
    ready: ready ?? [],
    chat: (chat ?? []).reverse(),
    results: results ?? [],
    provider: { kind: roomProviderFor().kind, needsHostPanel: roomProviderFor().needsHostPanel },
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const matchId = Number((await params).id);
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // Lazy timeout enforcement: expired veto turns auto-ban even with no cron.
  const admin = supabaseAdmin();
  await admin.rpc("apply_timeouts");

  const state = await loadState(matchId, user.id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (state === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(state);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const matchId = Number((await params).id);
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: {
    action?: string; region?: string; map?: string; url?: string;
    time?: string; text?: string; scoreA?: number; scoreB?: number; screenshot?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  await admin.rpc("apply_timeouts");

  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

  try {
    switch (body.action) {
      case "ban_region": {
        if (!REGIONS.includes(body.region as Region)) return fail("unknown region");
        const { error } = await admin.rpc("perform_region_ban", {
          p_match: matchId, p_actor: user.id, p_region: body.region, p_auto: false,
        });
        if (error) return fail(error.message);
        break;
      }
      case "ban_map": {
        const { error } = await admin.rpc("perform_map_ban", {
          p_match: matchId, p_actor: user.id, p_map: body.map ?? "", p_auto: false,
        });
        if (error) return fail(error.message);
        break;
      }
      case "publish_room": {
        const check = roomProviderFor().validateRoomLink(body.url ?? "");
        if (!check.ok) return fail(check.error);
        const { error } = await admin.rpc("publish_room", {
          p_match: matchId, p_actor: user.id, p_url: check.url,
        });
        if (error) return fail(error.message);
        break;
      }
      case "ready": {
        const { error } = await admin.rpc("set_ready", { p_match: matchId, p_actor: user.id });
        if (error) return fail(error.message);
        break;
      }
      case "set_start": {
        const { error } = await admin.rpc("set_start_time", {
          p_match: matchId, p_actor: user.id, p_time: (body.time ?? "").trim(),
        });
        if (error) return fail(error.message);
        break;
      }
      case "chat": {
        const text = (body.text ?? "").trim();
        if (!text) return fail("empty message");
        const { error } = await admin.rpc("post_chat", {
          p_match: matchId, p_user: user.id, p_body: text,
        });
        if (error) return fail(error.message);
        break;
      }
      case "submit_result": {
        const sa = Number(body.scoreA);
        const sb = Number(body.scoreB);
        if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0 || sa > 999 || sb > 999) {
          return fail("invalid score");
        }
        const path = (body.screenshot ?? "").trim();
        // screenshot must be this user's upload for this match
        if (!path.startsWith(`results/${matchId}/${user.id}-`)) {
          return fail("scoreboard screenshot is required");
        }
        const { error } = await admin.rpc("submit_result", {
          p_match: matchId, p_actor: user.id, p_sa: sa, p_sb: sb, p_screenshot: path,
        });
        if (error) return fail(error.message);
        break;
      }
      default:
        return fail("unknown action");
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "action failed", 500);
  }

  const state = await loadState(matchId, user.id);
  if (!state || state === "forbidden") return NextResponse.json({ ok: true });
  return NextResponse.json(state);
}
