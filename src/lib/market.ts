import { getAddress, isAddress } from "viem";
import type { IndexedMarket, MarketIndex } from "./marketIndex";

/**
 * What actually trades on this chain, read from the chain itself.
 *
 * This used to ask DexScreener, sideways: it has no endpoint that lists a
 * chain, so the chain's own wrapped native and dollar were used as search terms
 * and whatever came back was the market. That worked only for as long as the
 * indexer carried chain 4663 at all — a slug this app could never confirm — and
 * the picker was empty the moment it did not.
 *
 * The factory answers the same question first hand. `marketIndex.ts` does the
 * reading and explains what the measurements said; this is the client's side of
 * it, which is one fetch of an index somebody else already built.
 */

const INDEX = "/api/market";
const TIMEOUT = 8000;

/** Tokens carried back from one pass. Beyond this the picker is a phone book. */
const MAX_TOKENS = 120;

/**
 * What the chain says about a token that is not yet in the app's list.
 *
 * Deliberately not a `Token`: decimals decide what an amount means, and the
 * index reads them off the pool's pricing rather than off the token's own
 * record, so identity stays the contract's to confirm in `useDiscoverTokens`.
 *
 * Price change over a day is absent, and not by oversight: it needs a day of
 * swap history, and this chain's endpoint caps one log query at ten thousand
 * results. A figure that cannot be read is better missing than estimated.
 */
export type MarketToken = {
  address: `0x${string}`;
  /** Which venue this trades on. Only v3 can also be traded from here. */
  venue?: "v3" | "v4";
  /** Dollars that changed hands over the window. What the ranking rests on. */
  volumeUsd?: number;
  /** Volume in the asset the pool is quoted against, for when no dollar exists. */
  volume?: number;
  volumeSymbol?: string;
  swaps?: number;
  /**
   * Dollars standing in the pool. Only ever present on a v3 row: a v4 pool's
   * money is pooled in a singleton with every other pool's, so there is no
   * balance belonging to it and nothing honest to put here.
   */
  liquidityUsd?: number;
  priceUsd?: number;
  /** Fee tier, or v4's dynamic-fee flag. */
  fee?: number;
  pool?: `0x${string}`;
};

/** How the index that produced these rows was doing. */
export type MarketMeta = {
  /** Pools that traded in the window, across both venues. */
  traded: number;
  /** How many of those could not be named, so could not be offered. */
  unnamed: number;
  /** True when the scan's block budget ran out before its window was covered. */
  partial: boolean;
  builtAt: number;
};

export type MarketReading = {
  tokens: MarketToken[];
  meta?: MarketMeta;
};

function address(value: string | undefined): `0x${string}` | undefined {
  if (!value || !isAddress(value)) return undefined;
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}

function positive(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Whether a reading describes a market at all.
 *
 * The index only carries pools that traded, so this is close to a formality —
 * but a row with no volume on either measure is one nobody paid for, and the
 * chain opens five hundred pools a day that nobody ever will.
 *
 * Nothing is hidden by this: an address still imports by hand. It is the
 * difference between what the app offers and what the app allows.
 */
export function tradeable(market: MarketToken): boolean {
  return (market.volumeUsd ?? 0) > 0 || (market.volume ?? 0) > 0;
}

function toToken(entry: IndexedMarket, symbols: Map<string, string>): MarketToken | undefined {
  const parsed = address(entry.address);
  if (!parsed) return undefined;

  const decimals = Number(entry.volumeDecimals);
  const scale = 10 ** (Number.isFinite(decimals) ? decimals : 18);
  const amount = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    try {
      return Number(BigInt(raw)) / scale;
    } catch {
      return undefined;
    }
  };

  return {
    address: parsed,
    venue: entry.venue === "v4" ? "v4" : "v3",
    volumeUsd: positive(entry.volumeUsd),
    volume: positive(amount(entry.volume)),
    volumeSymbol: symbols.get(entry.quote.toLowerCase()),
    swaps: positive(entry.swaps),
    liquidityUsd: positive(entry.depthUsd),
    priceUsd: positive(entry.priceUsd),
    fee: Number.isFinite(Number(entry.fee)) ? Number(entry.fee) : undefined,
    pool: address(entry.pool),
  };
}


/**
 * The chain's traded tokens, busiest first.
 *
 * `seeds` are the assets every pool here is quoted against — the wrapped
 * native, the dollar and the coin itself. They are excluded from the result,
 * since the app already carries them, and their symbols label the volume of any
 * pool the dollar could not value.
 */
export async function readMarketTokens(
  seeds: readonly { address: `0x${string}`; symbol: string }[],
): Promise<MarketReading> {
  const symbols = new Map(seeds.map((seed) => [seed.address.toLowerCase(), seed.symbol]));
  const skip = new Set(seeds.map((seed) => seed.address.toLowerCase()));

  let index: MarketIndex;
  try {
    const response = await fetch(INDEX, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { tokens: [] };
    index = (await response.json()) as MarketIndex;
  } catch {
    // The route is down, the scan failed, or this build has no server behind
    // it. All of them mean the same nothing, and the picker says so.
    return { tokens: [] };
  }

  if (!Array.isArray(index?.markets)) return { tokens: [] };

  const tokens: MarketToken[] = [];
  for (const entry of index.markets) {
    const token = toToken(entry, symbols);
    if (!token || skip.has(token.address.toLowerCase())) continue;
    tokens.push(token);
  }

  /* The index already ranked these by what changed hands, valued in dollars
     wherever the chain's own dollar could price the quote asset. */
  return {
    tokens: tokens.slice(0, MAX_TOKENS),
    meta: {
      traded: Number(index.traded) || 0,
      unnamed: Number(index.unnamed) || 0,
      partial: Boolean(index.partial),
      builtAt: Number(index.builtAt) || Date.now(),
    },
  };
}
