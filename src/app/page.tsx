import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Landing (design 1f). Signed-in users go straight to /play. */
export default async function Landing() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/play");

  const { data: season } = await supabase
    .from("seasons")
    .select("name, ends_at")
    .eq("active", true)
    .maybeSingle();
  const daysLeft = season?.ends_at
    ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="kq-page">
      <header className="kq-topbar" style={{ height: 64, borderColor: "var(--kq-line-soft)" }}>
        <Logo />
        <div style={{ flex: 1 }} />
        <nav className="kq-nav" style={{ marginLeft: 0 }}>
          <Link href="/leaderboard">LEADERBOARD</Link>
        </nav>
        <Link href="/login" className="kq-btn discord" style={{ padding: "9px 18px", fontSize: 13, letterSpacing: ".1em" }}>
          SIGN IN WITH DISCORD
        </Link>
      </header>

      <main
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
          padding: "96px 40px 72px",
          backgroundImage:
            "radial-gradient(600px 340px at 50% 0, rgba(255,184,0,.07), transparent)," +
            "linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px)",
          backgroundSize: "auto, 24px 24px, 24px 24px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "14px 14px", gridAutoRows: "14px", gap: 3, marginBottom: 28 }}>
          <div style={{ background: "var(--kq-accent)" }} />
          <div style={{ background: "var(--kq-accent)" }} />
          <div style={{ background: "#2c3441" }} />
          <div style={{ background: "var(--kq-accent)" }} />
        </div>
        <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-accent)", letterSpacing: ".3em", marginBottom: 18 }}>
          RANKED · KIRKA.IO · COMMUNITY-RUN
        </div>
        <h1 style={{ font: "700 clamp(40px, 7vw, 72px) var(--kq-font-ui)", lineHeight: 1.02, letterSpacing: ".01em", maxWidth: 900, margin: 0, textWrap: "balance" }}>
          THE RANKED MATCHMAKING <span style={{ color: "var(--kq-accent)" }}>KIRKA NEVER SHIPPED</span>
        </h1>
        <p style={{ font: "500 19px var(--kq-font-ui)", color: "var(--kq-text-mut)", lineHeight: 1.5, maxWidth: 620, marginTop: 20 }}>
          Queue up for 1v1 Duel or 2v2 Point. Elo, divisions, region &amp; map veto, verified
          results. Free, run by the community.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 36, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/login" className="kq-btn discord big" style={{ fontSize: 18, letterSpacing: ".14em", padding: "16px 32px" }}>
            SIGN IN WITH DISCORD
          </Link>
          <Link href="/leaderboard" className="kq-ghost" style={{ padding: "16px 28px", fontSize: 15 }}>
            VIEW LEADERBOARD
          </Link>
        </div>
        {season && (
          <div style={{ display: "flex", marginTop: 44, border: "1px solid var(--kq-line)", background: "var(--kq-bg-1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 26px" }}>
              <span style={{ font: "700 17px var(--kq-font-mono)" }}>{season.name.replace(/season\s*/i, "S")}</span>
              <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)", letterSpacing: ".12em" }}>
                {daysLeft != null ? `${daysLeft} DAYS LEFT` : "ACTIVE SEASON"}
              </span>
            </div>
          </div>
        )}
      </main>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, padding: "0 40px 56px", maxWidth: 1440, margin: "0 auto", width: "100%" }}>
        <div className="kq-card bg1" style={{ padding: 24 }}>
          <div style={{ font: "700 18px var(--kq-font-ui)", letterSpacing: ".1em" }}>ELO &amp; DIVISIONS</div>
          <p className="kq-mut" style={{ margin: "10px 0 0", fontSize: 14 }}>
            Start at 1000, climb through 10 levels. Past level 10 your badge shows your
            leaderboard place.
          </p>
        </div>
        <div className="kq-card bg1" style={{ padding: 24 }}>
          <div style={{ font: "700 18px var(--kq-font-ui)", letterSpacing: ".1em" }}>REGION &amp; MAP VETO</div>
          <p className="kq-mut" style={{ margin: "10px 0 0", fontSize: 14 }}>
            After a match is found, captains ban regions, then maps — alternating until one of
            each remains.
          </p>
        </div>
        <div className="kq-card bg1" style={{ padding: 24 }}>
          <div style={{ font: "700 18px var(--kq-font-ui)", letterSpacing: ".1em" }}>
            <span className="kq-win-c">✓</span> VERIFIED RESULTS
          </div>
          <p className="kq-mut" style={{ margin: "10px 0 0", fontSize: 14 }}>
            Score + mandatory screenshot from both sides. Mismatches go to moderator review.
          </p>
        </div>
      </section>

      <footer style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 40px", borderTop: "1px solid var(--kq-line-soft)", font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)", marginTop: "auto" }}>
        <span>KIRQ — KIRKA PUGS</span>
        <span>·</span>
        <span>NOT AFFILIATED WITH KIRKA.IO</span>
      </footer>
    </div>
  );
}
