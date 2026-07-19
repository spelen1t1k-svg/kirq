"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Sign in — Discord only. */
export default function LoginPage() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function withDiscord() {
    setErr(null);
    setBusy(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(false);
      setErr(error.message);
    }
  }

  return (
    <div className="kq-page kq-grid-bg" style={{ alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="kq-card bg1 kq-fade" style={{ width: "min(420px, 100%)", padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        <Logo />
        <div>
          <h1 className="kq-h2" style={{ fontSize: 24 }}>SIGN IN</h1>
          <p className="kq-mut" style={{ margin: "6px 0 0", fontSize: 14 }}>
            Discord is the only way in — match tickets and disputes live there.
          </p>
        </div>
        <button className="kq-btn discord" style={{ width: "100%", padding: 16, fontSize: 16 }} disabled={busy} onClick={withDiscord}>
          {busy ? "REDIRECTING…" : "SIGN IN WITH DISCORD"}
        </button>
        {err && <div className="kq-loss-c" style={{ font: "500 12px var(--kq-font-mono)" }}>{err}</div>}
      </div>
    </div>
  );
}
