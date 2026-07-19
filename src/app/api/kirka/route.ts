import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Kirka account linking — screenshot + nickname only (manual review).
 * GET                                → current link status
 * POST { nick, path }                → submit screenshot for review
 * The client uploads the screenshot to Storage first; `path` must live in the
 * caller's own folder (enforced here and by Storage RLS).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data } = await admin.from("kirka_accounts").select("*").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ account: data });
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();

  const { data: allowed } = await admin.rpc("rate_limit_allow", {
    p_user: user.id, p_action: "kirka_link", p_max: 10, p_window_seconds: 60,
  });
  if (allowed === false) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  let body: { nick?: string; path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const nick = (body.nick ?? "").trim();
  const path = (body.path ?? "").trim();
  if (!nick || nick.length > 32) return NextResponse.json({ error: "invalid nickname" }, { status: 400 });
  if (!path.startsWith(`kirka/${user.id}/`)) {
    return NextResponse.json({ error: "invalid screenshot path" }, { status: 400 });
  }

  await admin.from("kirka_accounts").upsert({
    user_id: user.id, kirka_nick: nick, method: "screenshot",
    screenshot_path: path, status: "pending", verify_code: null, verified_at: null,
  });
  return NextResponse.json({ ok: true, pending: true });
}
