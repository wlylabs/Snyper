"use client";

import { useEffect } from "react";

/**
 * Every control that carries the press wash. Kept in one string because the
 * handler is delegated: a button added to any page next week is covered by
 * this without being told about it, which is the only way a press language
 * stays consistent across an app that is still being built.
 */
const PRESSABLE = ".btn, .icon-btn, button.chip, .tile, .pill, .row-link, .seg-item";

/** Rules out `span.btn` badges and the like — only what can really be pressed. */
const INTERACTIVE = 'button:not(:disabled), a[href], [role="button"]';

function pressable(node: EventTarget | null): HTMLElement | undefined {
  if (!(node instanceof Element)) return undefined;
  const hit = node.closest<HTMLElement>(PRESSABLE);
  if (!hit || !hit.matches(INTERACTIVE)) return undefined;
  return hit;
}

/**
 * Writes where the press landed onto the control that was pressed.
 *
 * The wash itself is CSS — see the press section of `globals.css`. All that
 * cannot be done in a stylesheet is the coordinate: a pseudo-element has no way
 * of knowing which pixel the finger came down on, so the point and the radius
 * that will cover the furthest corner from it are handed over as custom
 * properties, and the parity flips on every press so the animation replays for
 * a reader tapping the same button repeatedly.
 *
 * A keyboard press has no coordinate, so it keeps the default — the middle —
 * and the same wash runs from there.
 */
export function PressWash() {
  useEffect(() => {
    const mark = (target: HTMLElement, point?: { x: number; y: number }) => {
      if (point) {
        const rect = target.getBoundingClientRect();
        const x = point.x - rect.left;
        const y = point.y - rect.top;
        target.style.setProperty("--press-x", `${x}px`);
        target.style.setProperty("--press-y", `${y}px`);
        target.style.setProperty(
          "--press-r",
          `${Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y))}px`,
        );
      } else {
        target.style.removeProperty("--press-x");
        target.style.removeProperty("--press-y");
        target.style.removeProperty("--press-r");
      }
      target.dataset.press = target.dataset.press === "0" ? "1" : "0";
    };

    const onPointerDown = (event: PointerEvent) => {
      // Anything but the primary button is a menu or a gesture, not a press.
      if (event.button !== 0) return;
      const target = pressable(event.target);
      if (target) mark(target, { x: event.clientX, y: event.clientY });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = pressable(event.target);
      if (target) mark(target);
    };

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
