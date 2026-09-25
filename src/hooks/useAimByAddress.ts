"use client";

import { useMemo } from "react";
import { erc20Abi, zeroAddress } from "viem";
import { useReadContracts } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { poolAbi, priceFrom, quoteFor } from "@/lib/screener";
import { EXITS, FEE_TIERS, VENUE, factoryAbi } from "@/lib/venue";
import { useCoinUsd } from "./useCoinUsd";
import type { Pair } from "./useScreener";

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/** Reads per surviving pool in the second pass. */
const READS = 5;

/**
 * Every quote token this venue trades against, at every fee tier it offers —
 * the whole space a pasted token's pool could be sitting in, with nothing
 * else known about it yet.
 */
const SLOTS = EXITS.flatMap((exit) => FEE_TIERS.map((fee) => ({ exit, fee })));

/**
 * A pasted contract address, turned into whichever pool of it actually trades
 * and everything the terminal needs to quote it — the same shape `useScreener`
 * hands over, built from nothing but the address itself.
 *
 * Two passes, because the first only has an address and has to ask the factory
 * whether a pool exists at all: eight questions, one per quote token and fee
 * tier this venue offers. Whichever come back non-zero are real pools, and
 * only those are asked the rest — a token traded at one tier does not justify
 * pricing three others that were never deployed. Where more than one pool is
 * real, the deepest one wins, on the same reasoning `useLaunches` used: a pool
 * with four dollars in it is not an entry at any price.
 */
export function useAimByAddress(address: `0x${string}` | undefined) {
  const coinUsd = useCoinUsd();

  const pools = useReadContracts({
    contracts: SLOTS.map(
      ({ exit, fee }) =>
        ({
          address: VENUE.factory,
          abi: factoryAbi,
          functionName: "getPool",
          args: [address ?? zeroAddress, exit.address, fee],
          chainId: CHAIN_ID,
        }) as const,
    ),
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: Boolean(address) },
  });

  const found = useMemo(() => {
    if (!address || !pools.data) return [];
    return SLOTS.map((slot, index) => {
      const outcome = pools.data?.[index];
      const pool = outcome?.status === "success" ? (outcome.result as `0x${string}`) : undefined;
      return pool && pool !== zeroAddress ? { ...slot, pool } : undefined;
    }).filter(
      (entry): entry is { exit: (typeof EXITS)[number]; fee: (typeof FEE_TIERS)[number]; pool: `0x${string}` } =>
        Boolean(entry),
    );
  }, [address, pools.data]);

  const contracts = useMemo(
    () =>
      found.flatMap(({ pool, exit }) => [
        { address: pool, abi: poolAbi, functionName: "slot0", chainId: CHAIN_ID } as const,
        {
          address: exit.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [pool],
          chainId: CHAIN_ID,
        } as const,
        { address: address as `0x${string}`, abi: erc20Abi, functionName: "symbol", chainId: CHAIN_ID } as const,
        { address: address as `0x${string}`, abi: erc20Abi, functionName: "decimals", chainId: CHAIN_ID } as const,
        { address: address as `0x${string}`, abi: erc20Abi, functionName: "name", chainId: CHAIN_ID } as const,
      ]),
    [found, address],
  );

  const read = useReadContracts({
    contracts,
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: contracts.length > 0 },
  });

  const pair = useMemo((): Pair | undefined => {
    if (!address || !read.data) return undefined;

    const candidates = found
      .map(({ pool, exit, fee }, index) => {
        const at = index * READS;
        const slot = read.data?.[at];
        const depth = read.data?.[at + 1];
        const symbol = read.data?.[at + 2];
        const decimals = read.data?.[at + 3];
        const named = read.data?.[at + 4];

        if (slot?.status !== "success" || depth?.status !== "success") return undefined;
        const sqrt = (slot.result as readonly unknown[])[0];
        if (typeof sqrt !== "bigint" || sqrt === 0n) return undefined;
        if (typeof depth.result !== "bigint" || depth.result === 0n) return undefined;

        const quote = quoteFor(exit.address);
        if (!quote) return undefined;
        const rate = quote.symbol === "USDG" ? 1 : coinUsd;
        if (rate === undefined) return undefined;

        const baseDecimals = decimals?.status === "success" ? Number(decimals.result) : 18;
        const baseIsToken0 = BigInt(address) < BigInt(exit.address);
        const decimals0 = baseIsToken0 ? baseDecimals : quote.decimals;
        const decimals1 = baseIsToken0 ? quote.decimals : baseDecimals;
        const oneToZero = priceFrom(sqrt, decimals0, decimals1);
        const price = (baseIsToken0 ? oneToZero : 1 / oneToZero) * rate;
        if (!Number.isFinite(price) || price <= 0) return undefined;

        const liquidity = (Number(depth.result) / 10 ** quote.decimals) * rate;

        const built: Pair = {
          pool,
          token: address,
          name: named?.status === "success" && typeof named.result === "string" ? named.result : "",
          symbol: symbol?.status === "success" && typeof symbol.result === "string" ? symbol.result : "—",
          quote: quote.symbol,
          quoteToken: exit.address,
          decimals: baseDecimals,
          fee,
          /* Nothing traded through this pool has been read, so nothing is
             claimed about it — see the same choice in `useLaunches`. */
          change: 0,
          volume: 0,
          swaps: 0,
          liquidity,
          baseIsToken0,
          decimals0,
          decimals1,
          usdRate: rate,
        };
        return { liquidity, pair: built };
      })
      .filter((entry): entry is { liquidity: number; pair: Pair } => Boolean(entry));

    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => b.liquidity - a.liquidity)[0].pair;
  }, [address, found, read.data, coinUsd]);

  const settled = pools.isFetched && (found.length === 0 || read.isFetched);

  return {
    pair,
    resolving: pools.isFetching || (found.length > 0 && read.isFetching),
    /** True once every pool this venue could hold the token in has been read
     *  and none of them turned into a price — no pool, or a pool nobody has
     *  put anything into yet. */
    notFound: Boolean(address) && settled && !pair,
  };
}
