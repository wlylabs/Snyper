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
const TIMEOUT = 6000;

type FeedPair = {
  chainId?: string;
  baseToken?: { address?: string };
  liquidity?: { usd?: number };
  info?: { imageUrl?: string };
};

/**
 * Asks DexScreener about a batch of addresses in one request.
 *
 * Only pairs on the configured chain count. An address is not unique across
 * chains — the same deployer produces the same address on every one of them —
 * so a pair from somewhere else would hand back a picture of a different token
 * that merely shares an address.
 */
export async function readFeedLogos(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
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

    /* Deepest pair wins: the thinnest one is the likeliest to be an impostor. */
    const best = new Map<string, { liquidity: number; url: string }>();

    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;
      const address = pair.baseToken?.address?.toLowerCase();
      if (!address) continue;
      const url = resolveUri(pair.info?.imageUrl);
      if (!url) continue;

      const liquidity = Number(pair.liquidity?.usd ?? 0);
      const held = best.get(address);
      if (!held || liquidity > held.liquidity) best.set(address, { liquidity, url });
    }

    for (const [address, { url }] of best) found.set(address, url);
  } catch {
    // Offline, rate limited, blocked by the reader's network, or a chain this
    // indexer has never heard of: all of them mean the same nothing.
  }

  return found;
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
