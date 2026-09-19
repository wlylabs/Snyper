import { CHAIN } from "./chains";

/**
 * The chain's own explorer, read as an index.
 *
 * No RPC call answers the question a balance screen has to open with. An
 * address does not hold tokens; tokens hold a mapping, and `balanceOf` only
 * answers once you already know which contract to ask. Enumerating them means
 * reading every `Transfer` the address has ever touched — on a chain that
 * settles a block every 100ms, that is not a request a phone makes.
 *
 * Which is why no wallet does it that way. MetaMask, Rabby, Rainbow, Phantom
 * and the rest all read an index; the only difference between them is whose.
 * Chain 4663 ships one already — Blockscout is the explorer named in the chain
 * definition this app builds on — and it answers from a browser without a key.
 *
 * What comes back is a claim, not a balance. It is treated as one: the index
 * says which contracts are worth asking about, and the chain is asked. See
 * `useHoldings`.
 */

/** Derived from the chain, so there is one place a network is described. */
export const BASE = CHAIN.blockExplorers?.default.url ?? "";

/** Whether this chain has an index to read at all. */
export const SCAN_CONFIGURED = BASE.length > 0;

/** Long enough for a cold index, short enough to fail before a reader gives up. */
const TIMEOUT = 12_000;

/**
 * The paths on the index, named once so the relay and the browser cannot drift
 * into asking it two different questions.
 */
export const SCAN_PATHS = {
  balances: (address: string) => `/api/v2/addresses/${address}/token-balances`,
  stats: "/api/v2/stats",
} as const;

/**
 * The same-origin way to the index, for the readers who have no other.
 *
 * This explorer sits behind Cloudflare, and Cloudflare answers a request it
 * does not like with a challenge rather than an error — measured from a
 * datacentre address it is a flat `403` with `cf-mitigated: challenge`, and
 * from a browser it can be a challenge page served as a clean `200`. Either way
 * it arrives cross-origin, which means a browser that is refused cannot read
 * why, and the balance screen loses every token row it exists to show while the
 * native balance beside them keeps updating.
 *
 * So the browser asks the explorer itself first and comes here when that fails,
 * which is exactly the arrangement `/api/rpc` has with the chain. A server is a
 * different client on a different network: it is not carrying the reader's
 * fingerprint, it is not subject to their network's blocks, and its answer
 * arrives from this origin where no cross-origin policy applies.
 */
const RELAY = {
  balances: (address: string) => `/api/balances/${address}`,
  stats: "/api/coin-price",
} as const;

export type ScanToken = {
  address_hash: string;
  decimals: string | null;
  exchange_rate: string | null;
  name: string | null;
  /** Blockscout's own verdict on the token. See `reputable` in `useHoldings`. */
  reputation: string | null;
  symbol: string | null;
  /** "ERC-20", "ERC-721", "ERC-1155". Only the first is money. */
  type: string;
};

export type ScanBalance = {
  token: ScanToken;
  /** Base units, as a decimal string. */
  value: string;
};

export async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  /*
   * A challenge page is served as HTML and sometimes as a clean 200, so the
   * status alone does not say whether this answered. Anything that is not JSON
   * is treated the same way as a refusal — as an index that did not answer.
   */
  if (!response.ok) throw new Error(`Explorer answered ${response.status}`);
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new Error("Explorer did not answer with JSON");
  }
  return (await response.json()) as T;
}

/**
 * The index, then this origin's relay to it.
 *
 * Only in a browser. On the server a relative URL is not fetchable, and the
 * relay's upstream is the host the server would already be calling — so there
 * the direct read stands alone, exactly as the chain transport does.
 */
async function either<T>(path: string, relay: string): Promise<T> {
  try {
    return await read<T>(`${BASE}${path}`);
  } catch (error) {
    if (typeof window === "undefined") throw error;
    return read<T>(relay);
  }
}

/** Every token the index has seen this address hold, zero balances excluded. */
export function fetchTokenBalances(address: string): Promise<ScanBalance[]> {
  return either<ScanBalance[]>(SCAN_PATHS.balances(address), RELAY.balances(address));
}

/**
 * What the native coin is worth, in USD.
 *
 * Chain-wide rather than per address, so every reader shares one answer and one
 * cache entry. `null` is a real response here — an index that has no price for
 * the coin says so — and is passed on as undefined rather than as a failure.
 */
export function fetchCoinPrice(): Promise<number | undefined> {
  return either<{ coin_price: string | null }>(SCAN_PATHS.stats, RELAY.stats).then(
    (stats) => (stats.coin_price ? Number(stats.coin_price) : undefined),
  );
}
