"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { readLock } from "@/lib/lock";

/**
 * The lock under a pair, read only once a reader has opened it.
 *
 * This is the most expensive question the app asks about a single pair — a log
 * query, a receipt per funding transaction, and two multicalls — so it is not
 * asked for a list. Forty rows would be several hundred calls against an
 * endpoint that already rate limits the market scan, and a badge nobody has
 * looked at yet is not worth a refusal on the screen behind it.
 *
 * Positions do not move often and a wrong answer here is worse than a late one,
 * so it is cached for a minute and never refetched behind a reader's back.
 */
export function useLiquidityLock(pool: `0x${string}` | undefined, enabled = true) {
  const client = usePublicClient({ chainId: CHAIN_ID });

  const query = useQuery({
    queryKey: ["lock", pool],
    queryFn: () => readLock(client as PublicClient, pool as `0x${string}`),
    enabled: Boolean(client && pool && enabled),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return {
    lock: query.data,
    loading: query.isPending && Boolean(pool) && enabled,
    failed: query.isError,
  };
}
