"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HexBadge } from "@/components/HexBadge";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MODES, MODE_META, type Mode } from "@/config/game";

interface Rating { mode: string; elo: number; wins: number; losses: number; peak: number }
interface LastMatch {
  team: number;
  matches: { id: number; mode: string; score_a: number | null; score_b: number | null; winner_team: number | null; map_name: string | null };
}

const MODE_DESC: Record<Mode, string> = {
  "1v1": "First to score limit. Winner takes Elo. Best-of-1, map ban until one remains.",
  "2v2_point": "Hold the point with a teammate. Solo queue — teams are balanced by Elo.",
};

/** Play screen (design 1a) + searching state (1b). */
export function PlayClient({
  username, ratings, initialCounts, lastMatch,
}: {
  username: string;
  ratings: Rating[];
  initialCounts: Record<string, number>;
  lastMatch: LastMatch | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("1v1");
  const [counts, setCounts] = useState(initialCounts);
  const [searching, setSearching] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rating = (m: string) => ratings.find((r) => r.mode === m);
  const elo = rating(mode)?.elo ?? 1000;

  const refreshCounts = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data } = await supabase.from("queue").select("mode");
    if (data) {
      const c: Record<string, number> = {};
      for (const q of data) c[q.mode] = (c[q.mode] ?? 0) + 1;
      setCounts(c);
    }
  }, []);

  // Live queue counters via Realtime.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const ch = supabase
      .channel("queue-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, refreshCounts)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refreshCounts]);

  const stopTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = tickRef.current = null;
  }, []);

  const startPolling = useCallback(() => {
    stopTimers();
    setWaitSec(0);
    tickRef.current = setInterval(() => setWaitSec((s) => s + 1), 1000);
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/queue");
      if (!res.ok) return;
      const data = await res.json();
      if (data.matchId) {
        stopTimers();
        router.push(`/match/${data.matchId}`);
      } else if (!data.inQueue) {
        stopTimers();
        setSearching(false);
      }
    }, 5000);
  }, [router, stopTimers]);

  useEffect(() => stopTimers, [stopTimers]);

  // Resume searching state on reload if we are still queued.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/queue");
      if (!res.ok) return;
      const data = await res.json();
      if (data.matchId) router.push(`/match/${data.matchId}`);
      else if (data.inQueue) {
        setMode(data.queue.mode);
        setSearching(true);
        startPolling();
        const waited = Math.floor((Date.now() - new Date(data.queue.joined_at).getTime()) / 1000);
        setWaitSec(Math.max(0, waited));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function play() {
    setErr(null);
    const res = await fetch("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "join", mode }),
    });
    if (!res.ok) {
      const data = await res.json();
      setErr(data.error ?? "failed to join queue");
      return;
    }
    setSearching(true);
    startPolling();
  }

  async function cancel() {
    await fetch("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "leave" }),
    });
    stopTimers();
    setSearching(false);
  }

  const mm = String(Math.floor(waitSec / 60)).padStart(2, "0");
  const ss = String(waitSec % 60).padStart(2, "0");
  const r = rating(mode);
  const wr = r && r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : null;

  return (
    <main
      className="kq-grid-bg"
      style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 350px", gap: 28, padding: "34px 28px 40px", maxWidth: 1440, margin: "0 auto", width: "100%" }}
    >
      <style>{`@media (max-width: 900px) { main.kq-grid-bg { grid-template-columns: 1fr !important; } }`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {searching ? (
          /* --- searching state (1b) --- */
          <div className="kq-card bg1" style={{ display: "flex", alignItems: "center", gap: 28, padding: 28, flexWrap: "wrap" }}>
            <div className="kq-radar">
              <div className="r1" /> <div className="r2" /> <div className="sweep" /> <div className="dot" />
            </div>
            <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ font: "700 22px var(--kq-font-ui)", letterSpacing: ".12em" }}>
                SEARCHING<span className="kq-acc kq-pulse">…</span>
              </div>
              <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)", lineHeight: 1.7 }}>
                {MODE_META[mode].title} {MODE_META[mode].sub} · ELO {elo} <span className="kq-acc">· ANY ELO</span>
                <br />
                MATCHES ANY ELO · {counts[mode] ?? 0} IN QUEUE
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
              <div style={{ font: "700 40px var(--kq-font-mono)", color: "var(--kq-accent)", lineHeight: 1 }}>
                {mm}:{ss}
              </div>
              <button className="kq-ghost danger" onClick={cancel}>CANCEL</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="kq-label">SELECT MODE</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {MODES.map((m) => {
                  const meta = MODE_META[m];
                  const selected = mode === m;
                  const inner = (
                    <div style={{ position: "relative", padding: "22px 24px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                        <span style={{ font: "700 42px var(--kq-font-ui)", lineHeight: 1, color: selected ? "var(--kq-accent)" : "var(--kq-text-mut)" }}>
                          {meta.title}
                        </span>
                        <span style={{ font: "700 16px var(--kq-font-ui)", letterSpacing: ".2em", color: selected ? "var(--kq-text)" : "var(--kq-text-mut)" }}>
                          {meta.sub}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 14, color: selected ? "var(--kq-text-mut)" : "var(--kq-text-dim)", lineHeight: 1.45 }}>
                        {MODE_DESC[m]}
                      </p>
                      <div style={{ display: "flex", gap: 16, font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)", marginTop: 6 }}>
                        {selected && <span className="kq-acc">◆ SELECTED</span>}
                        <span>{counts[m] ?? 0} IN QUEUE</span>
                      </div>
                    </div>
                  );
                  return selected ? (
                    <button key={m} className="kq-sel" style={{ flex: 1, minWidth: 280, textAlign: "left" }} onClick={() => setMode(m)}>
                      <span className="in" />
                      <span className="body" style={{ display: "block" }}>{inner}</span>
                    </button>
                  ) : (
                    <button key={m} className="kq-card" style={{ flex: 1, minWidth: 280, textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => setMode(m)}>
                      {inner}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <button className="kq-btn big" style={{ padding: "18px 64px", fontSize: 28 }} onClick={play}>
                PLAY
              </button>
              <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-dim)", lineHeight: 1.6 }}>
                QUEUEING: {MODE_META[mode].title} {MODE_META[mode].sub} · MATCH RANGE: ANY ELO
                <br />
                REGION &amp; MAP — VETO AFTER MATCH IS FOUND
              </div>
            </div>
            {err && <div className="kq-loss-c" style={{ font: "500 12px var(--kq-font-mono)" }}>{err}</div>}
          </>
        )}
      </div>

      {/* right column: player card, queue counters, last match */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="kq-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HexBadge elo={elo} size={44} />
            <div>
              <div style={{ font: "700 19px var(--kq-font-ui)", letterSpacing: ".04em" }}>{username}</div>
              <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>
                {MODE_META[mode].title} ELO <span className="kq-acc">{elo}</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, borderTop: "1px solid var(--kq-line)", paddingTop: 14 }}>
            <div>
              <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)", letterSpacing: ".12em" }}>W–L</div>
              <div style={{ font: "700 18px var(--kq-font-ui)" }}>{r ? `${r.wins}–${r.losses}` : "0–0"}</div>
            </div>
            <div>
              <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)", letterSpacing: ".12em" }}>WINRATE</div>
              <div style={{ font: "700 18px var(--kq-font-ui)", color: wr != null && wr >= 50 ? "var(--kq-win)" : "var(--kq-text)" }}>
                {wr != null ? `${wr}%` : "—"}
              </div>
            </div>
            <div>
              <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)", letterSpacing: ".12em" }}>PEAK</div>
              <div style={{ font: "700 18px var(--kq-font-ui)" }}>{r?.peak ?? 1000}</div>
            </div>
          </div>
        </div>

        <div className="kq-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="kq-label">IN QUEUE NOW</div>
          {MODES.map((m) => {
            const c = counts[m] ?? 0;
            const on = m === mode;
            return (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ font: "600 13px var(--kq-font-ui)", width: 64, color: on ? "var(--kq-text)" : "var(--kq-text-mut)" }}>
                  {MODE_META[m].title}
                </span>
                <div style={{ flex: 1, height: 6, background: "var(--kq-line-soft)" }}>
                  <div style={{ width: `${Math.min(100, c * 8)}%`, height: "100%", background: on ? "var(--kq-accent)" : "#3a4657" }} />
                </div>
                <span style={{ font: "500 12px var(--kq-font-mono)", color: on ? "var(--kq-accent)" : "var(--kq-text-mut)" }}>{c}</span>
              </div>
            );
          })}
        </div>

        {lastMatch?.matches && lastMatch.matches.winner_team != null && (
          <div className="kq-card" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <span className={`kq-tag ${lastMatch.matches.winner_team === lastMatch.team ? "win" : "loss"}`} style={{ fontSize: 12 }}>
              {lastMatch.matches.winner_team === lastMatch.team ? "WIN" : "LOSS"}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ font: "600 14px var(--kq-font-ui)" }}>
                {lastMatch.matches.score_a}–{lastMatch.matches.score_b}
              </div>
              <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>
                {(lastMatch.matches.map_name ?? "").toUpperCase()} · LAST MATCH
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
