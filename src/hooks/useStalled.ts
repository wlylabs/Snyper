"use client";

import { useEffect, useState } from "react";

/**
 * Whether something has been loading long enough that it is fair to call it
 * stuck rather than slow.
 *
 * The wallet session has two steps that can fail without ever throwing: the
 * chunk that carries the Privy SDK may not arrive, and the SDK may not get an
 * answer out of Privy once it has. Both leave a placeholder that spins forever,
 * which reads to the reader as a button that cannot be clicked — there is no
 * button. This is the clock that ends that wait, so the controls can offer
 * something a reader can actually press.
 *
 * The timer starts on mount, so a component that gates on this gets its own
 * window rather than a share of one. That is what makes it usable at both steps:
 * the second only mounts once the first has finished.
 */
export function useStalled(ms: number): boolean {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);

  return stalled;
}
