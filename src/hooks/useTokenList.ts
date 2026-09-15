"use client";

import { useMemo } from "react";
import { baseTokens, mergeTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

/**
 * Every token the app knows about on this chain. Robinhood Chain has no curated
 * token list to fetch, and the app ships no bundled snapshot, so the universe is
 * the chain's own money plus whatever the reader imported or the wallet scan
 * turned up — all of it read from contracts rather than from a feed.
 */
export function useTokenList(chainId: number | undefined) {
  const customTokens = useAppStore((state) => state.customTokens);
  const discoveredTokens = useAppStore((state) => state.discoveredTokens);
  const venueKey = useAppStore((state) => state.venueKey);

  const tokens = useMemo<Token[]>(() => {
    if (!chainId) return [];
    return mergeTokens(chainId, baseTokens(chainId), customTokens, discoveredTokens);
    // `venueKey` changes when the routing venue resolves, which is what brings
    // the wrapped and stable tokens into `baseTokens`.
  }, [chainId, customTokens, discoveredTokens, venueKey]);

  /**
   * The addresses that count as known rather than unlisted. With no curated
   * list on this chain that is exactly the chain's own money: everything else a
   * reader pastes is, by construction, an unvetted contract.
   */
  const listed = useMemo(
    () =>
      new Set(
        (chainId ? baseTokens(chainId) : []).map((token) => token.address.toLowerCase()),
      ),
    // Recomputed on `venueKey` for the same reason as the list above: the
    // wrapped and stable tokens only exist once a venue has resolved.
    [chainId, venueKey],
  );

  return { tokens, listed, isLoading: false, error: null as Error | null };
}
