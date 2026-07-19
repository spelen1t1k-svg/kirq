import { divisionFor, rankColor } from "@/config/game";

/**
 * Hex rank badge (design: two clip-path layers, group color + level number).
 * Top-10 leaderboard players show "#place" (Challenger) instead of the level.
 */
export function HexBadge({
  elo,
  place,
  size = 28,
  bg = "var(--kq-surface)",
}: {
  elo: number;
  place?: number | null;
  size?: number;
  bg?: string;
}) {
  const hex = "polygon(50% 0, 95% 26%, 95% 74%, 50% 100%, 5% 74%, 5% 26%)";
  const chal = place != null && place <= 10;
  const level = divisionFor(elo);
  const color = chal ? "var(--kq-rank-chal)" : rankColor(level);
  const label = chal ? (place === 1 ? "★" : `#${place}`) : String(level);
  const fs = Math.round(size * (chal && place !== 1 ? 0.32 : 0.41));
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: hex,
          background: color,
          boxShadow: chal ? "var(--kq-glow-accent)" : undefined,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 2,
          clipPath: hex,
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `700 ${fs}px var(--kq-font-mono)`,
          color,
        }}
      >
        {label}
      </div>
    </div>
  );
}
