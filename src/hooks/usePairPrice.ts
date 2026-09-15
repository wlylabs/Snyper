"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { usePublicClient } from "wagmi";
import { midPrice } from "@/lib/quote";
import type { Token } from "@/lib/tokens";
import type { PricePoint } from "@/lib/types";
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
    // A missing pool is a result, not a failure: react-query rejects an
    // `undefined` payload, which would surface its own internal error instead.
    queryFn: async () => {
      if (!client || !base || !quote) return null;
      return (await midPrice(client, base, quote)) ?? null;
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
    venue: query.data?.venue,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
  };
}

/**
 * Shared empty result. The selector runs on every snapshot check, so returning a
 * fresh `[]` for an untracked pair would hand React a new reference each time and
 * spin `useSyncExternalStore` into an endless re-render.
 */
const NO_POINTS: PricePoint[] = [];

export function usePairSeries(base?: Token, quote?: Token): PricePoint[] {
  const key = base && quote ? seriesKey(base.chainId, base, quote) : undefined;
  return useAppStore((state) => (key ? (state.series[key] ?? NO_POINTS) : NO_POINTS));
}
