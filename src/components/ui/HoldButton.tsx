"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
import { haptic } from "@/lib/haptics";

type Props = {
  label: string;
  /** Shown while the finger is down — says what the hold is going to do. */
  holdLabel: string;
  onConfirm: () => void;
  icon?: IconName;
  /** How long the hold has to last. Long enough to be deliberate, short
      enough that nobody wonders whether the control is broken. */
  duration?: number;
  className?: string;
};

/**
 * Press and hold to confirm.
 *
 * Dropping a wallet from the session — the one action here a reader cannot take
 * back — used to be a single tap, or a tap followed by a second button that
 * looked exactly like the first. Both are the same mistake: a dialog answered
 * on reflex is not a confirmation, it is a habit, and the tap that opened it
 * was the only deliberate part.
 *
 * Holding moves the deliberation into the press itself. The fill sweeping
 * across the button is the reader's own commitment being drawn, letting go
 * before it completes cancels with nothing to dismiss, and the action fires
 * exactly once at the end. Keyboards get the same deal on Enter or Space.
 */
export function HoldButton({
  label,
  holdLabel,
  onConfirm,
  icon,
  duration = 900,
  className = "",
}: Props) {
  const frame = useRef<number>(undefined);
  const started = useRef<number>(0);
  const fill = useRef<HTMLButtonElement>(null);
  const [holding, setHolding] = useState(false);

  const setProgress = (value: number) => {
    fill.current?.style.setProperty("--hold", String(value));
  };

  const stop = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    setHolding(false);
    setProgress(0);
  }, []);

  // A pointer released outside the button, or a tab switched away mid-hold,
  // has to drain the same as a release on it — otherwise the fill freezes.
  useEffect(() => stop, [stop]);

  /*
   * The release, watched on the window as well as on the button.
   *
   * `setPointerCapture` is what normally guarantees the release comes back
   * here, and it is not a guarantee: it throws if the pointer has already gone,
   * and a browser that hands the gesture to something else takes the capture
   * with it. Either way the button would be left holding a fill that nothing
   * drains, and the next press — already refused, because a frame is still
   * scheduled — would do nothing at all. That is a disconnect button that has
   * quietly stopped working. The window sees every release, so it is asked too.
   */
  useEffect(() => {
    if (!holding) return;
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [holding, stop]);

  const start = () => {
    if (frame.current !== undefined) return;
    haptic("tap");
    started.current = performance.now();
    setHolding(true);
    const step = () => {
      const progress = Math.min(1, (performance.now() - started.current) / duration);
      setProgress(progress);
      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      frame.current = undefined;
      setHolding(false);
      setProgress(0);
      haptic("commit");
      onConfirm();
    };
    frame.current = requestAnimationFrame(step);
  };

  return (
    <button
      ref={fill}
      type="button"
      className={`btn btn-hold ${className}`}
      data-holding={holding ? "true" : undefined}
      style={{ "--hold": 0 } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* The window listener above covers the release either way. */
        }
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      /*
       * A captured pointer keeps reporting to this button wherever the finger
       * travels, so a leave while it is held is the capture being handed back on
       * the way up — which the release has already drained. Cancelling on it
       * instead is what made the hold fail on a phone: the press itself nudges
       * the button a pixel under the finger, the leave fires, and a reader who
       * never moved watches the fill reset. Uncaptured, a leave is a real exit.
       */
      onPointerLeave={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
        stop();
      }}
      onKeyDown={(event) => {
        if (event.repeat) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={stop}
      onBlur={stop}
      /* The press is the whole interaction, so a plain click must not fire it. */
      onClick={(event) => event.preventDefault()}
    >
      {icon && <Icon name={icon} size={14} />}
      <span aria-live="polite">{holding ? holdLabel : label}</span>
    </button>
  );
}
