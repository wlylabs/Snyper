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
};

function usd(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
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
        found.set(address, priceUsd);
      }
    }
  } catch {
    // Offline, rate limited, blocked by the reader's network, or a chain this
    // indexer has never heard of: all of them mean the same nothing.
  }

  return found;
}

/** Market prices for a batch of tokens, in dollars. */
export async function readFeedPrices(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (addresses.length === 0) return prices;

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
    for (const [address, price] of result) prices.set(address, price);
  }

  return prices;
}
