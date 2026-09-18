"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { VENUE, factoryAbi } from "@/lib/venue";
import {
  BURNED,
  CREATED_WINDOW,
  DEPTH,
  REFERENCE_FEE,
  WINDOW,
  poolAbi,
  poolCreatedEvent,
  priceFrom,
  isEquity,
  quoteFor,
  swapEvent,
} from "@/lib/screener";

export type Pair = {
  pool: `0x${string}`;
  token: `0x${string}`;
  symbol: string;
  name: string;
  quote: string;
  fee: number;
  /**
   * Everything the token is worth at the price the pool is quoting: supply that
   * is still reachable, and then supply outright.
   *
   * Undefined when the contract would not say what it has issued. A token that
   * has rugged is worth nothing and reads as zero, and a token that refused the
   * question is not — writing both as zero would make the screen certain about
   * the one thing it had failed to find out.
   */
  marketCap?: number;
  fdv?: number;
  /** Percent, across the window. */
  change: number;
  /** US dollars that changed hands in the window. */
  volume: number;
  swaps: number;
  /** US dollars resting in the pool. */
  liquidity: number;
  /** Minutes since the pool was created, when that is known. */
  age?: number;
  /**
   * What the chart needs to turn one of this pool's swaps into a dollar price:
   * which side the token sits on, the two decimals the pool's own figure is
   * scaled by, and what a quote unit is worth. Carried from the busiest pool,
   * which is the one the fold keeps and the one the chart reads.
   */
  baseIsToken0: boolean;
  decimals0: number;
  decimals1: number;
  usdRate: number;
};

type Tally = {
  swaps: number;
  amount0: bigint;
  amount1: bigint;
  first: bigint;
  last: bigint;
};

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/** Reads per row in the detail call: see the contracts it assembles. */
const READS = 7;

/**
 * Everything trading on this chain, ranked.
 *
 * Four questions, in an order that keeps the expensive ones small. Every swap
 * in the window comes back in one query and is tallied by pool — that alone
 * decides which pairs are worth describing, because a pair nobody traded is not
 * on this screen whatever else is true of it. Only the busiest are then asked
 * about in detail, so the reads that cost per row are spent on rows that will
 * have one.
 *
 * Pool creations are fetched beside the swaps rather than after them. They are
 * cheap, they date the pairs that are new, and for those pairs they answer what
 * would otherwise be a contract read each.
 */
