import type { PublicClient } from "viem";
import { getAddress, parseAbiItem, zeroAddress } from "viem";
import { erc20Abi, v3FactoryAbi, v3PoolAbi } from "./abi";
import { scanBack } from "./logscan";
import { rateFromSqrtPrice } from "./quote";
import { scanSwaps, type TradedPool } from "./swapScan";
import { indexV4PoolKeys, type V4Pool } from "./v4";
import type { Venue } from "./venue";

/**
 * What trades on this chain, asked of the chain.
 *
 * The question a reader opening an empty picker is really asking is "what is
 * there", and it used to be put to DexScreener — an indexer whose slug for
 * chain 4663 was never confirmed, and which the whole picker went dark without.
 * Both venues answer it first hand, out of their own swap logs.
 *
 * Ranking is by what changed hands, not by what is standing in the pool. The
 * first version of this ranked by depth, which worked while Uniswap v3 was the
 * only venue the app could see: a pool's depth is its own balance, and 3,403 of
 * them read back in one pass. Uniswap v4 ended that. Its pools share one
 * singleton, so no balance belongs to any of them, and the obvious substitute —
 * active liquidity as a virtual reserve — measured a median of 604 times the
 * money actually in a v3 pool, and 477 billion times it at the extreme. Two
 * different units cannot be sorted into one list.
 *
 * Volume is what both venues report identically, and it was the better ranking
 * anyway: depth is an offer a launch can mint itself, volume is the part
 * somebody had to pay for. Depth survives as a figure shown beside a v3 row,
 * where it still means what it says, and is simply absent on a v4 row rather
 * than filled in with something that is not it.
 *
 * Measured on chain while this was written: v3 carries about one swap a block
 * across 369 pools, v4 about two across 1,136 — so most of what actually trades
 * here was invisible until v4 was included, and the v3 factory's 497 new pools
 * a day were never the larger half.
 */

const POOL_CREATED = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);

/**
 * How far back pool identities are collected. Ranking only looks at the last
 * half hour of trading (see `swapScan.ts`), but a pool that traded in it may
 * have been opened long before, so this window is the one that decides which
 * of those pools can be named at all.
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

/**
 * Base pause before a retry, since what is being retried is a rate limit. Each
 * further attempt squares the multiplier: 1.5s, 6s, 13.5s.
 */
const RETRY_PAUSE_MS = 1_500;

/** Let the endpoint breathe between the heavy phases of one build. */
const PHASE_PAUSE_MS = 2_000;

/**
 * v3 pools carried into naming, busiest first.
 *
 * Naming a v3 pool means asking it for both its currencies, and a thousand of
 * them is two thousand calls arriving right behind two log scans — which the
 * public endpoint answers by refusing all of them. Refused reads look exactly
 * like "no v3 pool traded", and that is what the index reported: not one v3 row
 * in a hundred and fifty, on a chain where v3 pools hold hundreds of thousands
 * of dollars.
 *
 * Swap count is the pre-filter because it is the only thing known before the
 * pair is: the quote side cannot be picked, and raw amounts on the two sides
 * are in different decimals. A pool with few swaps but one enormous trade can
 * be missed this way, which is the honest cost of naming what can be named.
 */
const MAX_V3_NAMED = 300;

function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PHASE_PAUSE_MS));
}

export type IndexedMarket = {
  address: `0x${string}`;
  /** Which venue the trading happened on. Only v3 can also be traded here. */
  venue: "v3" | "v4";
  /** Pool address on v3; pool id on v4, which has no address of its own. */
  pool: `0x${string}`;
  fee: number;
  /** Asset the pool is quoted against: wrapped native, the dollar, or the coin. */
  quote: `0x${string}`;
  /** Quote units traded over the window, as a decimal string so JSON carries it. */
  volume: string;
  volumeDecimals: number;
  /** Volume in dollars, where the quote asset could be valued. */
  volumeUsd?: number;
  swaps: number;
  /**
   * Quote units standing in the pool. Only ever set on a v3 row: a v4 pool's
   * money sits in a singleton with everyone else's, so there is no balance to
   * read, and no substitute for it that means the same thing.
   */
  depth?: string;
  depthUsd?: number;
  /** One token in quote units. */
  price?: number;
  priceUsd?: number;
  decimals?: number;
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

  /*
   * Retries get smaller and slower, several times over.
   *
   * What fails here is almost never the call — it is the endpoint declining to
   * answer any more for a while, after the log scans ahead of this have used up
   * its patience. Retrying at once, at the same size, spends the second chance
   * on the same limit: a whole pass of 933 pool reads came back empty that way,
   * and read as "no v3 pool traded" rather than as a failure. So each pass waits
   * longer and asks for less, and the route this runs behind is cached, so the
   * minute it can cost is a minute no reader waits for.
   */
  let outstanding = await pass(
    calls.map((_, index) => index),
    CALL_CHUNK,
  );

  for (const attempt of [1, 2, 3]) {
    if (outstanding.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS * attempt * attempt));
    outstanding = await pass(outstanding, Math.max(25, Math.ceil(CALL_CHUNK / 2 ** attempt)));
  }

  return { answers, failed: outstanding.length };
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
  /** Pools that traded in the window, on both venues. */
  traded: number;
  /** How many of those could not be named, so could not be offered. */
  unnamed: number;
  /** True when a scan's block budget ran out before its window was covered. */
  partial: boolean;
  builtAt: number;
};

