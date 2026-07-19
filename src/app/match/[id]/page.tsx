import { redirect, notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mapsForMode } from "@/lib/maps";
import { type Mode } from "@/config/game";
import { MatchClient } from "./ui";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");

  const matchId = Number((await params).id);
  if (!Number.isFinite(matchId)) notFound();

  const admin = supabaseAdmin();
  const { data: match } = await admin.from("matches").select("id, mode").eq("id", matchId).maybeSingle();
  if (!match) notFound();

  const { data: me } = await admin
    .from("match_players")
    .select("user_id")
    .eq("match_id", matchId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/play");

  // Map metadata (previews live on the filesystem — resolved server-side once;
  // the pool is snapshotted in the match row and never changes afterwards).
  const maps = mapsForMode(match.mode as Mode);

  return <MatchClient matchId={matchId} myId={user.id} mapsMeta={maps} />;
}
