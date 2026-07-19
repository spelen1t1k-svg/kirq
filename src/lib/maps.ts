import "server-only";
import fs from "node:fs";
import path from "node:path";
import { MODE_META, type Mode } from "@/config/game";

export interface MapInfo {
  /** Stable id = image filename without extension (e.g. "Clash1v1"). */
  id: string;
  /** Display name with the mode suffix stripped (e.g. "CLASH"). */
  name: string;
  /** Public URL of the preview image. */
  image: string;
  /** Whether a Kirka map code exists for this map. */
  hasCode: boolean;
}

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function mapsRoot() {
  return path.join(process.cwd(), "public", "maps");
}

/**
 * Map codes source, per spec: optional /public/maps/maps.json.
 * Two supported shapes (both exist in the wild):
 *  - a JSON file: { "MapName": "code", ... }
 *  - a DIRECTORY named maps.json containing <MapName>.txt files whose
 *    content is the full Kirka map export (this is what ships in this repo).
 */
function codeFor(id: string): string | null {
  const p = path.join(mapsRoot(), "maps.json");
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const f = path.join(p, `${id}.txt`);
      if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
      return null;
    }
    const obj = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, string>;
    return obj[id] ?? null;
  } catch {
    return null;
  }
}

function stripModeSuffix(stem: string): string {
  return stem.replace(/(1v1|2v2)$/i, "");
}

/** Map pool for a mode, read from /public/maps/<dir>. Filename = map name, file = preview. */
export function mapsForMode(mode: Mode): MapInfo[] {
  const dir = MODE_META[mode].mapDir;
  const full = path.join(mapsRoot(), dir);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(full);
  } catch {
    return [];
  }
  return entries
    .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const id = path.basename(f, path.extname(f));
      return {
        id,
        name: stripModeSuffix(id).toUpperCase(),
        image: `/maps/${dir}/${f}`,
        hasCode: codeFor(id) !== null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mapById(mode: Mode, id: string): MapInfo | null {
  return mapsForMode(mode).find((m) => m.id === id) ?? null;
}

/** Full map code (may be large — served on demand, never bundled). */
export function mapCode(mode: Mode, id: string): string | null {
  if (!mapById(mode, id)) return null; // whitelisted ids only, no path traversal
  return codeFor(id);
}
