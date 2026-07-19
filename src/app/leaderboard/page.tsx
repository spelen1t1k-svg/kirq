import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { HexBadge } from "@/components/HexBadge";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { MODES, MODE_META, type Mode } from "@/config/game";

export const dynamic = "force-dynamic";

/** Leaderboard (design 1j) with mode tabs and season filter. */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; season?: string }>;
}) {
  const sp = await searchParams;
  const mode: Mode = MODES.includes(sp.mode as Mode) ? (sp.mode as Mode) : "1v1";

  const admin = supabaseAdmin();
  const viewer = await getUser();

  const { data: seasons } = await admin.from("seasons").select("id, name, active").order("id", { ascending: false });
  const activeSeason = seasons?.find((s) => s.active);
  const seasonId = sp.season ? Number(sp.season) : activeSeason?.id;
  const season = seasons?.find((s) => s.id === seasonId) ?? activeSeason;

  const { data: rows } = await admin
    .from("ratings")
    .select("user_id, elo, wins, losses, profiles(username)")
    .eq("mode", mode)
    .eq("season_id", season?.id ?? -1)
    .gt("wins", -1)
    .order("elo", { ascending: false })
    .limit(100);

  const ranked = (rows ?? []).filter((r) => r.wins + r.losses > 0);
  const myPlace = viewer ? ranked.findIndex((r) => r.user_id === viewer.id) : -1;

  return (
    <div className="kq-page">
      <TopBar active="leaderboard" />
      <main className="kq-container" style={{ display: "flex", flexDirection: "column", gap: 18, padding: "30px 28px 40px", maxWidth: 1200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <h1 className="kq-h2">LEADERBOARD</h1>
          <div className="kq-seg">
            {MODES.map((m) => (
              <Link key={m} href={`/leaderboard?mode=${m}${season ? `&season=${season.id}` : ""}`}>
                <button className={m === mode ? "on" : ""} style={{ pointerEvents: "none" }}>
                  {MODE_META[m].title} {MODE_META[m].sub}
                </button>
              </Link>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div className="kq-seg filter">
            {(seasons ?? []).map((s) => (
              <Link key={s.id} href={`/leaderboard?mode=${mode}&season=${s.id}`}>
                <button className={s.id === season?.id ? "on" : ""} style={{ pointerEvents: "none" }}>
                  {s.name.toUpperCase()}
                </button>
              </Link>
            ))}
          </div>
        </div>

        <div className="kq-card bg1" style={{ padding: 0 }}>
          <div className="kq-lb-head">
            <span>PLACE</span><span /><span>PLAYER</span>
            <span style={{ textAlign: "right" }}>ELO</span>
            <span style={{ textAlign: "right" }}>W–L</span>
            <span style={{ textAlign: "right" }}>WR</span>
          </div>
          {ranked.length === 0 && (
            <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-dim)", padding: "36px 20px", textAlign: "center" }}>
              NO RATED PLAYERS THIS SEASON YET
            </div>
          )}
          {ranked.slice(0, 50).map((r, i) => {
            const place = i + 1;
            const wr = Math.round((r.wins / (r.wins + r.losses)) * 100);
            const isMe = viewer?.id === r.user_id;
            const username = (r.profiles as { username?: string } | null)?.username ?? "?";
            return (
              <Link key={r.user_id} href={`/profile/${r.user_id}`} style={{ color: "inherit", display: "block" }}>
                <div
                  className="kq-lb-row"
                  style={{
                    background: place === 1
                      ? "linear-gradient(90deg, rgba(255,184,0,.08), transparent 55%)"
                      : isMe ? "var(--kq-accent-tint-2)" : undefined,
                  }}
                >
                  <span style={{ font: `700 ${place <= 3 ? 18 : 14}px var(--kq-font-mono)`, color: place === 1 ? "var(--kq-accent)" : place <= 3 ? "#c8cfd9" : "var(--kq-text-mut)" }}>
                    #{place}
                  </span>
                  <HexBadge elo={r.elo} place={place} size={place === 1 ? 36 : 32} bg="var(--kq-bg-1)" />
                  <span style={{ font: `${place <= 3 ? 700 : 600} ${place <= 3 ? 17 : 16}px var(--kq-font-ui)`, color: isMe ? "var(--kq-accent)" : undefined }}>
                    {username}{isMe ? " — YOU" : ""}
                  </span>
                  <span style={{ font: "700 15px var(--kq-font-mono)", textAlign: "right", color: place === 1 ? "var(--kq-accent)" : undefined }}>{r.elo}</span>
                  <span style={{ font: "500 13px var(--kq-font-mono)", textAlign: "right", color: "var(--kq-text-mut)" }}>{r.wins}–{r.losses}</span>
                  <span style={{ font: "600 13px var(--kq-font-mono)", textAlign: "right", color: wr >= 50 ? "var(--kq-win)" : "var(--kq-text-mut)" }}>{wr}%</span>
                </div>
              </Link>
            );
          })}
          {myPlace >= 50 && viewer && (
            <div className="kq-lb-row" style={{ borderTop: "1px solid var(--kq-accent-line)", background: "var(--kq-accent-tint-2)" }}>
              <span style={{ font: "600 14px var(--kq-font-mono)", color: "var(--kq-accent)" }}>#{myPlace + 1}</span>
              <HexBadge elo={ranked[myPlace].elo} size={32} bg="var(--kq-accent-tint-2)" />
              <span style={{ font: "700 16px var(--kq-font-ui)", color: "var(--kq-accent)" }}>
                {(ranked[myPlace].profiles as { username?: string } | null)?.username} — YOU
              </span>
              <span style={{ font: "600 15px var(--kq-font-mono)", textAlign: "right" }}>{ranked[myPlace].elo}</span>
              <span style={{ font: "500 13px var(--kq-font-mono)", textAlign: "right", color: "var(--kq-text-mut)" }}>
                {ranked[myPlace].wins}–{ranked[myPlace].losses}
              </span>
              <span />
            </div>
          )}
        </div>
        <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>
          TOP-10 BADGE SHOWS PLACE (#N) INSTEAD OF LEVEL · #1 IS GOLD WITH GLOW
        </div>
      </main>
    </div>
  );
}
