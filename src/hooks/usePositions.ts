"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePublicClient } from "wagmi";
import {
  buildPositions,
  pricePosition,
  type PricedPosition,
} from "@/lib/positions";
import { midPrice } from "@/lib/quote";
import { useAppStore } from "@/store/useAppStore";

/** Pricing is one pool read per position, so the open list stays bounded. */
const MAX_PRICED = 12;

/**
 * Positions rebuilt from the local trade log, priced against the pool they were
 * funded through. Realised results stand on their own; unrealised ones only
 * appear while a route still exists.
 */
export function usePositions(chainId: number | undefined, intervalMs = 45_000) {
  const trades = useAppStore((state) => state.trades);
  const client = usePublicClient({ chainId });

  const positions = useMemo(
    () => (chainId ? buildPositions(trades, chainId) : []),
    [trades, chainId],
  );

  const openKeys = useMemo(
    () =>
      positions
        .filter((position) => position.size > 0)
        .slice(0, MAX_PRICED)
        .map((position) => position.key),
    [positions],
  );

  const prices = useQuery<Record<string, number>>({
    queryKey: ["position-prices", chainId, openKeys.join(",")],
    enabled: Boolean(client && chainId && openKeys.length > 0),
    refetchInterval: intervalMs,
    staleTime: intervalMs / 2,
    queryFn: async () => {
      if (!client) return {};
      const wanted = new Set(openKeys);
      const entries = await Promise.all(
        positions
          .filter((position) => wanted.has(position.key))
          .map(async (position) => {
            try {
              const mid = await midPrice(client, position.base, position.cash);
              return mid ? ([position.key, mid.price] as const) : undefined;
            } catch {
              return undefined;
            }
          }),
      );
      return Object.fromEntries(entries.filter((entry) => entry !== undefined));
    },
  });

  const priced = useMemo<PricedPosition[]>(
    () => positions.map((position) => pricePosition(position, prices.data?.[position.key])),
    [positions, prices.data],
  );

  /**
   * Results are grouped by the asset they were funded in. A position bought with
   * ETH and one bought with USDC do not add up, so they are never added up.
   */
  const totals = useMemo(() => {
    const byCash = new Map<string, { symbol: string; realised: number; unrealised: number }>();
    let open = 0;
    for (const position of priced) {
      const symbol = position.cash.symbol;
      const row = byCash.get(symbol) ?? { symbol, realised: 0, unrealised: 0 };
      row.realised += position.realised;
      row.unrealised += position.unrealised ?? 0;
      byCash.set(symbol, row);
      if (position.size > 0) open += 1;
    }
    return { byCash: [...byCash.values()], open };
  }, [priced]);

  return {
    positions: priced,
    totals,
    isFetching: prices.isFetching,
    refetch: prices.refetch,
  };
}
