"use client";

import { useEffect, useRef } from "react";
import { usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { tokenKey } from "@/lib/tokens";
import { resolveTokenLogos } from "@/lib/tokenFeed";
import { useAppStore } from "@/store/useAppStore";

/**
 * How many tokens one pass asks about. Each one costs six calls inside the
 * multicall, so this is the batch that keeps a single request comfortable while
 * still clearing a freshly scanned wallet in a few passes. It also stays under
 * the thirty addresses the indexer takes in one request, so the second source
 * is one request per pass too.
 */
const BATCH = 20;

/** Settles after the list stops changing, so a scan's arrivals go in one pass. */
const SETTLE_MS = 400;

/**
 * Asks every token the app knows about what it looks like, once.
 *
 * The answers live in the store, keyed by token, including the empty answers —
 * so this only ever works on tokens nothing has asked about yet, and a reader
 * who has been here before starts with the artwork already in hand.
 */
export function useTokenLogos() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const customTokens = useAppStore((state) => state.customTokens);
  const discoveredTokens = useAppStore((state) => state.discoveredTokens);
  const tokenLogos = useAppStore((state) => state.tokenLogos);
  const setTokenLogos = useAppStore((state) => state.setTokenLogos);
  const hydrated = useAppStore((state) => state.hydrated);

  /* Addresses already in flight, so a re-render cannot start a second pass. */
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!client || !hydrated) return;

    const pending = [...customTokens, ...discoveredTokens]
      .filter(
        (token) =>
          token.chainId === CHAIN_ID &&
          !token.native &&
          !token.logoURI &&
          tokenLogos[tokenKey(token)] === undefined &&
          !inFlight.current.has(tokenKey(token)),
      )
      .slice(0, BATCH);

    if (pending.length === 0) return;

    const keys = pending.map(tokenKey);

    const timer = window.setTimeout(() => {
      keys.forEach((key) => inFlight.current.add(key));
      void resolveTokenLogos(
        client,
        pending.map((token) => token.address),
      )
        .then((found) => {
          /*
           * Recorded even if this effect has since been torn down. The answers
           * go to a store rather than to component state, so a pass that
           * outlives its render is still worth keeping — dropping it would
           * strand these tokens behind the in-flight guard for the session.
           */
          const logos: Record<string, string> = {};
          for (const token of pending) {
            logos[tokenKey(token)] = found.get(token.address.toLowerCase()) ?? "";
          }
          setTokenLogos(logos);
        })
        .catch(() => {
          // The chain was unreachable rather than silent, so nothing is
          // recorded and the next pass asks these tokens again.
          keys.forEach((key) => inFlight.current.delete(key));
        });
    }, SETTLE_MS);

    /* Only an unstarted pass is cancelled; a started one is left to land. */
    return () => window.clearTimeout(timer);
  }, [client, hydrated, customTokens, discoveredTokens, tokenLogos, setTokenLogos]);
}

/** Mounted once, beside the other background readers. */
export function TokenLogoSync() {
  useTokenLogos();
  return null;
}
