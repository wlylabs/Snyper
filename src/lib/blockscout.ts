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
const BASE = CHAIN.blockExplorers?.default.url ?? "";

/** Whether this chain has an index to read at all. */
export const SCAN_CONFIGURED = BASE.length > 0;

/** Long enough for a cold index, short enough to fail before a reader gives up. */
const TIMEOUT = 12_000;

export type ScanToken = {
  address_hash: string;
  decimals: string | null;
  exchange_rate: string | null;
  icon_url: string | null;
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

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  /*
   * The explorer sits behind Cloudflare, which answers a request it does not
   * like with an HTML challenge page rather than an error. Anything that is not
   * a clean JSON 200 is treated the same way — as an index that did not answer.
   */
  if (!response.ok) throw new Error(`Explorer answered ${response.status}`);
  return (await response.json()) as T;
}

/** Every token the index has seen this address hold, zero balances excluded. */
export function fetchTokenBalances(address: string): Promise<ScanBalance[]> {
  return read<ScanBalance[]>(`/api/v2/addresses/${address}/token-balances`);
}

/**
 * What the native coin is worth, in USD.
 *
 * Chain-wide rather than per address, so every reader shares one answer and one
 * cache entry. `null` is a real response here — an index that has no price for
 * the coin says so — and is passed on as undefined rather than as a failure.
 */
export function fetchCoinPrice(): Promise<number | undefined> {
  return read<{ coin_price: string | null }>("/api/v2/stats").then((stats) =>
    stats.coin_price ? Number(stats.coin_price) : undefined,
  );
}
