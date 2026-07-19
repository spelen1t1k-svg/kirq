import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { mapCode, mapsForMode } from "@/lib/maps";
import { MODES, type Mode } from "@/config/game";

export const dynamic = "force-dynamic";

/**
 * GET /api/maps?mode=1v1            → map pool metadata (names, previews, hasCode)
 * GET /api/maps?mode=1v1&code=<id>  → full Kirka map code as text/plain
 * Codes can be ~100KB map exports, so they are fetched on demand, never bundled.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") as Mode | null;
  if (!mode || !MODES.includes(mode)) {
    return NextResponse.json({ error: "unknown mode" }, { status: 400 });
  }

  const codeId = url.searchParams.get("code");
  if (codeId) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const code = mapCode(mode, codeId);
    if (code === null) return NextResponse.json({ error: "no code for this map" }, { status: 404 });
    return new NextResponse(code, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }

  return NextResponse.json({ maps: mapsForMode(mode) });
}
