import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).single();
  return data?.role === "admin" ? { user, admin } : null;
}

/**
 * Admin mutations. All logged to admin_actions inside the SQL functions.
 * POST { action: "resolve_dispute", matchId, scoreA, scoreB }
 *      { action: "cancel_match", matchId, reason, penalize?: uuid[] }
 *      { action: "adjust_elo", userId, mode, delta, reason }
 *      { action: "ban_user", userId, days, reason }   (days=0 → unban)
 *      { action: "review_kirka", userId, approve }
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { user, admin } = ctx;

  let b: Record<string, unknown>;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const fail = (m: string) => NextResponse.json({ error: m }, { status: 400 });

  switch (b.action) {
    case "resolve_dispute": {
      const { error } = await admin.rpc("admin_resolve_dispute", {
        p_admin: user.id, p_match: Number(b.matchId), p_sa: Number(b.scoreA), p_sb: Number(b.scoreB),
      });
      if (error) return fail(error.message);
      break;
    }
    case "cancel_match": {
      const { error } = await admin.rpc("admin_cancel_match", {
        p_admin: user.id, p_match: Number(b.matchId),
        p_reason: String(b.reason ?? ""), p_penalize: (b.penalize as string[]) ?? [],
      });
      if (error) return fail(error.message);
      break;
    }
    case "adjust_elo": {
      const { error } = await admin.rpc("admin_adjust_elo", {
        p_admin: user.id, p_user: String(b.userId), p_mode: String(b.mode),
        p_delta: Number(b.delta), p_reason: String(b.reason ?? ""),
      });
      if (error) return fail(error.message);
      break;
    }
    case "ban_user": {
      const days = Number(b.days);
      const until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
      const { error } = await admin.rpc("admin_ban_user", {
        p_admin: user.id, p_user: String(b.userId), p_until: until, p_reason: String(b.reason ?? ""),
      });
      if (error) return fail(error.message);
      break;
    }
    case "review_kirka": {
      const { error } = await admin.rpc("admin_review_kirka", {
        p_admin: user.id, p_user: String(b.userId), p_approve: Boolean(b.approve),
      });
      if (error) return fail(error.message);
      break;
    }
    default:
      return fail("unknown action");
  }
  return NextResponse.json({ ok: true });
}
