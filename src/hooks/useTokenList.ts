"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { baseTokens, fetchTokenList, mergeTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

export function useTokenList(chainId: number | undefined) {
  const customTokens = useAppStore((state) => state.customTokens);

  const query = useQuery({
    queryKey: ["uniswap-token-list"],
    queryFn: fetchTokenList,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const tokens = useMemo<Token[]>(() => {
    if (!chainId) return [];
    return mergeTokens(chainId, baseTokens(chainId), customTokens, query.data ?? []);
  }, [chainId, customTokens, query.data]);

  return { tokens, isLoading: query.isLoading, error: query.error as Error | null };
}
