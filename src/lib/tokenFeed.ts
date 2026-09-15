import type { PublicClient } from "viem";
import { readTokenLogos, resolveUri } from "./tokenMeta";

/**
 * The second place to ask what a token looks like.
 *
 * About half the tokens trading on this chain answer no metadata getter at all,
 * and nothing on chain can be done about that. DexScreener indexes pairs across
 * most chains and carries an image for many of the tokens in them, so it covers
 * the half the contracts are silent about.
 *
 * The two sources are complementary rather than redundant, and in a useful
 * direction: a launch still sitting on its Pons bonding curve has no pair for
 * an indexer to have seen yet, but it is exactly the kind of token that ships a
 * `logo()`. An older token with deep liquidity is the opposite. So the chain is
 * asked first and this only ever sees what it could not answer.
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
  info?: { imageUrl?: string };
  /** Market price of the base token in dollars, as a decimal string. */
  priceUsd?: string;
};

/** What the feed had to say about one token, out of every pair it is in. */
export type FeedToken = {
  logo?: string;
  priceUsd?: number;
};

function usd(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Asks DexScreener about a batch of addresses in one request.
 *
 * Only pairs on the configured chain count. An address is not unique across
 * chains — the same deployer produces the same address on every one of them —
 * so a pair from somewhere else would hand back a picture of a different token
 * that merely shares an address.
 *
 * Deepest pair wins, and price and artwork are settled separately: the pair
 * that prices a token best is the one holding the most money, while the pair
 * carrying its picture may be any of them. Taking both off a single winner
 * would cost a token its logo for the sake of tidiness.
 */
export async function readFeedTokens(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, FeedToken>> {
  const found = new Map<string, FeedToken>();
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

    const bestPrice = new Map<string, { liquidity: number; priceUsd: number }>();
    const bestLogo = new Map<string, { liquidity: number; url: string }>();

    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;
      const address = pair.baseToken?.address?.toLowerCase();
      if (!address) continue;

      const liquidity = Number(pair.liquidity?.usd ?? 0);

      const priceUsd = usd(pair.priceUsd);
      if (priceUsd !== undefined) {
        const held = bestPrice.get(address);
        if (!held || liquidity > held.liquidity) {
          bestPrice.set(address, { liquidity, priceUsd });
        }
      }

      const url = resolveUri(pair.info?.imageUrl);
      if (url) {
        const held = bestLogo.get(address);
        if (!held || liquidity > held.liquidity) bestLogo.set(address, { liquidity, url });
      }
    }

    for (const [address, { url }] of bestLogo) found.set(address, { logo: url });
    for (const [address, { priceUsd }] of bestPrice) {
      found.set(address, { ...found.get(address), priceUsd });
    }
  } catch {
    // Offline, rate limited, blocked by the reader's network, or a chain this
    // indexer has never heard of: all of them mean the same nothing.
  }

  return found;
}

/** Just the artwork, for the path that only ever wanted that. */
export async function readFeedLogos(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, string>> {
  const tokens = await readFeedTokens(addresses);
  const logos = new Map<string, string>();
  for (const [address, token] of tokens) {
    if (token.logo) logos.set(address, token.logo);
  }
  return logos;
}

/**
 * Market prices for a batch of tokens, in dollars.
 *
 * This is the number a reader recognises. A pool's own mid price is the truth
 * about one pool; the price a wallet, a chart and an aggregator all show is the
 * one taken across every pair a token trades in, weighted to the deepest. A
 * portfolio valued the first way disagrees with every other screen the reader
 * has open, and is right in a way that helps nobody.
 */
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

  const results = await Promise.all(batches.map((batch) => readFeedTokens(batch)));
  for (const result of results) {
    for (const [address, token] of result) {
      if (token.priceUsd !== undefined) prices.set(address, token.priceUsd);
    }
  }

  return prices;
}

/**
 * Everything the app knows how to ask, in order, for a batch of tokens.
 *
 * Every address comes back keyed whether or not anything answered — an empty
 * string is the record that both sources were asked and neither had a picture,
 * which is what stops the same dead lookup running on every visit.
 */
export async function resolveTokenLogos(
  client: PublicClient,
  addresses: readonly `0x${string}`[],
): Promise<Map<string, string>> {
  const logos = await readTokenLogos(client, addresses);

  const silent = addresses.filter((address) => !logos.get(address.toLowerCase()));
  if (silent.length === 0) return logos;

  const feed = await readFeedLogos(silent);
  for (const [address, url] of feed) logos.set(address, url);

  return logos;
}

/** One token, for the import path where a single contract has just arrived. */
export async function resolveTokenLogo(
  client: PublicClient,
  address: `0x${string}`,
): Promise<string | undefined> {
  const logos = await resolveTokenLogos(client, [address]);
  return logos.get(address.toLowerCase()) || undefined;
}
