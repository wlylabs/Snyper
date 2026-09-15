import { robinhood } from "viem/chains";
import type { Chain } from "viem";
import { activeVenue, type Venue } from "./venue";

export { NATIVE, isNative } from "./native";

/**
 * The one network this app speaks to. Snyper is a Robinhood Chain terminal:
 * every balance, quote, route and strategy in it belongs to chain 4663, and
 * nothing here is written to generalise across chains.
 */
export const CHAIN: Chain = robinhood;
export const CHAIN_ID = robinhood.id;
export const DEFAULT_CHAIN_ID = robinhood.id;
export const SUPPORTED_CHAINS = [robinhood] as const;

/**
 * The routing venue for the chain. Robinhood Chain publishes no deployment list
 * to ship against, so this is resolved per session — see `venue.ts`.
 */
export type DexMeta = Venue;

export type ChainMeta = {
  chain: Chain;
  /** Short label used across the interface. */
  label: string;
  /** Short mark drawn in the chain badge. */
  mark: string;
  explorer: string;
  /**
   * What to call the coin on screen, when that differs from the chain
   * definition. viem names chain 4663's currency "Ether", which is correct and
   * is not what any wallet a reader compares this against says — Robinhood,
   * Coinbase and MetaMask all write Ethereum — and nobody should have to work
   * out that the two are the same asset.
   */
  nativeName?: string;
};

export const CHAIN_META: Record<number, ChainMeta> = {
  [robinhood.id]: {
    chain: robinhood,
    label: "Robinhood",
    mark: "RH",
    explorer: robinhood.blockExplorers.default.url,
    nativeName: "Ethereum",
  },
};

export function chainMeta(chainId: number | undefined): ChainMeta | undefined {
  return chainId === undefined ? undefined : CHAIN_META[chainId];
}

/** Routing venue for a chain, or undefined while none has been resolved. */
export function dexMeta(chainId: number | undefined): DexMeta | undefined {
  return chainId === CHAIN_ID ? activeVenue() : undefined;
}

export function hasRouting(chainId: number | undefined): boolean {
  return Boolean(dexMeta(chainId));
}

export function isSupportedChain(chainId: number | undefined): boolean {
  return chainId === CHAIN_ID;
}

export function explorerTx(chainId: number, hash: string): string {
  const meta = CHAIN_META[chainId];
  return meta ? `${meta.explorer}/tx/${hash}` : "";
}

export function explorerAddress(chainId: number, address: string): string {
  const meta = CHAIN_META[chainId];
  return meta ? `${meta.explorer}/address/${address}` : "";
}
