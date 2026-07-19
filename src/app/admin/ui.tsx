"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODES } from "@/config/game";

export interface DisputeItem {
  matchId: number;
  createdAt: string;
  label: string;
  evidence: { team: number; scoreA: number; scoreB: number; by: string; url: string | null }[];
}
export interface KirkaReview { userId: string; username: string; nick: string; url: string | null }
export interface LogRow { id: number; action: string; admin: string; details: string; at: string }

async function call(payload: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return null;
  const data = await res.json();
  return data.error ?? "failed";
}

export function AdminClient({
  disputes, kirka, log,
}: {
  disputes: DisputeItem[]; kirka: KirkaReview[]; log: LogRow[];
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  async function run(payload: Record<string, unknown>) {
    setErr(null);
    const e = await call(payload);
    if (e) setErr(e);
    else router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 22 }}>
      {err && <div className="kq-card danger" style={{ padding: 12, font: "500 12px var(--kq-font-mono)", color: "var(--kq-loss)" }}>{err}</div>}

      {/* disputes */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="kq-label">OPEN DISPUTES · {disputes.length}</div>
        {disputes.length === 0 && <EmptyNote text="NO OPEN DISPUTES" />}
        {disputes.map((d) => (
          <DisputeCard key={d.matchId} d={d} run={run} />
        ))}
      </section>

      {/* kirka screenshot reviews */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="kq-label">KIRKA SCREENSHOT REVIEWS · {kirka.length}</div>
        {kirka.length === 0 && <EmptyNote text="NOTHING PENDING" />}
        {kirka.map((k) => (
          <div key={k.userId} className="kq-card bg1" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ font: "700 16px var(--kq-font-ui)" }}>{k.username}</div>
              <div style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>CLAIMS KIRKA NICK: {k.nick}</div>
            </div>
            {k.url && (
              <a href={k.url} target="_blank" rel="noreferrer" className="kq-ghost mini">VIEW SCREENSHOT ↗</a>
            )}
            <button className="kq-ghost accent" onClick={() => run({ action: "review_kirka", userId: k.userId, approve: true })}>APPROVE</button>
            <button className="kq-ghost danger" onClick={() => run({ action: "review_kirka", userId: k.userId, approve: false })}>REJECT</button>
          </div>
        ))}
      </section>

      {/* manual tools */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <EloTool run={run} />
        <BanTool run={run} />
      </section>

      {/* action log */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="kq-label">ACTION LOG</div>
        <div className="kq-card bg1" style={{ padding: 0 }}>
          {log.length === 0 && <EmptyNote text="EMPTY" inner />}
          {log.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 12, padding: "9px 16px", borderBottom: "1px solid var(--kq-line-soft)", font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-mut)", flexWrap: "wrap" }}>
              <span style={{ color: "var(--kq-text-dim)" }}>{new Date(l.at).toLocaleString()}</span>
              <span style={{ color: "var(--kq-accent)" }}>{l.admin}</span>
              <span>{l.action}</span>
              <span style={{ color: "var(--kq-text-dim)", overflow: "hidden", textOverflow: "ellipsis" }}>{l.details}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EmptyNote({ text, inner }: { text: string; inner?: boolean }) {
  return (
    <div className={inner ? undefined : "kq-card bg1"} style={{ padding: 18, font: "500 12px var(--kq-font-mono)", color: "var(--kq-text-dim)", textAlign: "center" }}>
      {text}
    </div>
  );
}

function DisputeCard({ d, run }: { d: DisputeItem; run: (p: Record<string, unknown>) => Promise<void> }) {
  const [sa, setSa] = useState("");
  const [sb, setSb] = useState("");
  return (
    <div className="kq-card danger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ font: "700 16px var(--kq-font-ui)", color: "var(--kq-loss)" }}>⚠ MATCH #{d.matchId}</span>
        <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-mut)" }}>{d.label}</span>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {d.evidence.map((e) => (
          <div key={e.team} style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 }}>
            <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-text-dim)", letterSpacing: ".14em" }}>
              TEAM {e.team} · {e.by.toUpperCase()} CLAIMS <span style={{ color: "var(--kq-text)" }}>{e.scoreA}:{e.scoreB}</span>
            </span>
            {e.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <a href={e.url} target="_blank" rel="noreferrer">
                <img src={e.url} alt={`team ${e.team} evidence`} style={{ width: "100%", maxHeight: 180, objectFit: "cover", border: "1px solid var(--kq-line)" }} />
              </a>
            ) : (
              <span className="kq-dim">no screenshot</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="kq-input" style={{ width: 70, textAlign: "center", fontFamily: "var(--kq-font-mono)" }} placeholder="T1" value={sa} onChange={(e) => setSa(e.target.value.replace(/\D/g, ""))} />
        <span>:</span>
        <input className="kq-input" style={{ width: 70, textAlign: "center", fontFamily: "var(--kq-font-mono)" }} placeholder="T2" value={sb} onChange={(e) => setSb(e.target.value.replace(/\D/g, ""))} />
        <button
          className="kq-btn"
          disabled={!sa || !sb || sa === sb}
          onClick={() => run({ action: "resolve_dispute", matchId: d.matchId, scoreA: Number(sa), scoreB: Number(sb) })}
        >
          RESOLVE
        </button>
        <button className="kq-ghost danger" onClick={() => run({ action: "cancel_match", matchId: d.matchId, reason: "dispute: cancelled by moderator" })}>
          CANCEL MATCH
        </button>
      </div>
    </div>
  );
}

function EloTool({ run }: { run: (p: Record<string, unknown>) => Promise<void> }) {
  const [userId, setUserId] = useState("");
  const [mode, setMode] = useState<string>(MODES[0]);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="kq-card bg1" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="kq-label">MANUAL ELO ADJUST</div>
      <input className="kq-input" placeholder="user id (uuid)" value={userId} onChange={(e) => setUserId(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <select className="kq-input" style={{ flex: 1 }} value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className="kq-input" style={{ width: 100 }} placeholder="±delta" value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ""))} />
      </div>
      <input className="kq-input" placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="kq-btn"
        disabled={!userId || !delta || !reason}
        onClick={() => run({ action: "adjust_elo", userId, mode, delta: Number(delta), reason })}
      >
        APPLY
      </button>
    </div>
  );
}

function BanTool({ run }: { run: (p: Record<string, unknown>) => Promise<void> }) {
  const [userId, setUserId] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="kq-card bg1" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="kq-label">BAN / UNBAN USER</div>
      <input className="kq-input" placeholder="user id (uuid)" value={userId} onChange={(e) => setUserId(e.target.value)} />
      <input className="kq-input" placeholder="days (0 = unban)" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
      <input className="kq-input" placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="kq-ghost danger"
        disabled={!userId || days === ""}
        onClick={() => run({ action: "ban_user", userId, days: Number(days), reason })}
      >
        {days === "0" ? "UNBAN" : "BAN"}
      </button>
    </div>
  );
}
