"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HexBadge } from "@/components/HexBadge";
import { CopyButton } from "@/components/CopyButton";
import { Logo } from "@/components/Logo";
import { supabaseBrowser } from "@/lib/supabase/client";
import { extractKirkaLink } from "@/lib/roomProvider";
import { REGIONS, ROOM_SETTINGS, MODE_META, type Mode, type Region } from "@/config/game";
import type { MapInfo } from "@/lib/maps";

/* ---------- types mirroring the API payload ---------- */
interface Player {
  user_id: string; team: number; elo_at_start: number;
  is_captain: boolean; is_host: boolean;
  profiles: { username: string } | null;
}
interface MatchRow {
  id: number; mode: Mode; status: string; map_pool: string[];
  region: Region | null; map_id: string | null; map_name: string | null;
  host_user_id: string | null; veto_turn: string | null; veto_deadline: string | null;
  room_link: string | null; start_time_text: string | null;
  score_a: number | null; score_b: number | null; winner_team: number | null;
}
interface ChatMsg { id: number; user_id: string | null; username: string | null; body: string; created_at: string }
interface Ban { region?: string; map_id?: string; banned_by: string | null; auto: boolean; ord: number }
interface ResultRow { team: number; score_a: number; score_b: number; submitted_by: string }
interface State {
  match: MatchRow; players: Player[]; regionBans: Ban[]; mapBans: Ban[];
  ready: { user_id: string }[]; chat: ChatMsg[]; results: ResultRow[];
  provider: { kind: string; needsHostPanel: boolean };
}

const VETO_STATUSES = ["veto_region", "veto_map"];

