"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { baseTokens, fetchTokenList, mergeTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

export function useTokenList(chainId: number | undefined) {
  const customTokens = useAppStore((state) => state.customTokens);
  const discoveredTokens = useAppStore((state) => state.discoveredTokens);

  const query = useQuery({
    queryKey: ["uniswap-token-list"],
    queryFn: fetchTokenList,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const tokens = useMemo<Token[]>(() => {
    if (!chainId) return [];
    return mergeTokens(
      chainId,
      baseTokens(chainId),
      customTokens,
      discoveredTokens,
      query.data ?? [],
    );
  }, [chainId, customTokens, discoveredTokens, query.data]);

  /** Addresses the curated list carries, used to flag everything else. */
  const listed = useMemo(
    () =>
      new Set(
        (query.data ?? [])
          .filter((token) => token.chainId === chainId)
          .map((token) => token.address.toLowerCase()),
      ),
    [chainId, query.data],
  );

  return {
    tokens,
    listed,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
