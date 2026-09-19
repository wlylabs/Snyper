"use client";

import { useEffect } from "react";
import type { Watch, Watchable } from "@/lib/memory";
import { useAppStore } from "@/store/useAppStore";

/**
 * Keep what the screen just read, and hand back everything kept before it.
 *
 * In an effect rather than in the render, because recording is a write and a
 * render that writes is a render that can run twice and count twice. The write
 * itself decides whether this reading is far enough from the last one to be
 * worth keeping — see `observe` in the store — so an effect firing on every
 * re-render costs nothing but the comparison.
 *
 * It is the memecoin screen that records, and deliberately only that screen.
 * It is the one place holding both sources at once — what traded in the window
 * and what opened today, merged and folded to one row per token — and a second
 * caller recording a narrower list would file readings under the same tokens
 * with different figures behind them. The terminal reads the same store and
 * writes nothing to it.
 *
 * Nothing here waits for the store to rehydrate. An unrehydrated store is
 * empty, an empty watch produces no drift, and a drift that has not arrived is
 * already the state every token is in for the first ten minutes of watching —
 * so there is nothing to guard against and no flash to avoid.
 */
export function useWatch(rows: readonly Watchable[], head: bigint | undefined): Watch {
  const watch = useAppStore((state) => state.watch);
  const observe = useAppStore((state) => state.observe);

  useEffect(() => {
    if (head === undefined || rows.length === 0) return;
    observe(rows, head);
  }, [rows, head, observe]);

  return watch;
}
