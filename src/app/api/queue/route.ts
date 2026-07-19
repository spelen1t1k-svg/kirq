import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncMapPool } from "@/lib/mapsSync";
import { MODES, type Mode } from "@/config/game";

export const dynamic = "force-dynamic";

/** POST { action: "join", mode } | { action: "leave" } */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();

  let body: { action?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (body.action === "join") {
    if (!MODES.includes(body.mode as Mode)) {
      return NextResponse.json({ error: "unknown mode" }, { status: 400 });
    }
    await syncMapPool(admin); // pools must exist before a match can snapshot them
    const { error } = await admin.rpc("join_queue", { p_user: user.id, p_mode: body.mode });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    // opportunistic matchmaking so nobody waits for the next cron tick
    await admin.rpc("run_matchmaker");
    return NextResponse.json({ ok: true });
  }

  if (body.action === "leave") {
    const { error } = await admin.rpc("leave_queue", { p_user: user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

/**
 * GET — queue poll. Called every 5s by clients waiting in queue: keeps the
 * matchmaker hot without any long-running process (5s cadence per spec;
 * pg_cron / Vercel cron are the fallback when nobody is polling).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();

  await admin.rpc("run_matchmaker");
  await admin.rpc("apply_timeouts");

  const { data: q } = await admin.from("queue").select("mode, joined_at").eq("user_id", user.id).maybeSingle();
  const { data: active } = await admin
    .from("match_players")
    .select("match_id, matches!inner(id, status)")
    .eq("user_id", user.id)
    .in("matches.status", ["veto_region", "veto_map", "lobby", "ready", "live"])
    .order("match_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    inQueue: Boolean(q),
    queue: q,
    matchId: active?.match_id ?? null,
  });
}
