/*
 * Haptics, used sparingly.
 *
 * A phone can answer a press in the one channel a screen cannot, and every
 * native trading app uses it — but it is also the fastest way to make an app
 * irritating, so this is not wired to every button. It fires on the three
 * moments that actually commit something: the trade going out, the panel being
 * turned around, and a hold that has run long enough to destroy something. A
 * reader who has asked their system for less motion has asked for less of this
 * too, and desktops and iOS Safari simply have no vibrator, where every call
 * here is a no-op.
 */

type Feel = "tap" | "turn" | "commit";

const PATTERNS: Record<Feel, number | number[]> = {
  /** Acknowledgement: the shortest pulse most hardware will still render. */
  tap: 8,
  /** Something reversed — two beats, because two things changed places. */
  turn: [10, 26, 10],
  /** Sent, or confirmed past the point of taking back. */
  commit: [14, 30, 22],
};

export function haptic(feel: Feel = "tap"): void {
  if (typeof window === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(PATTERNS[feel]);
  } catch {
    /* Vibration is a courtesy; a browser refusing it changes nothing. */
  }
}
