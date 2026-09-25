"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { BURNED, REFERENCE_FEE, WINDOW, poolAbi, priceFrom, quoteFor, swapEvent } from "@/lib/screener";
import { VENUE, factoryAbi } from "@/lib/venue";
import type { Pair } from "./useScreener";

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/** Everything about one pool that never changes once it is deployed. */
type Identity = Pick<Pair, "pool" | "token" | "quoteToken" | "decimals" | "baseIsToken0" | "decimals0" | "decimals1">;

export type TargetStats = {
  marketCap: number | undefined;
  fdv: number | undefined;
  change: number;
  volume: number;
  swaps: number;
  liquidity: number;
};

/**
 * One pool, described completely and on its own — never a figure carried
 * over from whichever list happened to hand the pool over.
 *
 * The target panel used to print whatever the aim arrived with: the live
 * row's own numbers when the pool was still in `useScreener`'s list, and
 * otherwise a snapshot frozen at the moment of aiming — which for a pool
 * `useAimByAddress` had just found meant no market cap at all and a volume
 * and trade count that were never asked for, printed as plain zeroes beside
 * ones that were real. Every target now reads the same four figures the same
 * way, whether it came from the list, the sheet, or a pasted address.
 *
 * The rate is read fresh here rather than trusted from the pair handed in,
 * for the same reason `useScreener` reads it itself: a coin-quoted pool
 * priced against a rate read minutes ago at a different tap is not describing
 * itself at the price it is actually at.
 */
async function read(client: PublicClient, id: Identity): Promise<TargetStats> {
  const head = await client.getBlockNumber();
  const quote = quoteFor(id.quoteToken);

  const [logs, reads, [referencePool]] = await Promise.all([
    client.getLogs({ address: id.pool, event: swapEvent, fromBlock: head - WINDOW, toBlock: head }),
    client.multicall({
      allowFailure: true,
      batchSize: ONE_CALL,
      /*
       * Routed through `flatMap` over a single-item array rather than written
       * as a plain literal — see `useScreener`'s own `details` multicall. A
       * literal array keeps every entry's exact position and type, which is
       * what lets `BURNED`'s narrow, single-address type leak backward onto
       * unrelated entries earlier in the same array; a callback's return type
       * is inferred as one plain union instead, which is all `multicall`
       * needs to type each entry's own result correctly.
       */
      contracts: [id].flatMap(() => [
        { address: id.pool, abi: poolAbi, functionName: "slot0" } as const,
        { address: id.quoteToken, abi: erc20Abi, functionName: "balanceOf", args: [id.pool] } as const,
        { address: id.token, abi: erc20Abi, functionName: "totalSupply" } as const,
        ...BURNED.map(
          (grave) => ({ address: id.token, abi: erc20Abi, functionName: "balanceOf", args: [grave] }) as const,
        ),
      ]),
    }),
    client.multicall({
      allowFailure: true,
      batchSize: ONE_CALL,
      contracts: [
        {
          address: VENUE.factory,
          abi: factoryAbi,
          functionName: "getPool",
          args: [VENUE.wrapped, VENUE.stable, REFERENCE_FEE],
        } as const,
      ],
    }),
  ]);

  const [slot, resting, supply, ...graves] = reads;

  /* A second call, because this pool's own address is not known until the
     first one answers — same two-step `useScreener` and `useActivity` take. */
  const referenceRead =
    referencePool?.status === "success"
      ? await client.multicall({
          allowFailure: true,
          batchSize: ONE_CALL,
          contracts: [
            { address: referencePool.result as `0x${string}`, abi: poolAbi, functionName: "slot0" } as const,
          ],
        })
      : undefined;
  const referenceSlot = referenceRead?.[0];
  const ethUsd =
    referenceSlot?.status === "success"
      ? priceFrom((referenceSlot.result as readonly unknown[])[0] as bigint, 18, 6)
      : undefined;
  const rate = quote?.symbol === "USDG" ? 1 : (ethUsd ?? 0);

  const orient = (sqrtP: bigint) => {
    const oneToZero = priceFrom(sqrtP, id.decimals0, id.decimals1);
    return id.baseIsToken0 ? oneToZero : 1 / oneToZero;
  };

  const sqrt = slot?.status === "success" ? (slot.result as readonly unknown[])[0] : undefined;
  const price = typeof sqrt === "bigint" && sqrt > 0n ? orient(sqrt) * rate : undefined;

  const whole = (value: unknown) => (typeof value === "bigint" ? Number(value) / 10 ** id.decimals : 0);
  const issued = supply?.status === "success" ? whole(supply.result) : undefined;
  const buried = graves.reduce((sum, grave) => sum + (grave?.status === "success" ? whole(grave.result) : 0), 0);

  const quoteDecimals = id.baseIsToken0 ? id.decimals1 : id.decimals0;
  const liquidity =
    resting?.status === "success" && typeof resting.result === "bigint"
      ? (Number(resting.result) / 10 ** quoteDecimals) * rate
      : 0;

  let volumeRaw = 0n;
  let firstPrice: bigint | undefined;
  let lastPrice: bigint | undefined;
  for (const log of logs) {
    const amount0 = log.args.amount0 ?? 0n;
    const amount1 = log.args.amount1 ?? 0n;
    const quoteAmount = id.baseIsToken0 ? amount1 : amount0;
    volumeRaw += quoteAmount < 0n ? -quoteAmount : quoteAmount;
    const swapPrice = log.args.sqrtPriceX96;
    if (swapPrice !== undefined) {
      firstPrice ??= swapPrice;
      lastPrice = swapPrice;
    }
  }

  const change =
    firstPrice !== undefined && lastPrice !== undefined && orient(firstPrice) > 0
      ? (orient(lastPrice) / orient(firstPrice) - 1) * 100
      : 0;

  return {
    marketCap: issued === undefined || price === undefined ? undefined : Math.max(issued - buried, 0) * price,
    fdv: issued === undefined || price === undefined ? undefined : issued * price,
    change,
    volume: (Number(volumeRaw) / 10 ** quoteDecimals) * rate,
    swaps: logs.length,
    liquidity,
  };
}

/** What the target panel shows, read fresh for exactly the pool aimed at. */
export function useTargetDetail(pair: Pair | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const id: Identity | undefined = pair
    ? {
        pool: pair.pool,
        token: pair.token,
        quoteToken: pair.quoteToken,
        decimals: pair.decimals,
        baseIsToken0: pair.baseIsToken0,
        decimals0: pair.decimals0,
        decimals1: pair.decimals1,
      }
    : undefined;

  const query = useQuery({
    queryKey: ["target-detail", id?.pool],
    queryFn: () => read(client as PublicClient, id as Identity),
    enabled: Boolean(client) && Boolean(id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  return { stats: query.data, loading: query.isFetching };
}
