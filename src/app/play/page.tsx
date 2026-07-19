import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PlayClient } from "./ui";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = supabaseAdmin();

  // Kirka link is required to queue
  const { data: kirka } = await admin
    .from("kirka_accounts").select("status").eq("user_id", user.id).maybeSingle();
  if (kirka?.status !== "verified") redirect("/link");

  // In a match that's still being played? Go straight to its window.
  // (awaiting_results / disputed don't lock the player out of the menu.)
  const { data: active } = await admin
    .from("match_players")
    .select("match_id, matches!inner(status)")
    .eq("user_id", user.id)
    .in("matches.status", ["veto_region", "veto_map", "lobby", "ready", "live"])
    .limit(1)
    .maybeSingle();
  if (active) redirect(`/match/${active.match_id}`);

  const { data: season } = await admin.from("seasons").select("id").eq("active", true).single();
  const { data: ratings } = await admin
    .from("ratings")
    .select("mode, elo, wins, losses, peak")
    .eq("user_id", user.id)
    .eq("season_id", season!.id);
  const { data: profile } = await admin.from("profiles").select("username").eq("id", user.id).single();
  const { data: queueRows } = await admin.from("queue").select("mode");
  const { data: lastMatches } = await admin
    .from("match_players")
    .select("team, matches!inner(id, mode, status, score_a, score_b, winner_team, map_name, completed_at)")
    .eq("user_id", user.id)
    .eq("matches.status", "completed")
    .order("match_id", { ascending: false })
    .limit(1);

  const counts: Record<string, number> = {};
  for (const q of queueRows ?? []) counts[q.mode] = (counts[q.mode] ?? 0) + 1;

  return (
    <div className="kq-page">
      <TopBar active="play" />
      <PlayClient
        username={profile?.username ?? "player"}
        ratings={ratings ?? []}
        initialCounts={counts}
        lastMatch={(lastMatches?.[0] as unknown as Parameters<typeof PlayClient>[0]["lastMatch"]) ?? null}
      />
    </div>
  );
}
