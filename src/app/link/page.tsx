import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getUser } from "@/lib/supabase/server";
import { LinkKirkaClient } from "./ui";

export const dynamic = "force-dynamic";

export default async function LinkPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return (
    <div className="kq-page">
      <TopBar />
      <main className="kq-container" style={{ padding: "34px 28px 40px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 className="kq-h2">LINK YOUR KIRKA ACCOUNT</h1>
          <span style={{ font: "500 11px var(--kq-font-mono)", color: "var(--kq-text-dim)" }}>
            STEP AFTER SIGN-IN · REQUIRED TO QUEUE
          </span>
        </div>
        <LinkKirkaClient userId={user.id} />
      </main>
    </div>
  );
}
