import type { PublicClient } from "viem";
import { getAddress, parseAbiItem, zeroAddress } from "viem";
import { erc20Abi, v3FactoryAbi, v3PoolAbi } from "./abi";
import { scanBack } from "./logscan";
import { rateFromSqrtPrice } from "./quote";
import type { Venue } from "./venue";

/**
 * What trades on this chain, asked of the chain.
 *
 * The question a reader opening an empty picker is really asking is "what is
 * there", and until now it was put to DexScreener — an indexer whose slug for
 * chain 4663 was never confirmed, and which the whole picker goes dark without.
 * The factory can answer it instead: every pool it ever opened is an event it
 * emitted, and what stands in that pool is a balance anyone can read.
 *
 * Measured against the chain on 2026-09-18, over the 11.6 days that one scan
 * reaches: 5,754 pools opened, about 497 a day. Of the 3,403 quoted against
 * wrapped native, 2,737 — eighty percent — held nothing or dust, and 88 held a
 * tenth of a coin or more. Ten pools held 83% of all the depth there was.
 *
 * So depth is not one column among several here, it is the whole filter. It is
 * also, deliberately, the only one: a pool's depth is a balance, and 3,403 of
 * them read back in one pass with nothing failing. Volume would be the better
 * ranking — depth is a standing offer a launch can mint itself, volume is the
 * part somebody had to pay for — but it cannot be had from this endpoint. Swap
 * logs for a single hour across the whole chain exceed its ten thousand result
 * cap, and narrowing to sixty pools still times the query out. Ranking by what
 * can be read honestly beats ranking by what would have to be invented.
 */

const POOL_CREATED = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);

/**
 * Blocks one index covers. At a hundred milliseconds a block this is about
 * eleven days, which carried 4,620 pools against a fundable asset when it was
 * measured — including every one of the ten deepest on the chain. Reaching
 * further was tried and is not free: thirty million blocks found 14,157 pools
 * and spent three and a half minutes on them.
 */
const WINDOW_BLOCKS = 10_000_000n;

/**
 * Log budget. The endpoint caps one `eth_getLogs` at ten thousand results and
 * times out on ranges it finds too wide; five million blocks carried about
 * three thousand pools when this was measured, which leaves room under both.
 */
const SCAN_BUDGET = {
  maxRequests: 10,
  maxChunk: 5_000_000n,
  minChunk: 250_000n,
} as const;

/**
 * Calls per multicall. Two hundred answered all 4,620 pools in under three
 * seconds; a hundred left a hundred of them failing on transient errors, and
 * three hundred failed every call in the batch outright.
 */
const CALL_CHUNK = 200;

/** Pools carried into the priced pass, and rows handed back. */
const MAX_PRICED = 150;

export type IndexedMarket = {
  address: `0x${string}`;
  /** The deepest pool this token trades in, and the one every figure is from. */
  pool: `0x${string}`;
  fee: number;
  /** Asset the pool is quoted against: wrapped native or the chain's dollar. */
  quote: `0x${string}`;
  /** Quote units standing in the pool, as a decimal string so JSON carries it. */
  depth: string;
  depthDecimals: number;
  /** Depth in dollars, where the quote asset could be valued. */
  depthUsd?: number;
  /** One token in quote units. */
  price?: number;
  priceUsd?: number;
  decimals?: number;
  /** Block the pool was opened in. */
  createdBlock: string;
};

type PoolRow = {
  pool: `0x${string}`;
  token: `0x${string}`;
  quote: `0x${string}`;
  fee: number;
  block: bigint;
};

