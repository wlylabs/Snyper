/**
 * What a token is worth, asked of an indexer rather than of a pool.
 *
 * A pool's own mid price is the truth about one pool; the price a wallet, a
 * chart and an aggregator all show is the one taken across every pair a token
 * trades in, weighted to the deepest. A portfolio valued the first way
 * disagrees with every other screen the reader has open, and is right in a way
 * that helps nobody. DexScreener indexes pairs across most chains, so it is
 * asked first and the chain's own pools are the fallback.
 */

const FEED = "https://api.dexscreener.com/latest/dex/tokens/";

/**
 * DexScreener keys chains by its own slug, not by chain id, and Robinhood Chain
 * is new enough that the slug could not be confirmed when this was written.
 * Getting it wrong costs nothing but a miss, and fixing it is an env var rather
 * than a release:
 *
 *   curl -s https://api.dexscreener.com/latest/dex/tokens/<a 4663 token> \
 *     | grep -o '"chainId":"[^"]*"' | sort -u
 */
const CHAIN_SLUG = process.env.NEXT_PUBLIC_DEXSCREENER_CHAIN?.trim() || "robinhood";

/** Readers' browsers talk to this, so there is a way to say no to that. */
const ENABLED = process.env.NEXT_PUBLIC_DEXSCREENER?.trim().toLowerCase() !== "off";

/** The endpoint's documented ceiling for one request. */
const MAX_ADDRESSES = 30;
/** Requests one pricing pass may make, so a crowded wallet stays one burst. */
const MAX_BATCHES = 6;
const TIMEOUT = 6000;

type FeedPair = {
  chainId?: string;
  baseToken?: { address?: string };
  liquidity?: { usd?: number };
  /** Market price of the base token in dollars, as a decimal string. */
  priceUsd?: string;
  /** Circulating market cap, when the feed knows the circulating supply. */
  marketCap?: number;
  /** Price times total supply, which the feed can always work out. */
  fdv?: number;
  priceChange?: { h24?: number };
};

/**
 * What the feed knows about a token, which is more than its price.
 *
 * Price is the part a portfolio needs and the part a memecoin reader trusts
 * least: it says nothing on its own, because it is market cap divided by a
 * supply that every launch picks differently. Two tokens at the same price are
 * not comparable; two at the same market cap are. So the depth behind a price
 * and the cap it implies travel with it, and the interface leads with whichever
 * one the token calls for.
 */
export type FeedQuote = {
  priceUsd: number;
  /** Circulating cap where the feed has one, otherwise nothing. */
  marketCapUsd?: number;
  /** Fully diluted value: price times total supply. */
  fdvUsd?: number;
  /** Dollars in the deepest pair. The price means as much as this number does. */
  liquidityUsd?: number;
  change24h?: number;
};

function usd(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Prices a batch of addresses in one request.
 *
 * Only pairs on the configured chain count. An address is not unique across
 * chains — the same deployer produces the same address on every one of them —
 * so a pair from somewhere else would price a different token that merely
 * shares an address. Among the pairs that do count, the deepest one wins: it is
 * the price the most money agrees with.
 */
async function readBatch(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, FeedQuote>> {
  const found = new Map<string, FeedQuote>();
  if (!ENABLED || addresses.length === 0) return found;

  const batch = addresses.slice(0, MAX_ADDRESSES);

  try {
    const response = await fetch(`${FEED}${batch.join(",")}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return found;

    const body = (await response.json()) as { pairs?: FeedPair[] | null };
    const pairs = body.pairs;
    if (!Array.isArray(pairs)) return found;

    const deepest = new Map<string, number>();

    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;
      const address = pair.baseToken?.address?.toLowerCase();
      if (!address) continue;

      const priceUsd = usd(pair.priceUsd);
      if (priceUsd === undefined) continue;

      const liquidity = Number(pair.liquidity?.usd ?? 0);
      const held = deepest.get(address);
      if (held === undefined || liquidity > held) {
        deepest.set(address, liquidity);
        found.set(address, {
          priceUsd,
          ...(positive(pair.marketCap) ? { marketCapUsd: pair.marketCap } : {}),
          ...(positive(pair.fdv) ? { fdvUsd: pair.fdv } : {}),
          ...(Number.isFinite(liquidity) && liquidity > 0
            ? { liquidityUsd: liquidity }
            : {}),
          ...(typeof pair.priceChange?.h24 === "number" &&
          Number.isFinite(pair.priceChange.h24)
            ? { change24h: pair.priceChange.h24 / 100 }
            : {}),
        });
      }
    }
  } catch {
    // Offline, rate limited, blocked by the reader's network, or a chain this
    // indexer has never heard of: all of them mean the same nothing.
  }

  return found;
}

/** Market data for a batch of tokens, keyed by lowercased address. */
export async function readFeedQuotes(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, FeedQuote>> {
  const quotes = new Map<string, FeedQuote>();
  if (addresses.length === 0) return quotes;

  /* The coin and its wrapper route to one address; asking twice buys nothing. */
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))] as
    `0x${string}`[];

  /*
   * One request per thirty addresses, run together rather than in sequence, up
   * to a ceiling. A wallet on a memecoin chain collects airdropped contracts it
   * never asked for, and a few hundred of them must not turn one page load into
   * a burst the feed answers with a rate limit — which would cost the prices of
   * the holdings that actually matter. What is left over is simply unpriced,
   * and the interface already says how many of those there are.
   */
  const batches: (readonly `0x${string}`[])[] = [];
  for (let index = 0; index < unique.length; index += MAX_ADDRESSES) {
    if (batches.length >= MAX_BATCHES) break;
    batches.push(unique.slice(index, index + MAX_ADDRESSES));
  }

  const results = await Promise.all(batches.map((batch) => readBatch(batch)));
  for (const result of results) {
    for (const [address, quote] of result) quotes.set(address, quote);
  }

  return quotes;
}