/** A traded pool once its two sides are known. */
type NamedPool = {
  venue: "v3" | "v4";
  pool: `0x${string}`;
  token: `0x${string}`;
  quote: `0x${string}`;
  fee: number;
  /** Quote-side amount traded, already picked from the right side of the pair. */
  volume: bigint;
  swaps: number;
  sqrtPriceX96: bigint;
  /** True when the token is currency0/token0, which decides how price reads. */
  tokenIsFirst: boolean;
};

/** Names every v3 pool that traded, by asking each pool for its own pair. */
async function nameV3Pools(
  client: PublicClient,
  traded: readonly TradedPool[],
  money: ReadonlySet<string>,
): Promise<NamedPool[]> {
  if (traded.length === 0) return [];
  const { answers } = await chunkedMulticall(
    client,
    traded.flatMap((row) => [
      { address: row.key as `0x${string}`, abi: v3PoolAbi, functionName: "token0" },
      { address: row.key as `0x${string}`, abi: v3PoolAbi, functionName: "token1" },
    ]),
  );

  const named: NamedPool[] = [];
  traded.forEach((row, index) => {
    const zero = answers[index * 2];
    const one = answers[index * 2 + 1];
    if (!zero?.ok || !one?.ok) return;
    const token0 = getAddress(zero.value as string);
    const token1 = getAddress(one.value as string);
    const quoteIsFirst = money.has(token0.toLowerCase());
    // Exactly one side must be an asset a trade here could be funded with.
    if (quoteIsFirst === money.has(token1.toLowerCase())) return;
    named.push({
      venue: "v3",
      pool: getAddress(row.key),
      token: quoteIsFirst ? token1 : token0,
      quote: quoteIsFirst ? token0 : token1,
      fee: 0,
      volume: quoteIsFirst ? row.amount0 : row.amount1,
      swaps: row.swaps,
      sqrtPriceX96: row.sqrtPriceX96,
      tokenIsFirst: !quoteIsFirst,
    });
  });
  return named;
}

/** Names every v4 pool that traded, from the pool-key index built off Initialize. */
function nameV4Pools(
  traded: readonly TradedPool[],
  keys: ReadonlyMap<string, V4Pool>,
  money: ReadonlySet<string>,
): NamedPool[] {
  const named: NamedPool[] = [];
  for (const row of traded) {
    const key = keys.get(row.key);
    if (!key) continue;
    const quoteIsFirst = money.has(key.currency0.toLowerCase());
    if (quoteIsFirst === money.has(key.currency1.toLowerCase())) continue;
    named.push({
      venue: "v4",
      pool: key.id,
      token: quoteIsFirst ? key.currency1 : key.currency0,
      quote: quoteIsFirst ? key.currency0 : key.currency1,
      fee: key.fee,
      volume: quoteIsFirst ? row.amount0 : row.amount1,
      swaps: row.swaps,
      sqrtPriceX96: row.sqrtPriceX96,
      tokenIsFirst: !quoteIsFirst,
    });
  }
  return named;
}

/**
 * Builds the index.
 *
 * One swap scan says what traded; naming says what each of those pools trades;
 * ranking is by the quote side of that volume, valued in dollars so a pool
 * quoted in the coin and one quoted in the dollar can be compared. Only the
 * rows that survive all of it are read any further — decimals, and on v3 the
 * pool's own depth — because that last pass is the expensive one.
 */
