import { ELO_K } from "@/config/game";

/**
 * Client/display-side Elo math. The AUTHORITATIVE calculation happens in
 * Postgres (finalize_match SQL function) — this mirrors it for previews.
 */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function eloDelta(own: number, opp: number, won: boolean): number {
  return Math.round(ELO_K * ((won ? 1 : 0) - expectedScore(own, opp)));
}
