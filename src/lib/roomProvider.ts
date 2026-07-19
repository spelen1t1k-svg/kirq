/**
 * RoomProvider — thin abstraction over "how a Kirka room comes to exist".
 *
 * Today the only implementation is ManualHost: the highest-Elo player creates
 * the room by hand following the Host panel instructions and pastes the link.
 * The boundary exists so an auto-host (bot) provider can be added later
 * without touching the match window: when provider.needsHostPanel is false,
 * the Host panel module disappears entirely and the layout collapses to a
 * single chat column (per design spec, screen 1d).
 */

export interface RoomProvider {
  readonly kind: "manual_host" | "auto_host";
  /** Whether the match window must render the Host panel for the host player. */
  readonly needsHostPanel: boolean;
  /** Validates a room link before it is published to the match. */
  validateRoomLink(url: string): { ok: true; url: string } | { ok: false; error: string };
}

const KIRKA_LINK_RE = /^(https?:\/\/)?(www\.)?kirka\.io\/games\/[A-Za-z0-9~_-]+$/;

export const manualHostProvider: RoomProvider = {
  kind: "manual_host",
  needsHostPanel: true,
  validateRoomLink(url: string) {
    const trimmed = url.trim();
    if (!KIRKA_LINK_RE.test(trimmed)) {
      return { ok: false, error: "Link must look like kirka.io/games/XXXXX" };
    }
    const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    return { ok: true, url: normalized };
  },
};

/** Active provider for new matches. Swap here when auto-host lands. */
export function roomProviderFor(): RoomProvider {
  return manualHostProvider;
}

/** Detects a kirka.io room link inside arbitrary chat text (for CONNECT buttons). */
export function extractKirkaLink(text: string): string | null {
  const m = text.match(/(https?:\/\/)?(www\.)?kirka\.io\/games\/[A-Za-z0-9~_-]+/);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
}
