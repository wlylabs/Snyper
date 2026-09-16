import { getAddress, isAddress } from "viem";
import { CHAIN_SLUG, FEED_ENABLED } from "./tokenFeed";

/**
 * What actually trades on this chain, asked of an indexer.
 *
 * `tokenFeed.ts` asks the same indexer the narrow question — what are these
 * addresses worth — because pricing only ever concerns tokens the app already
 * knows. This asks the wide one, which is the question a reader opening an
 * empty picker is really asking: what is there? Nothing on chain can answer
 * that. A pool exists for every traded token, but finding pools means scanning
 * the factory's whole history, and the answer would still be a list of pools
 * with no sense of which ones anyone trades.
 *
 * DexScreener has no endpoint that lists a chain, so the chain is reached
 * sideways: its search matches token addresses, and every pool here is paired
 * against the chain's wrapped native or its dollar. Searching for those two
 * addresses therefore returns the pairs they sit in — which is to say, the
 * chain's market. The far side of each pair is a token worth offering.
 */

const SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
const TIMEOUT = 8000;

/** Tokens carried back from one pass. Beyond this the picker is a phone book. */
const MAX_TOKENS = 120;

/**
 * What the indexer says about a token that is not yet in the app's list.
 *
 * Deliberately not a `Token`: the feed carries no decimals, and decimals are
 * not a display detail — they decide what an amount means. So this stays a
 * market reading until the chain has confirmed the token's identity, and the
 * two are joined in `useDiscoverTokens`.
 */
export type MarketToken = {
  address: `0x${string}`;
  /** Ticker as the indexer has it. The contract remains the authority. */
  symbol?: string;
  name?: string;
  priceUsd?: number;
  /** Dollars in the deepest pair. What the reading is worth is worth this. */
  liquidityUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  /** Fraction, 0.01 = 1%, over the last day. */
  change24h?: number;
  /** When the deepest pair was created, in milliseconds. */
  pairCreatedAt?: number;
};

type SearchToken = { address?: string; symbol?: string; name?: string };

type SearchPair = {
  chainId?: string;
  baseToken?: SearchToken;
  quoteToken?: SearchToken;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  priceChange?: { h24?: number };
  pairCreatedAt?: number;
};

function positive(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function address(value: string | undefined): `0x${string}` | undefined {
  if (!value || !isAddress(value)) return undefined;
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}

/** One search, or nothing. A miss here is a shorter list, never an error. */
async function search(query: string): Promise<SearchPair[]> {
  try {
    const response = await fetch(`${SEARCH}${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { pairs?: SearchPair[] | null };
    return Array.isArray(body.pairs) ? body.pairs : [];
  } catch {
    // Offline, rate limited, blocked by the reader's network, or a slug this
    // indexer has never heard of: all of them mean the same nothing.
    return [];
  }
}

/**
 * Folds a pair into what is known about the token on its far side. The deepest
 * pair wins, exactly as in pricing: a token quoted from its shallowest pool is
 * quoted from the pool that agrees with the least money.
 */
function fold(
  found: Map<string, MarketToken>,
  token: SearchToken | undefined,
  pair: SearchPair,
): void {
  const parsed = address(token?.address);
  if (!parsed) return;

  const key = parsed.toLowerCase();
  const liquidity = positive(pair.liquidity?.usd) ?? 0;
  const held = found.get(key);
  if (held && (held.liquidityUsd ?? 0) >= liquidity) return;

  const change = pair.priceChange?.h24;
  found.set(key, {
    address: parsed,
    symbol: token?.symbol?.trim() || undefined,
    name: token?.name?.trim() || undefined,
    priceUsd: positive(pair.priceUsd),
    liquidityUsd: liquidity > 0 ? liquidity : undefined,
    volume24hUsd: positive(pair.volume?.h24),
    marketCapUsd: positive(pair.marketCap),
    fdvUsd: positive(pair.fdv),
    change24h:
      typeof change === "number" && Number.isFinite(change) ? change / 100 : undefined,
    pairCreatedAt: positive(pair.pairCreatedAt),
  });
}

/**
 * The chain's traded tokens, deepest first.
 *
 * `seeds` are the addresses every pool on the chain is paired against — the
 * wrapped native and the dollar — and they are both the search terms and the
 * tokens excluded from the result, since the app already carries them. Only
 * pairs on the configured chain count: an address is not unique across chains,
 * so a pair from somewhere else describes a different token that merely shares
 * an address.
 */
export async function readMarketTokens(
  seeds: readonly `0x${string}`[],
): Promise<MarketToken[]> {
  if (!FEED_ENABLED || seeds.length === 0) return [];

  const skip = new Set(seeds.map((seed) => seed.toLowerCase()));
  const results = await Promise.all(seeds.map((seed) => search(seed)));

  const found = new Map<string, MarketToken>();
  for (const pairs of results) {
    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;
      fold(found, pair.baseToken, pair);
      fold(found, pair.quoteToken, pair);
    }
  }
  for (const seed of skip) found.delete(seed);

  return [...found.values()]
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .slice(0, MAX_TOKENS);
}
