import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AdminClient, type DisputeItem, type KirkaReview, type LogRow } from "./ui";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  const admin = supabaseAdmin();
  const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") redirect("/play");

  // open disputes with both sides' evidence
  const { data: disputes } = await admin
    .from("disputes")
    .select("id, match_id, created_at, matches(mode, map_name, region)")
    .eq("status", "open")
    .order("id");

  const disputeItems: DisputeItem[] = [];
  for (const d of disputes ?? []) {
    const { data: results } = await admin
      .from("results")
      .select("team, score_a, score_b, screenshot_path, submitted_by, profiles:submitted_by(username)")
      .eq("match_id", d.match_id);
    const evidence = [];
    for (const r of results ?? []) {
      const { data: signed } = await admin.storage
        .from("screenshots")
        .createSignedUrl(r.screenshot_path, 3600);
      evidence.push({
        team: r.team,
        scoreA: r.score_a,
        scoreB: r.score_b,
        by: (r.profiles as { username?: string } | null)?.username ?? "?",
        url: signed?.signedUrl ?? null,
      });
    }
    const m = d.matches as { mode?: string; map_name?: string | null } | null;
    disputeItems.push({
      matchId: d.match_id,
      createdAt: d.created_at,
      label: `${m?.mode ?? "?"} · ${(m?.map_name ?? "?").toUpperCase()}`,
      evidence,
    });
  }

  // pending kirka screenshot verifications
  const { data: pendingKirka } = await admin
    .from("kirka_accounts")
    .select("user_id, kirka_nick, screenshot_path, created_at, profiles:user_id(username)")
    .eq("status", "pending")
    .eq("method", "screenshot")
    .order("created_at");

  const kirkaItems: KirkaReview[] = [];
  for (const k of pendingKirka ?? []) {
    let url: string | null = null;
    if (k.screenshot_path) {
      const { data: signed } = await admin.storage
        .from("screenshots").createSignedUrl(k.screenshot_path, 3600);
      url = signed?.signedUrl ?? null;
    }
    kirkaItems.push({
      userId: k.user_id,
      username: (k.profiles as { username?: string } | null)?.username ?? "?",
      nick: k.kirka_nick,
      url,
    });
  }

  const { data: log } = await admin
    .from("admin_actions")
    .select("id, action, details, created_at, profiles:admin_id(username)")
    .order("id", { ascending: false })
    .limit(30);

  const logRows: LogRow[] = (log ?? []).map((l) => ({
    id: l.id,
    action: l.action,
    admin: (l.profiles as { username?: string } | null)?.username ?? "?",
    details: JSON.stringify(l.details ?? {}),
    at: l.created_at,
  }));

  return (
    <div className="kq-page">
      <TopBar active="admin" />
      <main className="kq-container" style={{ padding: "30px 28px 40px", maxWidth: 1200 }}>
        <h1 className="kq-h2">ADMIN</h1>
        <AdminClient disputes={disputeItems} kirka={kirkaItems} log={logRows} />
      </main>
    </div>
  );
}