async function read(client: PublicClient): Promise<Pair[]> {
  const head = await client.getBlockNumber();

  const [swaps, created] = await Promise.all([
    client.getLogs({ event: swapEvent, fromBlock: head - WINDOW, toBlock: head }),
    client.getLogs({
      address: VENUE.factory,
      event: poolCreatedEvent,
      fromBlock: head - CREATED_WINDOW,
      toBlock: head,
    }),
  ]);

  const tally = new Map<string, Tally>();
  for (const log of swaps) {
    const key = log.address.toLowerCase();
    const seen = tally.get(key);
    const amount0 = log.args.amount0 ?? 0n;
    const amount1 = log.args.amount1 ?? 0n;
    const price = log.args.sqrtPriceX96 ?? 0n;
    if (seen) {
      seen.swaps++;
      seen.amount0 += amount0 < 0n ? -amount0 : amount0;
      seen.amount1 += amount1 < 0n ? -amount1 : amount1;
      seen.last = price;
    } else {
      tally.set(key, {
        swaps: 1,
        amount0: amount0 < 0n ? -amount0 : amount0,
        amount1: amount1 < 0n ? -amount1 : amount1,
        first: price,
        last: price,
      });
    }
  }

  const born = new Map<string, { block: bigint }>();
  for (const log of created) {
    if (log.args.pool) born.set(log.args.pool.toLowerCase(), { block: log.blockNumber });
  }

  const busiest = [...tally.entries()]
    .sort((a, b) => b[1].swaps - a[1].swaps)
    .slice(0, DEPTH);
  if (busiest.length === 0) return [];

  const pools = busiest.map(([pool]) => pool as `0x${string}`);
  const sides = await client.multicall({
    allowFailure: true,
    batchSize: ONE_CALL,
    contracts: [
      ...pools.flatMap((pool) => [
        { address: pool, abi: poolAbi, functionName: "token0" } as const,
        { address: pool, abi: poolAbi, functionName: "token1" } as const,
        { address: pool, abi: poolAbi, functionName: "fee" } as const,
      ]),
      {
        address: VENUE.factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [VENUE.wrapped, VENUE.stable, REFERENCE_FEE],
      } as const,
    ],
  });

  const referencePool = sides[pools.length * 3];

  /*
   * A pair needs one side this app can price and one it cannot — two quote
   * tokens is the WETH/USDG pool, which is plumbing rather than a launch, and
   * two unknown tokens is a price in units nothing else on the screen shares.
   */
  type Candidate = {
    pool: `0x${string}`;
    token: `0x${string}`;
    quoteToken: `0x${string}`;
    baseIsToken0: boolean;
    fee: number;
    tally: Tally;
    block?: bigint;
  };

  const candidates: Candidate[] = [];
  pools.forEach((pool, index) => {
    const token0 = sides[index * 3];
    const token1 = sides[index * 3 + 1];
    const fee = sides[index * 3 + 2];
    if (token0?.status !== "success" || token1?.status !== "success") return;
    if (fee?.status !== "success") return;

    const a = token0.result as `0x${string}`;
    const b = token1.result as `0x${string}`;
    const aIsQuote = Boolean(quoteFor(a));
    const bIsQuote = Boolean(quoteFor(b));
    if (aIsQuote === bIsQuote) return;

    candidates.push({
      pool,
      token: aIsQuote ? b : a,
      quoteToken: aIsQuote ? a : b,
      baseIsToken0: !aIsQuote,
      fee: Number(fee.result),
      tally: tally.get(pool)!,
      block: born.get(pool)?.block,
    });
  });
  if (candidates.length === 0) return [];

  const detailOffset = referencePool?.status === "success" ? 1 : 0;
  const details = await client.multicall({
    allowFailure: true,
    batchSize: ONE_CALL,
    contracts: [
      ...(referencePool?.status === "success"
        ? [
            {
              address: referencePool.result as `0x${string}`,
              abi: poolAbi,
              functionName: "slot0",
            } as const,
          ]
        : []),
      ...candidates.flatMap((entry) => [
        { address: entry.token, abi: erc20Abi, functionName: "symbol" } as const,
        { address: entry.token, abi: erc20Abi, functionName: "decimals" } as const,
        { address: entry.token, abi: erc20Abi, functionName: "name" } as const,
        {
          address: entry.quoteToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [entry.pool],
        } as const,
        { address: entry.token, abi: erc20Abi, functionName: "totalSupply" } as const,
        ...BURNED.map(
          (grave) =>
            ({
              address: entry.token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [grave],
            }) as const,
        ),
      ]),
    ],
  });

  /*
   * What a WETH figure is worth beside a USDG one.
   *
   * Without it the two cannot be added or ranked against each other, and the
   * first version of this screen did both — folding a token's USDG volume into
   * its WETH volume and printing the sum under a WETH label, which turned forty
   * WETH into twelve thousand. Everything below is dollars from here on.
   */
  const priced = detailOffset > 0 ? details[0] : undefined;
  const ethUsd =
    priced?.status === "success" && Array.isArray(priced.result)
      ? priceFrom(priced.result[0] as bigint, 18, 6)
      : undefined;
  const inUsd = (symbol: string) => (symbol === "USDG" ? 1 : (ethUsd ?? 0));

  const rows = candidates.map((entry, index) => {
    const at = detailOffset + index * READS;
    const symbol = details[at];
    const decimals = details[at + 1];
    const named = details[at + 2];
    const resting = details[at + 3];
    const supply = details[at + 4];
    const graves = [details[at + 5], details[at + 6]];
    const quote = quoteFor(entry.quoteToken)!;
    const baseDecimals =
      decimals?.status === "success" ? Number(decimals.result) : 18;

    const decimals0 = entry.baseIsToken0 ? baseDecimals : quote.decimals;
    const decimals1 = entry.baseIsToken0 ? quote.decimals : baseDecimals;
    const orient = (sqrt: bigint) => {
      const oneToZero = priceFrom(sqrt, decimals0, decimals1);
      return entry.baseIsToken0 ? oneToZero : 1 / oneToZero;
    };

    const rate = inUsd(quote.symbol);
    const price = orient(entry.tally.last) * rate;
    const opened = orient(entry.tally.first) * rate;

    const whole = (value: unknown) =>
      typeof value === "bigint" ? Number(value) / 10 ** baseDecimals : 0;
    const issued = supply?.status === "success" ? whole(supply.result) : undefined;
    const buried = graves.reduce(
      (sum, grave) => sum + (grave?.status === "success" ? whole(grave.result) : 0),
      0,
    );
    const volumeRaw = entry.baseIsToken0 ? entry.tally.amount1 : entry.tally.amount0;

    return {
      pool: entry.pool,
      token: entry.token,
      name: named?.status === "success" && typeof named.result === "string" ? named.result : "",
      symbol:
        symbol?.status === "success" && typeof symbol.result === "string"
          ? symbol.result
          : "—",
      quote: quote.symbol,
      fee: entry.fee,
      marketCap: issued === undefined ? undefined : Math.max(issued - buried, 0) * price,
      fdv: issued === undefined ? undefined : issued * price,
      change: opened > 0 ? (price / opened - 1) * 100 : 0,
      volume: (Number(volumeRaw) / 10 ** quote.decimals) * rate,
      swaps: entry.tally.swaps,
      liquidity:
        resting?.status === "success" && typeof resting.result === "bigint"
          ? (Number(resting.result) / 10 ** quote.decimals) * rate
          : 0,
      age: entry.block === undefined ? undefined : Number(head - entry.block) / 600,
      baseIsToken0: entry.baseIsToken0,
      decimals0,
      decimals1,
      usdRate: rate,
    } satisfies Pair;
  });

  return fold(rows.filter((row) => !isEquity(row.name)));
}

