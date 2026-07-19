"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

interface KirkaAccount {
  kirka_nick: string;
  status: "pending" | "verified" | "rejected";
}

/**
 * Kirka linking — nickname + account screenshot, manual review by moderators.
 */
export function LinkKirkaClient({ userId }: { userId: string }) {
  const router = useRouter();
  const [account, setAccount] = useState<KirkaAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nick, setNick] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/kirka");
    if (!res.ok) return;
    const data = await res.json();
    setAccount(data.account);
    if (data.account?.kirka_nick) setNick(data.account.kirka_nick);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while pending so the player sees approval without reloading.
  useEffect(() => {
    if (account?.status !== "pending") return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [account?.status, load]);

  async function submit() {
    if (!file || !nick.trim()) return;
    setErr(null);
    setBusy(true);
    const supabase = supabaseBrowser();
    const ext = file.name.split(".").pop() || "png";
    const path = `kirka/${userId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("screenshots").upload(path, file, { upsert: true });
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }
    const res = await fetch("/api/kirka", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nick, path }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setErr(data.error ?? "failed");
      return;
    }
    setFile(null);
    await load();
  }

  if (!loaded) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <div className="kq-spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (account?.status === "verified") {
    return (
      <div className="kq-card tint kq-fade" style={{ marginTop: 22, padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-win)", letterSpacing: ".14em" }}>
          ✓ VERIFIED — LINKED TO {account.kirka_nick.toUpperCase()}
        </div>
        <button className="kq-btn" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => router.push("/play")}>
          GO PLAY ➜
        </button>
      </div>
    );
  }

  return (
    <div className="kq-fade" style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 22, maxWidth: 640 }}>
      {account?.status === "pending" && (
        <div className="kq-card tint" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <div className="kq-spinner" style={{ width: 16, height: 16 }} />
          <span style={{ font: "500 12px var(--kq-font-mono)", color: "var(--kq-accent)" }}>
            SCREENSHOT FOR {account.kirka_nick.toUpperCase()} IS PENDING MANUAL REVIEW · UP TO 24H
          </span>
        </div>
      )}
      {account?.status === "rejected" && (
        <div className="kq-card danger" style={{ padding: 16, font: "500 12px var(--kq-font-mono)", color: "var(--kq-loss)" }}>
          VERIFICATION REJECTED — SUBMIT AGAIN OR ASK IN DISCORD
        </div>
      )}

      {/* 01 — nickname */}
      <div className="kq-card bg1" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-accent)", letterSpacing: ".18em" }}>
          01 · NICKNAME
        </div>
        <p className="kq-mut" style={{ margin: 0, fontSize: 13 }}>Enter your exact in-game Kirka nickname.</p>
        <input
          className="kq-input"
          placeholder="your Kirka nick"
          value={nick}
          maxLength={32}
          onChange={(e) => setNick(e.target.value)}
        />
      </div>

      {/* 02 — screenshot */}
      <div className="kq-card bg1" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-accent)", letterSpacing: ".18em" }}>
          02 · ACCOUNT SCREENSHOT
        </div>
        <p className="kq-mut" style={{ margin: 0, fontSize: 13 }}>
          Upload a screenshot of your Kirka account page (profile open, nickname visible).
          Moderators review it manually — usually much faster than 24h.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          style={{
            border: "1px dashed var(--kq-line-2)", padding: 18, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 4, background: "var(--kq-stripes)", cursor: "pointer",
          }}
          onClick={() => fileRef.current?.click()}
        >
          <span style={{ font: "600 13px var(--kq-font-ui)", color: file ? "var(--kq-win)" : "var(--kq-text-mut)" }}>
            {file ? `✓ ${file.name}` : "⇧ Drop / choose your Kirka account screenshot"}
          </span>
          {!file && (
            <span style={{ font: "500 10px var(--kq-font-mono)", color: "var(--kq-loss)", letterSpacing: ".1em" }}>
              REQUIRED — SUBMIT IS LOCKED WITHOUT IT
            </span>
          )}
        </button>
        <button
          className="kq-btn"
          style={{ width: "100%", padding: 14, fontSize: 15 }}
          disabled={busy || !file || !nick.trim()}
          onClick={submit}
        >
          {busy ? "UPLOADING…" : "SUBMIT FOR REVIEW"}
        </button>
      </div>

      {err && <div className="kq-loss-c" style={{ font: "500 12px var(--kq-font-mono)" }}>{err}</div>}
    </div>
  );
}
