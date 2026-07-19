import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { HexBadge } from "@/components/HexBadge";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { MODES, MODE_META, type Mode } from "@/config/game";

export const dynamic = "force-dynamic";

interface HistoryRow {
  team: number;
  matches: {
    id: number; mode: Mode; status: string; map_name: string | null;
    score_a: number | null; score_b: number | null; winner_team: number | null;
    completed_at: string | null;
  };
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}M`;
  if (s < 86400) return `${Math.floor(s / 3600)}H`;
  return `${Math.floor(s / 86400)}D`;
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getUser();
  const admin = supabaseAdmin();

  const { data: profile } = await admin
    .from("profiles").select("id, username, created_at").eq("id", id).maybeSingle();
  if (!profile) notFound();

  const { data: season } = await admin.from("seasons").select("id, name").eq("active", true).single();
  const { data: ratings } = await admin
    .from("ratings").select("mode, elo, wins, losses, peak")
    .eq("user_id", id).eq("season_id", season!.id);
  const { data: kirka } = await admin
    .from("kirka_accounts").select("status, kirka_nick").eq("user_id", id).maybeSingle();

  const { data: history } = (await admin
    .from("match_players")
    .select("team, matches!inner(id, mode, status, map_name, score_a, score_b, winner_team, completed_at)")
    .eq("user_id", id)
    .in("matches.status", ["completed", "awaiting_results", "disputed"])
    .order("match_id", { ascending: false })
    .limit(20)) as { data: HistoryRow[] | null };

  const { data: eloHist } = await admin
    .from("elo_history")
    .select("elo_after, mode, created_at")
    .eq("user_id", id).eq("mode", "1v1").eq("season_id", season!.id)
    .order("id", { ascending: false })
    .limit(20);

  const points = (eloHist ?? []).reverse().map((e) => e.elo_after);
  const totalMatches = (ratings ?? []).reduce((n, r) => n + r.wins + r.losses, 0);

  // sparkline geometry
  const W = 700, H = 190;
  const min = points.length ? Math.min(...points) - 20 : 980;
  const max = points.length ? Math.max(...points) + 20 : 1120;
  const pts = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * W : W;
    const y = H - 20 - ((p - min) / Math.max(1, max - min)) * (H - 50);
    return [Math.round(x), Math.round(y)] as const;
  });
  const poly = pts.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <div className="kq-page">
      <TopBar active={viewer?.id === id ? "profile" : undefined} />
      <main className="kq-container" style={{ display: "flex", flexDirection: "column", gap: 22, padding: "30px 28px 40px" }}>
        {/* head */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ width: 64, height: 64, border: "1px solid var(--kq-accent-line)", background: "var(--kq-accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", font: "700 22px var(--kq-font-ui)", color: "var(--kq-accent)", flex: "none" }}>
            {profile.username.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ font: "700 30px var(--kq-font-ui)", letterSpacing: ".04em" }}>{profile.username}</span>
              {kirka?.status === "verified" && (
                <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-win)" }}>
                  ✓ KIRKA VERIFIED · {kirka.kirka_nick}
                </span>
              )}
            </div>
            <span style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>
              MEMBER SINCE {new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase()} · {totalMatches} MATCHES · {season!.name.toUpperCase()}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {MODES.map((m) => {
              const r = (ratings ?? []).find((x) => x.mode === m);
              const elo = r?.elo ?? 1000;
              const wr = r && r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : null;
              return (
                <div key={m} className="kq-card bg1" style={{ padding: "14px 22px", display: "flex", alignItems: "center", gap: 14 }}>
                  <HexBadge elo={elo} size={44} bg="var(--kq-bg-1)" />
                  <div>
                    <div style={{ font: "500 9px var(--kq-font-mono)", color: "var(--kq-text-dim)", letterSpacing: ".16em" }}>
                      {MODE_META[m].title} {MODE_META[m].sub}
                    </div>
                    <div style={{ font: "700 26px var(--kq-font-ui)", lineHeight: 1.1 }}>{elo}</div>
                    <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>
                      {r ? `${r.wins}–${r.losses}` : "0–0"} · WR{" "}
                      <span style={{ color: wr != null && wr >= 50 ? "var(--kq-win)" : undefined }}>{wr != null ? `${wr}%` : "—"}</span>
                      {" "}· PEAK {r?.peak ?? 1000}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: 16, alignItems: "stretch" }}>
          <style>{`@media (max-width: 1000px) { main > div:last-child { grid-template-columns: 1fr !important; } }`}</style>
          {/* elo chart */}
          <div className="kq-card bg1" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="kq-label">ELO — LAST {points.length || 0} RATED GAMES · 1v1</div>
            {points.length > 1 ? (
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={0} y1={H * f} x2={W} y2={H * f} stroke="var(--kq-line-soft)" strokeWidth={1} />
                ))}
                <polygon points={`${poly} ${W},${H} 0,${H}`} fill="rgba(255,184,0,.07)" />
                <polyline points={poly} fill="none" stroke="var(--kq-accent)" strokeWidth={2} />
                {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={4} fill="var(--kq-accent)" />}
                <text x={W} y={16} textAnchor="end" fontFamily="var(--kq-font-mono)" fontSize={10} fill="var(--kq-text-dim)">{max - 20}</text>
                <text x={W} y={H - 6} textAnchor="end" fontFamily="var(--kq-font-mono)" fontSize={10} fill="var(--kq-text-dim)">{min + 20}</text>
              </svg>
            ) : (
              <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-dim)", padding: "40px 0", textAlign: "center" }}>
                NO RATED 1v1 GAMES YET
              </div>
            )}
          </div>

          {/* match history */}
          <div className="kq-card bg1" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--kq-line-soft)" }}>
              <span className="kq-label">MATCH HISTORY</span>
            </div>
            {(history ?? []).length === 0 && (
              <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-dim)", padding: "30px 20px", textAlign: "center" }}>
                NO MATCHES YET
              </div>
            )}
            {(history ?? []).map((h) => {
              const m = h.matches;
              const pending = m.status !== "completed";
              const won = m.winner_team === h.team;
              return (
                <Link
                  key={m.id}
                  href={viewer ? `/match/${m.id}` : "#"}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: "1px solid var(--kq-line-soft)", color: "inherit" }}
                >
                  <span className={`kq-tag ${pending ? "pending" : won ? "win" : "loss"}`} style={{ width: 22, textAlign: "center" }}>
                    {pending ? "P" : won ? "W" : "L"}
                  </span>
                  <span style={{ font: "600 14px var(--kq-font-ui)", width: 70 }}>
                    {m.score_a != null ? `${m.score_a}–${m.score_b}` : "—"}
                  </span>
                  <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-mut)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {MODE_META[m.mode]?.title ?? m.mode} · {(m.map_name ?? "?").toUpperCase()}
                    {pending ? " · PENDING" : ""}
                  </span>
                  <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)", width: 44, textAlign: "right" }}>
                    {ago(m.completed_at)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
