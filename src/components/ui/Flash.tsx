"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Wash = { id: number; dir: "up" | "down" };

/**
 * Wraps a live number so a change lands with a wash of colour behind it — green
 * up, red down — that drains away over about half a second. Dealing screens do
 * this because a figure that moved has to be findable without the reader
 * watching it, and because the alternative, moving the number itself, makes a
 * table of them impossible to read.
 *
 * The wash is a sibling of the content rather than a state on it: mounting a
 * fresh element per change is what restarts the animation when the price ticks
 * twice inside one run, and it keeps the digits themselves untouched.
 */
export function Flash({
  value,
  className = "",
  children,
}: {
  /** The number being watched. Undefined reads as "nothing to compare yet". */
  value?: number;
  className?: string;
  children: ReactNode;
}) {
  const previous = useRef(value);
  const counter = useRef(0);
  const [wash, setWash] = useState<Wash>();

  useEffect(() => {
    const last = previous.current;
    previous.current = value;
    if (value === undefined || last === undefined || value === last) return;
    counter.current += 1;
    setWash({ id: counter.current, dir: value > last ? "up" : "down" });
  }, [value]);

  useEffect(() => {
    if (!wash) return;
    const id = window.setTimeout(() => setWash(undefined), 700);
    return () => window.clearTimeout(id);
  }, [wash]);

  return (
    <span className={`flash ${className}`}>
      {children}
      {wash && <span key={wash.id} className="flash-wash" data-dir={wash.dir} aria-hidden />}
    </span>
  );
}