/** Every pool the factory has opened against one of the chain's own assets. */
async function collectPools(
  client: PublicClient,
  venue: Venue,
  head: bigint,
): Promise<{ pools: PoolRow[]; partial: boolean }> {
  const quotes = new Set(
    [venue.wrapped, venue.stable].filter(Boolean).map((a) => (a as string).toLowerCase()),
  );
  const pools = new Map<string, PoolRow>();

  const { partial } = await scanBack(
    head,
    WINDOW_BLOCKS,
    async (range) => {
      const logs = await client.getLogs({
        address: venue.factory,
        event: POOL_CREATED,
        ...range,
      });
      for (const log of logs) {
        const { token0, token1, fee, pool } = log.args;
        if (!token0 || !token1 || !pool || fee === undefined) continue;
        const zero = token0.toLowerCase();
        const one = token1.toLowerCase();
        // One side has to be an asset the app can fund a trade with; a pool
        // between two unknown tokens is not a market anyone here can enter.
        if (!quotes.has(zero) && !quotes.has(one)) continue;
        /*
         * Which side is the quote, when both are. The chain's own dollar and
         * its wrapped native are pooled against each other, and that pool is
         * the only thing on the chain that can say what the coin is worth — so
         * it has to read as the coin priced in dollars, never the reverse. Read
         * the other way it is still a valid row, and every depth figure in the
         * index silently loses its dollar value.
         */
        const stable = venue.stable?.toLowerCase();
        const quoteIsZero =
          quotes.has(zero) && quotes.has(one)
            ? zero === stable
            : quotes.has(zero);
        pools.set(pool.toLowerCase(), {
          pool: getAddress(pool),
          token: getAddress(quoteIsZero ? token1 : token0),
          quote: getAddress(quoteIsZero ? token0 : token1),
          fee: Number(fee),
          block: log.blockNumber ?? 0n,
        });
      }
    },
    SCAN_BUDGET,
  );

  return { pools: [...pools.values()], partial };
}

type Call = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

type Answer = { ok: true; value: unknown } | { ok: false };

/**
 * A multicall split into batches the endpoint will actually answer, with one
 * retry for whatever came back failed.
 *
 * The retry is the point. A read that fails here is not a pool holding nothing,
 * it is a pool nobody asked successfully — and a first pass that quietly turned
 * the second into the first is exactly how this shipped an index reporting
 * every one of 14,157 pools as empty. Failures are counted and handed back so
 * a caller can tell a quiet chain from a broken read.
 */
async function chunkedMulticall(
  client: PublicClient,
  calls: readonly Call[],
): Promise<{ answers: Answer[]; failed: number }> {
  const answers: Answer[] = calls.map(() => ({ ok: false }));

  const pass = async (indices: readonly number[], size: number): Promise<number[]> => {
    const stillFailed: number[] = [];
    for (let at = 0; at < indices.length; at += size) {
      const slice = indices.slice(at, at + size);
      let reads: readonly { status: string; result?: unknown }[] = [];
      try {
        reads = (await client.multicall({
          allowFailure: true,
          contracts: slice.map((index) => calls[index]) as never,
        })) as never;
      } catch {
        stillFailed.push(...slice);
        continue;
      }
      slice.forEach((index, offset) => {
        const entry = reads[offset];
        if (entry?.status === "success") answers[index] = { ok: true, value: entry.result };
        else stillFailed.push(index);
      });
    }
    return stillFailed;
  };

  const first = await pass(
    calls.map((_, index) => index),
    CALL_CHUNK,
  );
  // Half the batch on the way back: the failures seen on this chain were
  // transient rather than structural, and a smaller ask is what clears both.
  const second = first.length > 0 ? await pass(first, Math.ceil(CALL_CHUNK / 4)) : [];

  return { answers, failed: second.length };
}

/** What each pool actually holds of the asset it is quoted against. */
async function readDepth(
  client: PublicClient,
  pools: readonly PoolRow[],
): Promise<{ depth: Map<string, bigint>; unread: number }> {
  const { answers, failed } = await chunkedMulticall(
    client,
    pools.map((row) => ({
      address: row.quote,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [row.pool],
    })),
  );

  const depth = new Map<string, bigint>();
  answers.forEach((answer, index) => {
    if (!answer.ok) return;
    const value = answer.value as bigint;
    if (value > 0n) depth.set(pools[index].pool.toLowerCase(), value);
  });

  return { depth, unread: failed };
}

