"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
import { haptic } from "@/lib/haptics";

type Props = {
  label: string;
  /** Shown once the slide has gone through. */
  doneLabel: string;
  /** Shown while the trade is in flight. */
  busyLabel: string;
  onFire: () => void;
  disabled?: boolean;
  busy?: boolean;
  done?: boolean;
  icon?: IconName;
};

/** How far along the track counts as gone through. */
const THROUGH = 0.96;

/**
 * Slide to fire.
 *
 * A tap is the wrong gesture for the one control on this screen that spends
 * money. Not because it is too fast — speed is the whole point of a terminal —
 * but because on a phone it is the same gesture as scrolling past, and the
 * button sits directly under a list the reader has been dragging. A slide
 * cannot be arrived at by accident, and it is still one motion of one thumb.
 *
 * It is not a hold. Holding makes the reader wait out a timer the app chose,
 * which is friction sold as safety; a slide is over the moment their thumb
 * reaches the end, so a reader who knows what they want is not slowed down at
 * all. Letting go early springs it back and nothing happens.
 *
 * Keyboards get Enter or Space, because a slide is a pointer idiom and there is
 * no honest way to express it on a key. The guard it provides is against a
 * mis-tap, and a keyboard cannot mis-tap in that way.
 */
export function SlideToFire({
  label,
  doneLabel,
  busyLabel,
  onFire,
  disabled,
  busy,
  done,
  icon = "crosshair",
}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const origin = useRef<number>(0);
  const travel = useRef<number>(1);
  const [sliding, setSliding] = useState(false);

  const set = useCallback((value: number) => {
    track.current?.style.setProperty("--slide", String(value));
  }, []);

  const release = useCallback(() => {
    setSliding(false);
    set(0);
  }, [set]);

  // A pointer that leaves the window mid-drag has to spring back the same as
  // one released on the track, or the thumb stays stranded where it stopped.
  useEffect(() => release, [release]);

  const locked = disabled || busy || done;

  const begin = (clientX: number, element: HTMLElement) => {
    if (locked) return;
    const rail = track.current;
    if (!rail) return;
    origin.current = clientX;
    travel.current = Math.max(1, rail.clientWidth - element.offsetWidth - 8);
    setSliding(true);
    haptic("tap");
  };

  const move = (clientX: number) => {
    if (!sliding) return;
    set(Math.min(1, Math.max(0, (clientX - origin.current) / travel.current)));
  };

  const end = (clientX: number) => {
    if (!sliding) return;
    const progress = Math.min(1, Math.max(0, (clientX - origin.current) / travel.current));
    release();
    if (progress >= THROUGH) {
      haptic("commit");
      onFire();
    }
  };

  return (
    <div
      ref={track}
      className="slide"
      data-sliding={sliding ? "true" : undefined}
      data-locked={locked ? "true" : undefined}
      style={{ "--slide": 0 } as CSSProperties}
    >
      <span className="slide-label" aria-hidden>
        {done ? doneLabel : busy ? busyLabel : label}
      </span>
      <button
        type="button"
        className="slide-thumb"
        disabled={locked}
        aria-label={label}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          begin(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => move(event.clientX)}
        onPointerUp={(event) => end(event.clientX)}
        onPointerCancel={release}
        onKeyDown={(event) => {
          if (event.repeat || locked) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            haptic("commit");
            onFire();
          }
        }}
        /* The drag is the interaction, so a stray click must not fire it. */
        onClick={(event) => event.preventDefault()}
      >
        <Icon name={busy ? "refresh" : done ? "check" : icon} size={15} />
      </button>
    </div>
  );
}
