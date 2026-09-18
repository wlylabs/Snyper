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
 * Volume and price change are absent, and not by oversight. Both need swap
 * history, and this chain's endpoint caps one log query at ten thousand results
 * — which a single hour of swaps across the chain already exceeds. A figure
 * that cannot be read is better missing than estimated.
 */
export type MarketToken = {
  address: `0x${string}`;
  /** Dollars standing in the deepest pool. What every other figure rests on. */
  liquidityUsd?: number;
  /** Depth in the asset the pool is quoted against, for when no dollar exists. */
  depth?: number;
  depthSymbol?: string;
  priceUsd?: number;
  /** Fee tier of the pool the depth was measured in. */
  fee?: number;
  pool?: `0x${string}`;
};

/** How the index that produced these rows was doing. */
export type MarketMeta = {
  /** Pools the factory has opened against a fundable asset. */
  scanned: number;
  /** How many of those held nothing — the noise the index exists to drop. */
  empty: number;
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
 * On this chain that is one question: is there anything in the pool. Measured
 * over eleven days, eighty percent of the pools opened against wrapped native
 * held nothing or dust, and every one of them would otherwise be a row the
 * reader has to work out is dead. Depth is also the only figure here that was
 * read rather than inferred, which is the other reason it is the gate.
 *
 * Nothing is hidden by this: an address still imports by hand. It is the
 * difference between what the app offers and what the app allows.
 */
export function tradeable(market: MarketToken): boolean {
  return (market.liquidityUsd ?? 0) > 0 || (market.depth ?? 0) > 0;
}

function toToken(entry: IndexedMarket, symbols: Map<string, string>): MarketToken | undefined {
  const parsed = address(entry.address);
  if (!parsed) return undefined;

  const decimals = Number(entry.depthDecimals);
  let depth: number | undefined;
  try {
    depth = Number(BigInt(entry.depth)) / 10 ** (Number.isFinite(decimals) ? decimals : 18);
  } catch {
    depth = undefined;
  }

  return {
    address: parsed,
    liquidityUsd: positive(entry.depthUsd),
    depth: positive(depth),
    depthSymbol: symbols.get(entry.quote.toLowerCase()),
    priceUsd: positive(entry.priceUsd),
    fee: Number.isFinite(Number(entry.fee)) ? Number(entry.fee) : undefined,
    pool: address(entry.pool),
  };
}

/**
 * The chain's traded tokens, deepest first.
 *
 * `seeds` are the assets every pool here is quoted against — the wrapped native
 * and the dollar. They are excluded from the result, since the app already
 * carries them, and their symbols label the depth of any pool the dollar could
 * not value.
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

  /* The index already ranked these by what the pool holds, valued in dollars
     wherever the chain's own dollar could price the quote asset. */
  return {
    tokens: tokens.slice(0, MAX_TOKENS),
    meta: {
      scanned: Number(index.scanned) || 0,
      empty: Number(index.empty) || 0,
      partial: Boolean(index.partial),
      builtAt: Number(index.builtAt) || Date.now(),
    },
  };
}
