"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type GetLogsReturnType, type PublicClient } from "viem";
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
  /**
   * The other side of the pool, by address rather than by name.
   *
   * The terminal needs it: whether a buy is one hop from the coin or two is
   * decided by which token this is, and a symbol cannot be packed into a path.
   */
  quoteToken: `0x${string}`;
  decimals: number;
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

/**
 * A pool that exists, described by nothing more than the event that made it.
 *
 * The screen already reads a day of `PoolCreated` to date the pairs that are
 * new, and then throws away every launch that did not also trade in the last
 * five minutes — on a normal day that is four hundred of them against eight
 * kept. Nothing about that was a deliberate limit; the rows simply had nowhere
 * to go. This is the shape they go into, and it costs no request at all,
 * because the event carries both sides, the tier and the block it happened in.
 *
 * Pricing one is a separate question and a separate hook: a pool nobody has
 * traded has no swap to read a price from, so it has to be asked, and it is
 * only asked when a reader opens the list.
 */
export type Birth = {
  pool: `0x${string}`;
  token: `0x${string}`;
  quoteToken: `0x${string}`;
  baseIsToken0: boolean;
  fee: number;
  block: bigint;
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

/** One swap, with its arguments decoded — what `getLogs` hands back. */
type SwapLog = GetLogsReturnType<typeof swapEvent>[number];

/** How many times the window may be halved before the refusal stands. */
const SPLITS = 4;

/**
 * Whether the endpoint refused a query for its size rather than for its shape.
 *
 * There is no code to test — chain 4663 answers with -32000, which is the
 * generic server error every other refusal also uses — so the message is what
 * distinguishes them. It reads `logs matched by query exceeds limit of 10000`,
 * and the two words worth matching on are the ones every endpoint that has this
 * limit writes in some form.
 */
function tooManyLogs(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\blogs?\b/i.test(message) && /\b(exceeds?|limit|too many)\b/i.test(message);
}

/**
 * Every swap in a span, however many requests that takes.
 *
 * The window is five minutes because that is the market the screen is
 * describing, and it stays five minutes whatever the chain is doing. What
 * changes with activity is how many requests it costs: a quiet chain answers
 * the whole span at once, and a busy one refuses it for size, at which point
 * the span is cut in half and each half asked for separately — down to sixteen
 * pieces, which is as far as this is worth taking before the refusal is real.
 *
 * Narrowing the window instead would have been one line and a lie. The screen
 * says five minutes beside every figure it prints, and a screen that quietly
 * reports ninety seconds under that label is worse than one that says the read
 * failed. The halves come back in order and are concatenated in order, which is
 * what the tally below depends on to know a pair's first price from its last.
 */
async function swapsIn(
  client: PublicClient,
  from: bigint,
  to: bigint,
  depth = 0,
): Promise<SwapLog[]> {
  try {
    return await client.getLogs({ event: swapEvent, fromBlock: from, toBlock: to });
  } catch (error) {
    if (depth >= SPLITS || to - from < 2n || !tooManyLogs(error)) throw error;
    const middle = from + (to - from) / 2n;
    const [older, newer] = await Promise.all([
      swapsIn(client, from, middle, depth + 1),
      swapsIn(client, middle + 1n, to, depth + 1),
    ]);
    return [...older, ...newer];
  }
}

/**
 * Everything trading on this chain, ranked.
 *
 * Four questions, in an order that keeps the expensive ones small. Every swap
 * in the window comes back first — in one query when the chain is quiet enough
 * to answer it in one, and see `swapsIn` for when it is not — and is tallied by
 * pool, which alone decides which pairs are worth describing: a pair nobody
 * traded is not on this screen whatever else is true of it. Only the busiest
 * are then asked about in detail, so the reads that cost per row are spent on
 * rows that will have one.
 *
 * Pool creations are fetched beside the swaps rather than after them. They are
 * cheap, they date the pairs that are new, and for those pairs they answer what
 * would otherwise be a contract read each.
 */
async function read(
  client: PublicClient,
): Promise<{ pairs: Pair[]; births: Birth[]; head: bigint }> {
  const head = await client.getBlockNumber();

  const [swaps, created] = await Promise.all([
    swapsIn(client, head - WINDOW, head),
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

  /*
   * Newest first, and only pairs with one side this app can price — the same
   * test the traded list applies, for the same reason: two quote tokens is
   * plumbing rather than a launch, and two unknown ones is a price in units
   * nothing else on the screen shares.
   */
  const births: Birth[] = [];
  for (let index = created.length - 1; index >= 0; index--) {
    const log = created[index];
    const { token0, token1, fee, pool } = log.args;
    if (!token0 || !token1 || fee === undefined || !pool) continue;
    const zeroIsQuote = Boolean(quoteFor(token0));
    if (zeroIsQuote === Boolean(quoteFor(token1))) continue;
    births.push({
      pool,
      token: zeroIsQuote ? token1 : token0,
      quoteToken: zeroIsQuote ? token0 : token1,
      baseIsToken0: !zeroIsQuote,
      fee: Number(fee),
      block: log.blockNumber,
    });
  }

  const busiest = [...tally.entries()]
    .sort((a, b) => b[1].swaps - a[1].swaps)
    .slice(0, DEPTH);
  if (busiest.length === 0) return { pairs: [], births, head };

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
  if (candidates.length === 0) return { pairs: [], births, head };

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
      quoteToken: entry.quoteToken,
      decimals: baseDecimals,
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

  return { pairs: fold(rows.filter((row) => !isEquity(row.name))), births, head };
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
    pairs: query.data?.pairs ?? [],
    /** Every pool opened in the last day, unpriced. See `Birth`. */
    births: query.data?.births ?? [],
    head: query.data?.head,
    loading: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}