/** Decimals of the quote assets, which every depth figure is scaled by. */
function quoteDecimals(venue: Venue, quote: `0x${string}`): number {
  return quote.toLowerCase() === venue.stable?.toLowerCase()
    ? (venue.stableDecimals ?? 6)
    : 18;
}

/**
 * The chain's coin in dollars, read off the pool that pairs it with the chain's
 * own dollar. Without it every pool quoted in the coin — three of every four on
 * this chain — is ranked against dollar pools as though a coin were a dollar,
 * which buries the deepest markets on the chain beneath the shallowest.
 *
 * The pool is resolved from the factory rather than looked for in the scan.
 * That pool was opened when the chain was young and sits tens of millions of
 * blocks behind any window worth scanning, so a scan is exactly the wrong place
 * to go looking for it: it would be absent, every coin pool would silently lose
 * its value, and the index would still look plausible.
 */
async function nativeUsd(
  client: PublicClient,
  venue: Venue,
): Promise<number | undefined> {
  if (!venue.stable) return undefined;

  const { answers } = await chunkedMulticall(
    client,
    venue.feeTiers.map((fee) => ({
      address: venue.factory,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [venue.wrapped, venue.stable as `0x${string}`, fee],
    })),
  );

  const candidates: PoolRow[] = [];
  answers.forEach((answer, index) => {
    if (!answer.ok) return;
    const pool = answer.value as `0x${string}`;
    if (!pool || pool === zeroAddress) return;
    candidates.push({
      pool: getAddress(pool),
      token: venue.wrapped,
      quote: venue.stable as `0x${string}`,
      fee: venue.feeTiers[index],
      block: 0n,
    });
  });
  if (candidates.length === 0) return undefined;

  const { depth } = await readDepth(client, candidates);
  const deepest = candidates
    .filter((row) => (depth.get(row.pool.toLowerCase()) ?? 0n) > 0n)
    .sort((a, b) => {
      const left = depth.get(a.pool.toLowerCase()) ?? 0n;
      const right = depth.get(b.pool.toLowerCase()) ?? 0n;
      return right > left ? 1 : right < left ? -1 : 0;
    })[0];
  if (!deepest) return undefined;

  const priced = await pricePools(client, [deepest], venue, 18);
  return priced.get(deepest.pool.toLowerCase());
}

/**
 * Prices a set of pools from their own state, as quote units per token. This is
 * a mid price rather than a quote for any size — it is what the picker sorts
 * and labels by, and every trade is still priced by `quote.ts` before it is
 * signed.
 */
async function pricePools(
  client: PublicClient,
  pools: readonly PoolRow[],
  venue: Venue,
  fixedDecimals?: number,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (pools.length === 0) return prices;

  const stride = fixedDecimals === undefined ? 3 : 2;
  const { answers } = await chunkedMulticall(
    client,
    pools.flatMap((row) => [
      { address: row.pool, abi: v3PoolAbi, functionName: "slot0" },
      { address: row.pool, abi: v3PoolAbi, functionName: "token0" },
      ...(fixedDecimals === undefined
        ? [{ address: row.token, abi: erc20Abi, functionName: "decimals" }]
        : []),
    ]),
  );

  pools.forEach((row, index) => {
    const slot0 = answers[index * stride];
    const token0 = answers[index * stride + 1];
    if (!slot0?.ok || !token0?.ok) return;

    let decimals = fixedDecimals;
    if (decimals === undefined) {
      const read = answers[index * stride + 2];
      if (!read?.ok) return;
      decimals = Number(read.value);
    }
    if (!Number.isFinite(decimals)) return;

    const sqrtPriceX96 = (slot0.value as readonly bigint[])[0];
    const price = rateFromSqrtPrice(
      sqrtPriceX96,
      String(token0.value).toLowerCase() === row.token.toLowerCase(),
      decimals,
      quoteDecimals(venue, row.quote),
    );
    if (Number.isFinite(price) && price > 0) prices.set(row.pool.toLowerCase(), price);
  });

  return prices;
}

