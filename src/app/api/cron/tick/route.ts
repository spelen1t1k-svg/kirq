import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncMapPool } from "@/lib/mapsSync";

export const dynamic = "force-dynamic";

/**
 * Cron tick (Vercel cron, every minute — see vercel.json).
 * No long-running process anywhere: this sweeps the matchmaker, veto
 * timeouts, result auto-confirms and stale matches. Clients in queue
 * additionally poll every 5s (GET /api/queue), and pg_cron can run the same
 * SQL every 5 seconds server-side (see 0004 migration).
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  await syncMapPool(admin);
  const { data: created, error: e1 } = await admin.rpc("run_matchmaker");
  const { error: e2 } = await admin.rpc("apply_timeouts");

  return NextResponse.json({
    ok: !e1 && !e2,
    matchesCreated: created ?? 0,
    errors: [e1?.message, e2?.message].filter(Boolean),
  });
}
