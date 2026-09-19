"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Option<T extends string> = { value: T; label: string; disabled?: boolean };

type Marker = { left: number; width: number };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<Marker>();

  /**
   * The selection block is measured off the active tab rather than guessed from
   * a fraction of the track: options are sized by their labels, so a three-way
   * control with one long word has three different widths. Layout effect, so
   * the block is already in place on the first paint after hydration and the
   * control never shows an unmarked selection.
   */
  useLayoutEffect(() => {
    const root = track.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>('[data-active="true"]');
    /*
     * Nothing selected is a state, not a failure to measure. A control whose
     * value has moved somewhere else — a typed amount beside a row of presets —
     * used to keep its block sitting under whichever option was picked last,
     * which reads as a claim that the preset is still in force.
     */
    if (!active) {
      setMarker(undefined);
      return;
    }

    const measure = () => setMarker({ left: active.offsetLeft, width: active.offsetWidth });
    measure();

    // Labels reflow when the language changes or the column resizes.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div
      ref={track}
      className={`seg ${className}`}
      role="tablist"
      data-measured={marker ? "true" : undefined}
    >
      <span
        aria-hidden
        className="seg-marker"
        style={
          marker
            ? { width: marker.width, transform: `translateX(${marker.left}px)` }
            : undefined
        }
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          data-active={option.value === value}
          className="seg-item"
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