/**
 * One row per token, not one per pool.
 *
 * A token opens a pool at every fee tier its launcher felt like, and against
 * whichever quote it liked, and the list was printing each of them: NVDA three
 * times, SPY twice, the same price beside itself. What the reader is looking
 * for is the token, so the pools are folded into it — volume and trades add up
 * across all of them, because that is what the token traded, and the price, the
 * move and the depth come from the busiest pool, because that is the one a
 * trade would actually go through.
 *
 * The adding only works because everything reaching here is already in dollars.
 * Folded in quote units it was nonsense: a token's USDG volume landed on top of
 * its WETH volume under a WETH label.
 */
function fold(rows: Pair[]): Pair[] {
  const byToken = new Map<string, Pair>();
  for (const row of rows) {
    const key = row.token.toLowerCase();
    const held = byToken.get(key);
    if (!held) {
      byToken.set(key, { ...row });
      continue;
    }
    const busiest = row.swaps > held.swaps ? row : held;
    byToken.set(key, {
      ...busiest,
      volume: held.volume + row.volume,
      swaps: held.swaps + row.swaps,
      age: Math.min(held.age ?? Infinity, row.age ?? Infinity) === Infinity
        ? undefined
        : Math.min(held.age ?? Infinity, row.age ?? Infinity),
    });
  }
  return [...byToken.values()];
}

export function useScreener() {
  const client = usePublicClient({ chainId: CHAIN_ID });

  const query = useQuery({
    queryKey: ["screener"],
    queryFn: () => read(client as PublicClient),
    enabled: Boolean(client),
    // The window is five minutes; refetching faster than this only re-reads it.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    pairs: query.data ?? [],
    loading: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}
