"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { REFERENCE_FEE, poolAbi, priceFrom } from "@/lib/screener";
import { VENUE, factoryAbi } from "@/lib/venue";

/** What the factory returns for a pair it has never deployed. */
const NOWHERE = "0x0000000000000000000000000000000000000000";

/**
 * What the coin is worth in dollars, read off the pool the chain prices it in.
 *
 * A stake is chosen in dollars because that is the unit a reader holds a
 * position in — nobody decides to risk 0.034 of a coin — and the chain only
 * accepts the coin, so something has to stand between the two. This is that:
 * the WETH/USDG pool at the reference tier, which is the deepest thing on chain
 * 4663 and the same pool the memecoin screen already prices every pair against.
 *
 * Read rather than fetched. An exchange rate from a price API is a third party
 * in the middle of a trade that otherwise has none, and it would disagree with
 * the pool the trade actually goes through — which for the two-hop buys is the
 * very pool being quoted here.
 *
 * Which side the coin sits on is asked rather than assumed. Uniswap orders a
 * pool's tokens by address and nothing stops a future deployment from ordering
 * them the other way, at which point a hardcoded orientation would return the
 * price upside down and every dollar stake with it.
 */
export function useCoinUsd(): number | undefined {
  const pool = useReadContract({
    address: VENUE.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [VENUE.wrapped, VENUE.stable, REFERENCE_FEE],
    chainId: CHAIN_ID,
    // A v3 factory cannot redeploy a pool, so this answer never changes.
    query: { staleTime: Infinity, gcTime: Infinity },
  });

  const found =
    typeof pool.data === "string" && pool.data !== NOWHERE
      ? (pool.data as `0x${string}`)
      : undefined;

  const reads = useReadContracts({
    contracts: found
      ? [
          { address: found, abi: poolAbi, functionName: "slot0", chainId: CHAIN_ID } as const,
          { address: found, abi: poolAbi, functionName: "token0", chainId: CHAIN_ID } as const,
        ]
      : [],
    allowFailure: true,
    batchSize: 0,
    query: { enabled: Boolean(found), staleTime: 30_000, refetchInterval: 60_000 },
  });

  return useMemo(() => {
    const slot = reads.data?.[0];
    const first = reads.data?.[1];
    if (slot?.status !== "success" || first?.status !== "success") return undefined;

    const sqrt = (slot.result as readonly unknown[])[0];
    if (typeof sqrt !== "bigint") return undefined;

    const coinIsFirst = String(first.result).toLowerCase() === VENUE.wrapped.toLowerCase();
    const oneToZero = priceFrom(sqrt, coinIsFirst ? 18 : 6, coinIsFirst ? 6 : 18);
    const rate = coinIsFirst ? oneToZero : 1 / oneToZero;
    return Number.isFinite(rate) && rate > 0 ? rate : undefined;
  }, [reads.data]);
}
