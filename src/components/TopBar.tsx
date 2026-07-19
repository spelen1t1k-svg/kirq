import Link from "next/link";
import { Logo } from "./Logo";
import { HexBadge } from "./HexBadge";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Signed-in top bar (design 1a): logo · PLAY / LEADERBOARD / PROFILE · user chip.
 */
export async function TopBar({ active }: { active?: "play" | "leaderboard" | "profile" | "admin" }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let username: string | null = null;
  let elo: number | null = null;
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, role")
      .eq("id", user.id)
      .single();
    username = profile?.username ?? null;
    isAdmin = profile?.role === "admin";
    const { data: season } = await supabase.from("seasons").select("id").eq("active", true).single();
    if (season) {
      const { data: r } = await supabase
        .from("ratings")
        .select("elo")
        .eq("user_id", user.id)
        .eq("mode", "1v1")
        .eq("season_id", season.id)
        .maybeSingle();
      elo = r?.elo ?? null;
    }
  }

  return (
    <header className="kq-topbar">
      <Logo />
      <nav className="kq-nav">
        <Link href="/play" className={active === "play" ? "active" : ""}>PLAY</Link>
        <Link href="/leaderboard" className={active === "leaderboard" ? "active" : ""}>LEADERBOARD</Link>
        <Link href="/profile" className={active === "profile" ? "active" : ""}>PROFILE</Link>
        {isAdmin && <Link href="/admin" className={active === "admin" ? "active" : ""}>ADMIN</Link>}
      </nav>
      <div style={{ flex: 1 }} />
      {user ? (
        <Link
          href="/profile"
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
            background: "#151a21", border: "1px solid var(--kq-line)", color: "inherit",
          }}
        >
          <HexBadge elo={elo ?? 1000} size={28} bg="#151a21" />
          <span style={{ font: "700 15px var(--kq-font-ui)", letterSpacing: ".04em" }}>
            {username ?? "player"}
          </span>
          {elo != null && (
            <span style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-accent)" }}>{elo}</span>
          )}
        </Link>
      ) : (
        <Link href="/login" className="kq-btn" style={{ padding: "9px 18px", fontSize: 13 }}>
          SIGN IN
        </Link>
      )}
    </header>
  );
}
