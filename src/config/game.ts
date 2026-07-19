/**
 * KIRQ — central game configuration.
 * Everything gameplay-tunable lives here (mirrored in SQL where the DB needs it).
 */

export const MODES = ["1v1", "2v2_point"] as const;
export type Mode = (typeof MODES)[number];

export const REGIONS = ["NA", "EU", "ASIA"] as const;
export type Region = (typeof REGIONS)[number];

export const ELO_START = 1000;
export const ELO_K = 32;

/** Elo penalty applied to a player who dodges / no-shows a match. */
export const DODGE_PENALTY = 25;

/** Matchmaking window: base ± and expansion per 30s of queue wait. */
export const MM_BASE_WINDOW = 100;
export const MM_EXPAND_PER_30S = 50;

/** Seconds a captain has for each veto turn before an auto-ban fires. */
export const VETO_TURN_SECONDS = 30;

/** Minutes after the first result submission before it auto-confirms. */
export const RESULT_AUTOCONFIRM_MIN = 15;

export interface RoomSettings {
  kirka_mode: string;
  score_limit: number;
  time_limit_min: number;
  players: number;
  bots: number;
  type: string;
  physics: string;
  bhop: boolean;
  weapons: string;
}

/**
 * Kirka custom-room settings per mode. The host sets these BY HAND in the game;
 * the site shows them to the host-captain as an instruction (Host panel).
 */
export const ROOM_SETTINGS: Record<Mode, RoomSettings> = {
  "1v1": {
    kirka_mode: "TDM",
    score_limit: 15,
    time_limit_min: 60,
    players: 2,
    bots: 0,
    type: "private",
    physics: "normal",
    bhop: true,
    weapons: "all",
  },
  "2v2_point": {
    kirka_mode: "Point",
    score_limit: 60,
    time_limit_min: 60,
    players: 4,
    bots: 0,
    type: "private",
    physics: "normal",
    bhop: true,
    weapons: "all",
  },
};

export const MODE_META: Record<
  Mode,
  { title: string; sub: string; teamSize: number; playersTotal: number; mapDir: string }
> = {
  "1v1": { title: "1v1", sub: "DUEL", teamSize: 1, playersTotal: 2, mapDir: "1v1" },
  "2v2_point": { title: "2v2", sub: "POINT", teamSize: 2, playersTotal: 4, mapDir: "2v2" },
};

/** Rank divisions (from the design spec, screen 1n). */
export const DIVISIONS: { level: number; min: number; max: number | null }[] = [
  { level: 1, min: 0, max: 1099 },
  { level: 2, min: 1100, max: 1199 },
  { level: 3, min: 1200, max: 1299 },
  { level: 4, min: 1300, max: 1399 },
  { level: 5, min: 1400, max: 1499 },
  { level: 6, min: 1500, max: 1624 },
  { level: 7, min: 1625, max: 1749 },
  { level: 8, min: 1750, max: 1899 },
  { level: 9, min: 1900, max: 2049 },
  { level: 10, min: 2050, max: null },
];

export function divisionFor(elo: number): number {
  for (const d of DIVISIONS) if (elo >= d.min && (d.max === null || elo <= d.max)) return d.level;
  return 1;
}

/** Rank group color, matching --kq-rank-* tokens. */
export function rankColor(level: number): string {
  if (level >= 10) return "var(--kq-rank-10)";
  if (level >= 8) return "var(--kq-rank-8-9)";
  if (level >= 4) return "var(--kq-rank-4-7)";
  if (level >= 2) return "var(--kq-rank-2-3)";
  return "var(--kq-rank-1)";
}

export function modeLabel(mode: Mode): string {
  const m = MODE_META[mode];
  return `${m.title} ${m.sub}`;
}
