import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { MODES } from "@/config/game";
import { mapsForMode } from "./maps";

/**
 * Mirrors /public/maps/* into the map_pool table so SQL (matchmaker) can
 * snapshot pools at match creation. Cheap; runs on cron tick and queue join.
 */
export async function syncMapPool(admin: SupabaseClient): Promise<void> {
  for (const mode of MODES) {
    const maps = mapsForMode(mode);
    if (maps.length === 0) continue;
    await admin.from("map_pool").upsert(
      maps.map((m, i) => ({
        mode,
        id: m.id,
        name: m.name,
        has_code: m.hasCode,
        active: true,
        ord: i,
      })),
      { onConflict: "mode,id" }
    );
    // deactivate maps whose files were removed
    await admin
      .from("map_pool")
      .update({ active: false })
      .eq("mode", mode)
      .not("id", "in", `(${maps.map((m) => `"${m.id}"`).join(",")})`);
  }
}
