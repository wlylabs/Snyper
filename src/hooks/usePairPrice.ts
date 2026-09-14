"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { usePublicClient } from "wagmi";
import { midPrice } from "@/lib/quote";
import type { Token } from "@/lib/tokens";
import { seriesKey, useAppStore } from "@/store/useAppStore";

/**
 * Live pool mid price for a pair. Every reading is appended to the local tick
 * series, which is the only price history the app ever shows.
 */
export function usePairPrice(base?: Token, quote?: Token, intervalMs = 15_000) {
  const client = usePublicClient({ chainId: base?.chainId });
  const recordPrice = useAppStore((state) => state.recordPrice);

  const query = useQuery({
    queryKey: ["mid-price", base?.chainId, base?.address, quote?.address],
    enabled: Boolean(client && base && quote),
    refetchInterval: intervalMs,
    staleTime: intervalMs / 2,
    queryFn: async () => {
      if (!client || !base || !quote) return undefined;
      return midPrice(client, base, quote);
    },
  });

  const price = query.data?.price;

  useEffect(() => {
    if (!base || !quote || price === undefined) return;
    recordPrice(seriesKey(base.chainId, base, quote), { t: Date.now(), p: price });
  }, [base, quote, price, recordPrice]);

  return {
    price,
    pool: query.data?.pool,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
  };
}

export function usePairSeries(base?: Token, quote?: Token) {
  return useAppStore((state) =>
    base && quote ? (state.series[seriesKey(base.chainId, base, quote)] ?? []) : [],
  );
}