export function MatchClient({
  matchId, myId, mapsMeta,
}: {
  matchId: number; myId: string; mapsMeta: MapInfo[];
}) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const refetching = useRef(false);

  const refetch = useCallback(async () => {
    if (refetching.current) return;
    refetching.current = true;
    try {
      const res = await fetch(`/api/match/${matchId}`);
      if (res.ok) setState(await res.json());
      else if (res.status === 403) router.push("/play");
    } finally {
      refetching.current = false;
    }
  }, [matchId, router]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // clock for countdowns
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime: chat appends + any state change triggers a refetch.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const ch = supabase
      .channel(`match-${matchId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "match_chat", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const msg = payload.new as ChatMsg;
          setState((s) => s && !s.chat.some((c) => c.id === msg.id)
            ? { ...s, chat: [...s.chat, msg] } : s);
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, refetch)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "region_bans", filter: `match_id=eq.${matchId}` }, refetch)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "map_bans", filter: `match_id=eq.${matchId}` }, refetch)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "match_ready", filter: `match_id=eq.${matchId}` }, refetch)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "room_links", filter: `match_id=eq.${matchId}` }, refetch)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "results", filter: `match_id=eq.${matchId}` }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [matchId, refetch]);

  // Veto deadline passed → server applies the auto-ban on refetch.
  const deadlineMs = state?.match.veto_deadline ? new Date(state.match.veto_deadline).getTime() : null;
  useEffect(() => {
    if (deadlineMs && now > deadlineMs + 1500) refetch();
  }, [now, deadlineMs, refetch]);

  const act = useCallback(async (payload: Record<string, unknown>) => {
    setErr(null);
    const res = await fetch(`/api/match/${matchId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "action failed");
      refetch();
    } else if (data.match) {
      setState(data);
    }
  }, [matchId, refetch]);

  if (!state) {
    return (
      <div className="kq-page" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="kq-spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  const { match, players } = state;
  const me = players.find((p) => p.user_id === myId)!;
  const isHost = match.host_user_id === myId;
  const inVeto = VETO_STATUSES.includes(match.status);
  const mapMeta = (id: string | null) => mapsMeta.find((m) => m.id === id);
  const nameOf = (uid: string | null) =>
    players.find((p) => p.user_id === uid)?.profiles?.username ?? "?";

  const secLeft = deadlineMs ? Math.max(0, Math.floor((deadlineMs - now) / 1000)) : 0;

  return (
    <div className="kq-page">
      {/* ---------- header ---------- */}
      <header className="kq-topbar" style={{ height: 58, gap: 16, overflowX: "auto" }}>
        {/* logo always leads back to the main menu, even mid-match */}
        <Logo sub={false} />
        <div style={{ font: "700 16px var(--kq-font-ui)", letterSpacing: ".1em", whiteSpace: "nowrap" }}>
          MATCH <span className="kq-acc">#{match.id}</span>
        </div>
        <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)", whiteSpace: "nowrap" }}>
          {MODE_META[match.mode].title} {MODE_META[match.mode].sub}
          {match.map_name ? ` · ${match.map_name}` : ""}
          {match.region ? ` · ${match.region}` : ""}
          {` · LIMIT ${ROOM_SETTINGS[match.mode].score_limit}`}
        </div>
        <StatusPill match={match} />
        <div style={{ flex: 1 }} />
        <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)", whiteSpace: "nowrap" }}>
          {players.filter((p) => p.team === 1).map((p) => p.profiles?.username).join(" + ")}
          <span className="kq-dim"> vs </span>
          {players.filter((p) => p.team === 2).map((p) => p.profiles?.username).join(" + ")}
        </div>
      </header>

      {err && (
        <div style={{ padding: "8px 28px", font: "500 12px var(--kq-font-mono)", color: "var(--kq-loss)", background: "var(--kq-loss-tint)", borderBottom: "1px solid var(--kq-loss-line)" }}>
          {err}
        </div>
      )}

      {inVeto ? (
        <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <VetoSection state={state} myId={myId} secLeft={secLeft} act={act} mapMeta={mapMeta} nameOf={nameOf} />
          <div style={{ borderTop: "1px solid var(--kq-line)", height: 320, display: "flex", flexDirection: "column" }}>
            <ChatPanel state={state} myId={myId} act={act} />
          </div>
        </main>
      ) : (
        <main style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr var(--kq-host-panel-w)", minHeight: 0 }}>
          <style>{`@media (max-width: 980px) { main { display: flex !important; flex-direction: column-reverse; } }`}</style>
          <div style={{ borderRight: "1px solid var(--kq-line)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 420 }}>
            <ChatPanel state={state} myId={myId} act={act} />
          </div>
          <SidePanel state={state} myId={myId} me={me} isHost={isHost} act={act} mapMeta={mapMeta} matchId={matchId} nameOf={nameOf} />
        </main>
      )}
    </div>
  );
}

/* ================= header status pill ================= */
function StatusPill({ match }: { match: MatchRow }) {
  const map: Record<string, [string, string]> = {
    veto_region: ["● REGION VETO", ""],
    veto_map: ["● MAP VETO", ""],
    lobby: [match.room_link ? "● ROOM PUBLISHED" : "● LOBBY — WAITING FOR ROOM", match.room_link ? "ok" : ""],
    ready: ["● ALL READY — SET START TIME", "ok"],
    live: ["● LIVE", ""],
    awaiting_results: ["● AWAITING RESULTS", ""],
    disputed: ["⚠ DISPUTED", ""],
    completed: ["✓ COMPLETED", "ok"],
    cancelled: ["✕ CANCELLED", ""],
  };
  const [label, cls] = map[match.status] ?? [match.status, ""];
  return <span className={`kq-live ${cls} ${match.status === "live" ? "kq-pulse" : ""}`}>{label}</span>;
}

/* ================= veto ================= */
function VetoSection({
  state, myId, secLeft, act, mapMeta, nameOf,
}: {
  state: State; myId: string; secLeft: number;
  act: (p: Record<string, unknown>) => Promise<void>;
  mapMeta: (id: string | null) => MapInfo | undefined;
  nameOf: (uid: string | null) => string;
}) {
  const { match, players, regionBans, mapBans } = state;
  const myTurn = match.veto_turn === myId;
  const turnName = nameOf(match.veto_turn);
  const inRegion = match.status === "veto_region";
  const bannedRegions = new Map(regionBans.map((b) => [b.region!, b]));
  const bannedMaps = new Map(mapBans.map((b) => [b.map_id!, b]));
  const progress = secLeft / 30;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "26px 28px 34px", maxWidth: 1440, width: "100%", margin: "0 auto" }}>
      {/* players VS row */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 16, flexWrap: "wrap" }}>
        {[1, 2].map((team, i) => (
          <TeamCard key={team} players={players.filter((p) => p.team === team)} myId={myId} vetoTurn={match.veto_turn} after={i === 0 ? <span style={{ display: "flex", alignItems: "center", font: "700 20px var(--kq-font-ui)", color: "var(--kq-text-dim)", letterSpacing: ".2em" }}>VS</span> : null} />
        ))}
      </div>

      {/* region veto */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="kq-label">REGION VETO {inRegion ? "" : "— COMPLETE"}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {REGIONS.map((r) => {
            const ban = bannedRegions.get(r);
            const locked = match.region === r;
            if (locked) {
              return (
                <div key={r} className="kq-sel" style={{ flex: 1, minWidth: 160 }}>
                  <span className="in" />
                  <span className="body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px" }}>
                    <span style={{ font: "700 18px var(--kq-font-ui)", letterSpacing: ".12em", color: "var(--kq-accent)" }}>{r}</span>
                    <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-accent)" }}>◆ LOCKED</span>
                  </span>
                </div>
              );
            }
            const clickable = inRegion && myTurn && !ban;
            return (
              <button
                key={r}
                className={`kq-region ${ban ? "banned" : ""} ${clickable ? "turn" : ""}`}
                style={{ minWidth: 160 }}
                disabled={!clickable}
                onClick={() => act({ action: "ban_region", region: r })}
              >
                <span className="nm">{r}</span>
                <span className="st">
                  {ban ? `✕ BANNED BY ${nameOf(ban.banned_by).toUpperCase()}${ban.auto ? " (AUTO)" : ""}` : clickable ? "BAN ✕" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* turn strip */}
      <div className="kq-turnstrip">
        <div className={`who ${myTurn ? "kq-pulse" : ""}`}>
          {myTurn ? "▸ YOUR BAN" : `▸ ${turnName.toUpperCase()}'S BAN`}
        </div>
        <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>
          {inRegion ? "CLICK A REGION TO REMOVE IT" : "CLICK A MAP TO REMOVE IT"} · BANS ALTERNATE UNTIL ONE REMAINS
        </div>
        <div style={{ flex: 1 }} />
        <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <div className="clock">0:{String(secLeft).padStart(2, "0")}</div>
      </div>

      {/* map grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {match.map_pool.map((id) => {
          const meta = mapMeta(id);
          const ban = bannedMaps.get(id);
          const clickable = match.status === "veto_map" && myTurn && !ban;
          return (
            <button
              key={id}
              className={`kq-map ${ban ? "banned" : ""} ${clickable ? "turn" : ""}`}
              disabled={!clickable}
              onClick={() => act({ action: "ban_map", map: id })}
            >
              <span className="shot" style={{ display: ban ? "flex" : "block" }}>
                {ban ? (
                  <span className="xmark">✕</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meta?.image} alt={meta?.name ?? id} />
                )}
                <span className="banx">BAN ✕</span>
              </span>
              <span className="meta">
                <span className="name">{meta?.name ?? id}</span>
                {ban ? (
                  <span className="bannedby">BANNED · {nameOf(ban.banned_by).toUpperCase()}</span>
                ) : (
                  <span className="code">{meta?.hasCode ? "CODE ✓" : ""}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamCard({
  players, myId, vetoTurn, after,
}: {
  players: Player[]; myId: string; vetoTurn: string | null; after: React.ReactNode;
}) {
  return (
    <>
      <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 8 }}>
        {players.map((p) => {
          const isTurn = vetoTurn === p.user_id;
          return (
            <div
              key={p.user_id}
              className="kq-card"
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                borderColor: isTurn ? "var(--kq-accent-line)" : undefined,
                background: isTurn ? "var(--kq-accent-tint)" : undefined,
              }}
            >
              <HexBadge elo={p.elo_at_start} size={40} bg={isTurn ? "var(--kq-accent-tint)" : "var(--kq-surface)"} />
              <div>
                <div style={{ font: "700 18px var(--kq-font-ui)" }}>
                  {p.profiles?.username}
                  {p.user_id === myId && <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)", marginLeft: 6 }}>YOU</span>}
                  {p.is_captain && <span className="kq-tag captain" style={{ marginLeft: 8 }}>◆ CAPTAIN</span>}
                  {p.is_host && <span className="kq-tag host" style={{ marginLeft: 6 }}>HOST</span>}
                </div>
                <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>
                  ELO {p.elo_at_start}{p.is_captain ? " · CAPTAIN" : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {after}
    </>
  );
}

/* ================= chat ================= */
function ChatPanel({
  state, myId, act,
}: {
  state: State; myId: string; act: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.chat.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    await act({ action: "chat", text: t });
  }

  function connect(link: string) {
    navigator.clipboard.writeText(link).catch(() => {});
    window.open(link, "_blank", "noopener");
  }

  return (
    <div className="kq-chat" style={{ flex: 1 }}>
      <div className="kq-chat-head">
        <span style={{ font: "700 13px var(--kq-font-ui)", letterSpacing: ".18em", color: "var(--kq-text-mut)" }}>MATCH CHAT</span>
        <span className="kq-dot kq-pulse" style={{ background: "var(--kq-win)" }} />
        <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>REALTIME</span>
      </div>
      <div className="kq-chat-scroll" ref={scrollRef}>
        {state.chat.map((m) => {
          if (!m.user_id) {
            return (
              <div key={m.id} className="kq-msg system">
                <div className="bubble">— {m.body} —</div>
              </div>
            );
          }
          const self = m.user_id === myId;
          const link = extractKirkaLink(m.body);
          const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const isHostMsg = state.match.host_user_id === m.user_id;
          return (
            <div key={m.id} className={`kq-msg ${self ? "self" : ""}`}>
              <div className="who">
                {self ? (
                  <><span className="when">{time}</span> {m.username}</>
                ) : (
                  <>{m.username} <span className="when">{time}</span>{isHostMsg && <span className="kq-tag host">HOST</span>}</>
                )}
              </div>
              <div className="bubble">
                <span>{m.body}</span>
                {link && (
                  <button className="kq-connect-mini" onClick={() => connect(link)}>CONNECT ➜</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form className="kq-chat-form" onSubmit={send}>
        <input
          className="kq-input"
          style={{ flex: 1 }}
          placeholder="Message…"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="kq-ghost accent" type="submit" disabled={!text.trim()}>SEND</button>
      </form>
    </div>
  );
}

/* ================= right side panel (lobby → results) ================= */
function SidePanel({
  state, myId, me, isHost, act, mapMeta, matchId, nameOf,
}: {
  state: State; myId: string; me: Player; isHost: boolean;
  act: (p: Record<string, unknown>) => Promise<void>;
  mapMeta: (id: string | null) => MapInfo | undefined;
  matchId: number;
  nameOf: (uid: string | null) => string;
}) {
  const { match, players, ready, results, provider } = state;
  const readySet = new Set(ready.map((r) => r.user_id));
  const showHostPanel = isHost && provider.needsHostPanel && ["lobby", "ready"].includes(match.status);
  const meta = mapMeta(match.map_id);

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 16, background: "var(--kq-bg-1)", padding: "18px 20px", overflowY: "auto" }}>
      {["completed", "cancelled"].includes(match.status) ? (
        <FinishedPanel state={state} me={me} />
      ) : match.status === "disputed" ? (
        <div className="kq-card danger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ font: "700 16px var(--kq-font-ui)", letterSpacing: ".06em", color: "var(--kq-loss)" }}>⚠ RESULT DISPUTED</div>
          <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)", lineHeight: 1.6 }}>
            SCORES DON&apos;T MATCH · BOTH SCREENSHOTS SENT TO MODERATORS
            <br />ELO CHANGES ONLY AFTER A MODERATOR DECISION
          </div>
        </div>
      ) : (
        <>
          {showHostPanel && <HostPanel state={state} act={act} meta={meta} />}
          {!showHostPanel && ["lobby", "ready"].includes(match.status) && (
            <PlayerLobbyPanel state={state} nameOf={nameOf} />
          )}
          {["lobby", "ready"].includes(match.status) && (
            <ReadyBlock state={state} myId={myId} readySet={readySet} act={act} isHost={isHost} />
          )}
          {["live", "awaiting_results"].includes(match.status) && (
            <>
              {match.start_time_text && (
                <div className="kq-card tint" style={{ textAlign: "center", padding: "18px 16px" }}>
                  <div className="kq-label" style={{ color: "var(--kq-accent)" }}>START AT · KIRKA CLOCK</div>
                  <div style={{ font: "700 56px var(--kq-font-mono)", color: "var(--kq-accent)", lineHeight: 1.1 }}>
                    {match.start_time_text}
                  </div>
                </div>
              )}
              {match.room_link && <ConnectBlock link={match.room_link} />}
              <ResultForm state={state} me={me} act={act} matchId={matchId} myId={myId} />
            </>
          )}
        </>
      )}

      {/* participants list with ready status — always visible */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="kq-label">PLAYERS</div>
        {players.map((p) => (
          <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--kq-bg-0)", border: "1px solid var(--kq-line-soft)" }}>
            <HexBadge elo={p.elo_at_start} size={22} bg="var(--kq-bg-0)" />
            <span style={{ font: "600 13px var(--kq-font-ui)", flex: 1 }}>
              {p.profiles?.username}
              {p.user_id === myId && <span className="kq-dim"> · YOU</span>}
            </span>
            <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>T{p.team}</span>
            {p.is_host && <span className="kq-tag host">HOST</span>}
            {readySet.has(p.user_id) ? (
              <span className="kq-tag win">READY</span>
            ) : ["lobby", "ready"].includes(match.status) ? (
              <span className="kq-tag pending">···</span>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ---- host panel (design 1d) — ManualHost provider module ---- */
function HostPanel({
  state, act, meta,
}: {
  state: State; act: (p: Record<string, unknown>) => Promise<void>; meta: MapInfo | undefined;
}) {
  const { match } = state;
  const rs = ROOM_SETTINGS[match.mode];
  const [link, setLink] = useState(match.room_link ?? "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ font: "700 13px var(--kq-font-ui)", letterSpacing: ".18em", color: "var(--kq-accent)" }}>HOST PANEL</span>
        <span className="kq-tag host">YOU — HIGHEST ELO</span>
      </div>
      <p style={{ margin: 0, font: "500 13px var(--kq-font-ui)", color: "var(--kq-text-mut)", lineHeight: 1.5 }}>
        Create a custom room in Kirka with <span style={{ color: "var(--kq-text)" }}>exactly these settings</span>, then paste the room link below.
      </p>
      <div className="kq-rows">
        <Row k="MODE" v={rs.kirka_mode.toUpperCase()} />
        <Row k="MAP" v={match.map_name ?? "—"} />
        {meta?.hasCode && (
          <div className="kq-row hl">
            <span className="k">MAP CODE</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: "700 14px var(--kq-font-mono)", color: "var(--kq-accent)" }}>{meta.name}.TXT</span>
              <CopyButton
                fetchText={async () => {
                  const res = await fetch(`/api/maps?mode=${match.mode}&code=${encodeURIComponent(match.map_id!)}`);
                  if (!res.ok) throw new Error("no code");
                  return res.text();
                }}
              />
            </span>
          </div>
        )}
        <Row k="SCORE LIMIT" v={String(rs.score_limit)} />
        <Row k="TIME LIMIT" v={`${rs.time_limit_min} MIN`} />
        <Row k="PLAYERS" v={String(rs.players)} />
        <Row k="BOTS" v={String(rs.bots)} />
        <Row k="TYPE" v={rs.type.toUpperCase()} />
        <Row k="PHYSICS" v={rs.physics.toUpperCase()} />
        <Row k="BHOP" v={rs.bhop ? "ON" : "OFF"} />
        <Row k="WEAPONS" v={rs.weapons.toUpperCase()} />
        <Row k="REGION" v={match.region ?? "—"} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="kq-label">ROOM LINK</div>
        <input
          className="kq-input"
          style={{ fontFamily: "var(--kq-font-mono)", fontSize: 13 }}
          placeholder="paste kirka.io/games/… link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button
          className="kq-btn"
          style={{ width: "100%", padding: 14, fontSize: 16, letterSpacing: ".2em" }}
          disabled={!link.trim()}
          onClick={() => act({ action: "publish_room", url: link })}
        >
          {match.room_link ? "UPDATE ROOM" : "PUBLISH ROOM"}
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="kq-row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

/* ---- player lobby panel (design 1e) ---- */
function PlayerLobbyPanel({ state, nameOf }: { state: State; nameOf: (uid: string | null) => string }) {
  const { match } = state;
  if (!match.room_link) {
    return (
      <div className="kq-card" style={{ background: "var(--kq-bg-0)", display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="kq-spinner" style={{ width: 26, height: 26 }} />
          <div>
            <div style={{ font: "700 17px var(--kq-font-ui)", letterSpacing: ".08em" }}>WAITING FOR HOST</div>
            <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>
              {nameOf(match.host_user_id)} is creating the room
            </div>
          </div>
        </div>
        <p style={{ margin: 0, font: "500 12px var(--kq-font-ui)", color: "var(--kq-text-dim)", lineHeight: 1.5 }}>
          The host (highest Elo) sets up the room with the match settings. The CONNECT button
          will appear here automatically.
        </p>
      </div>
    );
  }
  return (
    <div className="kq-card" style={{ background: "var(--kq-accent-tint-2)", borderColor: "var(--kq-accent-line)", display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px" }}>
      <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-win)", letterSpacing: ".14em" }}>
        ✓ HOST PUBLISHED THE ROOM
      </div>
      <ConnectBlock link={match.room_link} />
    </div>
  );
}

function ConnectBlock({ link }: { link: string }) {
  function connect() {
    navigator.clipboard.writeText(link).catch(() => {});
    window.open(link, "_blank", "noopener");
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        className="kq-btn big"
        style={{ width: "100%", padding: 18, display: "flex", flexDirection: "column", gap: 2 }}
        onClick={connect}
      >
        <span style={{ font: "700 26px var(--kq-font-ui)", letterSpacing: ".24em" }}>CONNECT</span>
        <span style={{ font: "600 10px var(--kq-font-mono)", letterSpacing: ".08em", color: "var(--kq-accent-deep)" }}>
          COPIES LINK · OPENS KIRKA ROOM
        </span>
      </button>
      <div className="kq-copy">
        <span style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {link.replace(/^https?:\/\//, "")}
        </span>
        <CopyButton text={link} className="kq-ghost mini" />
      </div>
    </div>
  );
}

/* ---- ready block ---- */
function ReadyBlock({
  state, myId, readySet, act, isHost,
}: {
  state: State; myId: string; readySet: Set<string>;
  act: (p: Record<string, unknown>) => Promise<void>; isHost: boolean;
}) {
  const { match } = state;
  const [time, setTime] = useState("");
  const meReady = readySet.has(myId);
  const allReady = match.status === "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!meReady && match.room_link && (
        <button className="kq-btn" style={{ width: "100%", padding: 14, fontSize: 18, letterSpacing: ".2em" }} onClick={() => act({ action: "ready" })}>
          READY ✓
        </button>
      )}
      {meReady && !allReady && (
        <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-win)", letterSpacing: ".1em" }}>
          ✓ YOU ARE READY — WAITING FOR OTHERS
        </div>
      )}
      {allReady && isHost && (
        <div className="kq-card tint" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
          <div className="kq-label" style={{ color: "var(--kq-accent)" }}>
            ALL READY — SET START TIME (KIRKA IN-GAME CLOCK)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="kq-input"
              style={{ fontFamily: "var(--kq-font-mono)", fontSize: 18, textAlign: "center" }}
              placeholder="58:30"
              value={time}
              maxLength={5}
              onChange={(e) => setTime(e.target.value)}
            />
            <button
              className="kq-btn"
              style={{ padding: "11px 20px" }}
              disabled={!/^\d{1,2}:\d{2}$/.test(time)}
              onClick={() => act({ action: "set_start", time })}
            >
              START
            </button>
          </div>
        </div>
      )}
      {allReady && !isHost && (
        <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-accent)", letterSpacing: ".1em" }} className="kq-pulse">
          ALL READY · HOST IS SETTING THE START TIME…
        </div>
      )}
    </div>
  );
}

/* ---- result submission (design 1h) ---- */
function ResultForm({
  state, me, act, matchId, myId,
}: {
  state: State; me: Player; act: (p: Record<string, unknown>) => Promise<void>;
  matchId: number; myId: string;
}) {
  const { match, players, results } = state;
  const [myScore, setMyScore] = useState("");
  const [oppScore, setOppScore] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const myTeamResult = results.find((r) => r.team === me.team);
  const oppResult = results.find((r) => r.team !== me.team);
  const oppNames = players.filter((p) => p.team !== me.team).map((p) => p.profiles?.username).join(" + ");

  const submitted = Boolean(myTeamResult);
  const router = useRouter();

  async function submit() {
    if (!file) return;
    setBusy(true);
    setUploadErr(null);
    const supabase = supabaseBrowser();
    const ext = file.name.split(".").pop() || "png";
    const path = `results/${matchId}/${myId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("screenshots").upload(path, file);
    if (error) {
      setBusy(false);
      setUploadErr(error.message);
      return;
    }
    const mine = parseInt(myScore, 10);
    const opp = parseInt(oppScore, 10);
    const scoreA = me.team === 1 ? mine : opp;
    const scoreB = me.team === 1 ? opp : mine;
    await act({ action: "submit_result", scoreA, scoreB, screenshot: path });
    setBusy(false);
  }

  if (submitted && !oppResult) {
    return (
      <div className="kq-card" style={{ background: "var(--kq-bg-0)", display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="kq-spinner" />
          <div style={{ font: "700 16px var(--kq-font-ui)", letterSpacing: ".06em" }}>WAITING FOR OPPONENT</div>
        </div>
        <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-mut)", lineHeight: 1.6 }}>
          {oppNames} must confirm {me.team === 1 ? `${myTeamResult!.score_a} : ${myTeamResult!.score_b}` : `${myTeamResult!.score_b} : ${myTeamResult!.score_a}`}
          <br />AUTO-CONFIRM IN 15 MIN IF NO RESPONSE
        </div>
        <button className="kq-ghost" onClick={() => router.push("/play")}>
          ⌂ BACK TO MAIN MENU
        </button>
      </div>
    );
  }

  const valid = /^\d+$/.test(myScore) && /^\d+$/.test(oppScore) && myScore !== oppScore && file;

  return (
    <div className="kq-card" style={{ background: "var(--kq-bg-0)", display: "flex", flexDirection: "column", gap: 14, padding: "16px 18px" }}>
      <div className="kq-label">SUBMIT RESULT — FINAL SCORE</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
        <ScoreInput label="YOUR TEAM" value={myScore} onChange={setMyScore} accent />
        <span style={{ font: "700 20px var(--kq-font-ui)", color: "var(--kq-text-dim)", marginTop: 20 }}>:</span>
        <ScoreInput label={oppNames || "OPPONENT"} value={oppScore} onChange={setOppScore} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        style={{
          border: "1px dashed var(--kq-line-2)", padding: 14, display: "flex", flexDirection: "column",
          alignItems: "center", gap: 4, background: "var(--kq-stripes)", cursor: "pointer",
        }}
        onClick={() => fileRef.current?.click()}
      >
        <span style={{ font: "600 13px var(--kq-font-ui)", color: file ? "var(--kq-win)" : "var(--kq-text-mut)" }}>
          {file ? `✓ ${file.name}` : "⇧ Drop end-of-match scoreboard screenshot"}
        </span>
        {!file && (
          <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-loss)", letterSpacing: ".1em" }}>
            REQUIRED — SUBMIT IS LOCKED WITHOUT IT
          </span>
        )}
      </button>
      <button className="kq-btn" style={{ width: "100%", padding: 13, fontSize: 15 }} disabled={!valid || busy} onClick={submit}>
        {busy ? "SUBMITTING…" : myScore && oppScore ? `SUBMIT ${myScore} : ${oppScore}` : "SUBMIT RESULT"}
      </button>
      {myScore === oppScore && myScore !== "" && (
        <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-loss)" }}>DRAWS ARE NOT ALLOWED</span>
      )}
      {uploadErr && <span className="kq-loss-c" style={{ font: "500 11px var(--kq-font-mono)" }}>{uploadErr}</span>}
    </div>
  );
}

function ScoreInput({
  label, value, onChange, accent,
}: {
  label: string; value: string; onChange: (v: string) => void; accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <span style={{ font: "600 12px var(--kq-font-ui)", color: "var(--kq-text-mut)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <input
        className="kq-input"
        style={{
          width: 90, textAlign: "center", font: "700 28px var(--kq-font-mono)",
          borderColor: accent ? "var(--kq-accent)" : undefined,
        }}
        inputMode="numeric"
        maxLength={3}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );
}

/* ---- finished ---- */
function FinishedPanel({ state, me }: { state: State; me: Player }) {
  const { match } = state;
  const router = useRouter();
  if (match.status === "cancelled") {
    return (
      <div className="kq-card danger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ font: "700 16px var(--kq-font-ui)", color: "var(--kq-loss)" }}>✕ MATCH CANCELLED</div>
        <button className="kq-ghost" onClick={() => router.push("/play")}>BACK TO QUEUE</button>
      </div>
    );
  }
  const won = match.winner_team === me.team;
  return (
    <div className={`kq-card ${won ? "tint" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "center", padding: 20 }}>
      <span className={`kq-tag ${won ? "win" : "loss"}`} style={{ alignSelf: "center", fontSize: 14, padding: "4px 14px" }}>
        {won ? "VICTORY" : "DEFEAT"}
      </span>
      <div style={{ font: "700 44px var(--kq-font-mono)", lineHeight: 1 }}>
        {match.score_a} : {match.score_b}
      </div>
      <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>
        ELO UPDATED · CHECK YOUR PROFILE
      </div>
      <button className="kq-btn" onClick={() => router.push("/play")}>PLAY AGAIN</button>
    </div>
  );
}