export async function buildMarketIndex(
  client: PublicClient,
  venue: Venue,
): Promise<MarketIndex> {
  const head = await client.getBlockNumber();
  const money = new Set(
    [venue.wrapped, venue.stable, zeroAddress]
      .filter(Boolean)
      .map((a) => (a as string).toLowerCase()),
  );

  const scan = await scanSwaps(client, head);
  const traded = [...scan.pools.values()];

  /*
   * v3 is named first, and not by accident. Naming a v3 pool is a handful of
   * multicalls; building the v4 key map is tens of thousands of logs. Run the
   * other way round, the map exhausts the endpoint's patience and every v3 read
   * behind it comes back rate-limited — which reads as "no v3 pool traded"
   * rather than as a failure, and cost the index every v3 row it had.
   */
  await breathe();
  const namedV3 = await nameV3Pools(
    client,
    traded
      .filter((row) => row.venue === "v3")
      .sort((a, b) => b.swaps - a.swaps)
      .slice(0, MAX_V3_NAMED),
    money,
  );

  await breathe();
  const v4Keys = await indexV4PoolKeys(
    client,
    [venue.wrapped, venue.stable, zeroAddress].filter(Boolean) as `0x${string}`[],
    head,
    WINDOW_BLOCKS,
  );

  const named = [
    ...namedV3,
    ...nameV4Pools(traded.filter((row) => row.venue === "v4"), v4Keys.keys, money),
  ];

  await breathe();
  const coinUsd = await nativeUsd(client, venue);

  /* One row per token: a token traded in several pools is the busiest of them,
     which is the pool its price is worth reading from. */
  const best = new Map<string, NamedPool>();
  for (const row of named) {
    const key = row.token.toLowerCase();
    const held = best.get(key);
    if (!held || valued(row, venue, coinUsd) > valued(held, venue, coinUsd)) {
      best.set(key, row);
    }
  }

  const ranked = [...best.values()]
    .filter((row) => row.volume > 0n)
    .sort((a, b) => valued(b, venue, coinUsd) - valued(a, venue, coinUsd))
    .slice(0, MAX_PRICED);

  // Decimals decide what every amount means, and depth is only readable on v3.
  const v3Rows = ranked.filter((row) => row.venue === "v3");
  const [{ answers: decimals }, depth] = await Promise.all([
    chunkedMulticall(
      client,
      ranked.map((row) => ({
        address: row.token,
        abi: erc20Abi,
        functionName: "decimals",
      })),
    ),
    readDepth(
      client,
      v3Rows.map((row) => ({
        pool: row.pool,
        token: row.token,
        quote: row.quote,
        fee: row.fee,
        block: 0n,
      })),
    ),
  ]);

  const markets: IndexedMarket[] = [];
  ranked.forEach((row, index) => {
    const answer = decimals[index];
    if (!answer?.ok) return;
    const tokenDecimals = Number(answer.value);
    if (!Number.isFinite(tokenDecimals)) return;

    const quoteDp = quoteDecimals(venue, row.quote);
    const usd = usdRate(row.quote, venue, coinUsd);
    const price = rateFromSqrtPrice(
      row.sqrtPriceX96,
      row.tokenIsFirst,
      tokenDecimals,
      quoteDp,
    );
    const priced = Number.isFinite(price) && price > 0 ? price : undefined;
    const rawDepth = depth.depth.get(row.pool.toLowerCase());

    markets.push({
      address: row.token,
      venue: row.venue,
      pool: row.pool,
      fee: row.fee,
      quote: row.quote,
      volume: row.volume.toString(),
      volumeDecimals: quoteDp,
      ...(usd === undefined
        ? {}
        : { volumeUsd: (Number(row.volume) / 10 ** quoteDp) * usd }),
      swaps: row.swaps,
      ...(rawDepth === undefined
        ? {}
        : {
            depth: rawDepth.toString(),
            ...(usd === undefined
              ? {}
              : { depthUsd: (Number(rawDepth) / 10 ** quoteDp) * usd }),
          }),
      ...(priced === undefined ? {} : { price: priced }),
      ...(priced === undefined || usd === undefined ? {} : { priceUsd: priced * usd }),
      decimals: tokenDecimals,
    });
  });

  return {
    markets,
    traded: traded.length,
    unnamed: traded.length - named.length,
    partial: scan.partial || v4Keys.partial,
    builtAt: Date.now(),
  };
}

/** What one unit of a pool's quote asset is worth in dollars, if anything. */
function usdRate(
  quote: `0x${string}`,
  venue: Venue,
  coinUsd: number | undefined,
): number | undefined {
  return quote.toLowerCase() === venue.stable?.toLowerCase() ? 1 : coinUsd;
}

/** Volume in dollars where that can be worked out, and in its own asset where it cannot. */
function valued(row: NamedPool, venue: Venue, coinUsd: number | undefined): number {
  const amount = Number(row.volume) / 10 ** quoteDecimals(venue, row.quote);
  return amount * (usdRate(row.quote, venue, coinUsd) ?? 1);
}