export type MarketIndex = {
  markets: IndexedMarket[];
  /** Pools the factory has opened against a fundable asset, within the window. */
  scanned: number;
  /** How many of those held nothing. The noise this index exists to drop. */
  empty: number;
  /** True when the block budget ran out before the window was covered. */
  partial: boolean;
  /**
   * Pools whose depth could not be read even after a retry. These are counted
   * as empty, so a number above zero means the index is missing rows rather
   * than that the chain is quiet.
   */
  unread: number;
  builtAt: number;
};

/**
 * Builds the index. One scan of the factory, one balance per pool, then prices
 * for the deepest survivors only — the last pass is the expensive one, so it
 * runs after depth has already thrown most of the chain away.
 */
export async function buildMarketIndex(
  client: PublicClient,
  venue: Venue,
): Promise<MarketIndex> {
  const head = await client.getBlockNumber();
  const { pools, partial } = await collectPools(client, venue, head);
  const { depth, unread } = await readDepth(client, pools);

  /* Ordering waits for `coinUsd` below: raw units are not comparable across
     assets, and a dollar with six decimals sorted against a coin with eighteen
     puts every coin pool on the chain above every dollar one. */
  const live = pools.filter((row) => (depth.get(row.pool.toLowerCase()) ?? 0n) > 0n);

  const coinUsd = await nativeUsd(client, venue);

  /* One row per token: a token pooled at several fee tiers is the deepest of
     them, which is the pool a trade would actually route through. */
  const best = new Map<string, PoolRow>();
  for (const row of live) {
    const key = row.token.toLowerCase();
    const held = best.get(key);
    if (!held) {
      best.set(key, row);
      continue;
    }
    const a = valued(depth.get(row.pool.toLowerCase()) ?? 0n, row, venue, coinUsd);
    const b = valued(depth.get(held.pool.toLowerCase()) ?? 0n, held, venue, coinUsd);
    if (a > b) best.set(key, row);
  }

  const ranked = [...best.values()]
    .sort(
      (a, b) =>
        valued(depth.get(b.pool.toLowerCase()) ?? 0n, b, venue, coinUsd) -
        valued(depth.get(a.pool.toLowerCase()) ?? 0n, a, venue, coinUsd),
    )
    .slice(0, MAX_PRICED);

  const prices = await pricePools(client, ranked, venue);

  const markets: IndexedMarket[] = ranked.map((row) => {
    const raw = depth.get(row.pool.toLowerCase()) ?? 0n;
    const decimals = quoteDecimals(venue, row.quote);
    const price = prices.get(row.pool.toLowerCase());
    const usd = usdRate(row, venue, coinUsd);
    return {
      address: row.token,
      pool: row.pool,
      fee: row.fee,
      quote: row.quote,
      depth: raw.toString(),
      depthDecimals: decimals,
      ...(usd === undefined
        ? {}
        : { depthUsd: (Number(raw) / 10 ** decimals) * usd }),
      ...(price === undefined ? {} : { price }),
      ...(price === undefined || usd === undefined ? {} : { priceUsd: price * usd }),
      createdBlock: row.block.toString(),
    };
  });

  return {
    markets,
    scanned: pools.length,
    empty: pools.length - live.length,
    partial,
    unread,
    builtAt: Date.now(),
  };
}

/** What one unit of a pool's quote asset is worth in dollars, if anything. */
function usdRate(row: PoolRow, venue: Venue, coinUsd: number | undefined): number | undefined {
  if (row.quote.toLowerCase() === venue.stable?.toLowerCase()) return 1;
  return coinUsd;
}

/** Depth in dollars where that can be worked out, and in its own asset where it cannot. */
function valued(
  raw: bigint,
  row: PoolRow,
  venue: Venue,
  coinUsd: number | undefined,
): number {
  const amount = Number(raw) / 10 ** quoteDecimals(venue, row.quote);
  return amount * (usdRate(row, venue, coinUsd) ?? 1);
}
