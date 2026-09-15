"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * The control that turns the trade around.
 *
 * It is handed the running count of inversions rather than keeping its own,
 * because the same number drives the two legs passing each other in the panel
 * above and below it — one press, one piece of choreography, one source for it.
 * The count is what makes the glyph turn forwards every time instead of
 * flicking back and forth between two positions.
 *
 * Parity is the restart: a CSS animation replays when the animation changes,
 * not when an attribute does, so the ring and the rule alternate between two
 * identically-shaped animations and fire on every press, however fast.
 */
export function FlipButton({
  turns,
  onFlip,
  label,
}: {
  turns: number;
  onFlip: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="flip"
      style={{ "--turn": turns } as CSSProperties}
      onClick={onFlip}
      aria-label={label}
      title={label}
    >
      <Icon name="swap" size={15} />
    </button>
  );
}
