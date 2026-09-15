import type { PublicClient } from "viem";
import { getAddress, isAddress } from "viem";
import { erc20Abi } from "./abi";
import { CHAIN_META, NATIVE, dexMeta } from "./chains";

export type Token = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  /** Marks the chain's native currency, which needs wrapping before routing. */
  native?: boolean;
};

export function nativeToken(chainId: number): Token | undefined {
  const meta = CHAIN_META[chainId];
  if (!meta) return undefined;
  return {
    chainId,
    address: NATIVE,
    symbol: meta.chain.nativeCurrency.symbol,
    name: meta.nativeName ?? meta.chain.nativeCurrency.name,
    decimals: meta.chain.nativeCurrency.decimals,
    native: true,
  };
}

/**
 * The chain's own money: native currency plus, where a venue has been resolved,
 * its wrapped token and USD unit. No curated token list stands behind these —
 * Robinhood Chain has no canonical one, and everything else in the app is read
 * off the chain or imported by hand.
 */
export function baseTokens(chainId: number): Token[] {
  const meta = CHAIN_META[chainId];
  if (!meta) return [];
  const native = nativeToken(chainId);
  const tokens = native ? [native] : [];

  const dex = dexMeta(chainId);
  if (!dex) return tokens;

  tokens.push({
    chainId,
    address: dex.wrapped,
    symbol: dex.wrappedSymbol,
    name: `Wrapped ${meta.chain.nativeCurrency.name}`,
    decimals: meta.chain.nativeCurrency.decimals,
  });

  if (dex.stable) {
    tokens.push({
      chainId,
      address: dex.stable,
      symbol: dex.stableSymbol ?? "USDC",
      // Every chain's dollar has its own name, and this one's is not USD Coin.
      name: dex.stableName ?? dex.stableSymbol ?? "USD Coin",
      decimals: dex.stableDecimals ?? 6,
    });
  }

  return tokens;
}

/** The chain's USD unit, when the venue carries one. */
export function stableToken(chainId: number): Token | undefined {
  const stable = dexMeta(chainId)?.stable;
  if (!stable) return undefined;
  return baseTokens(chainId).find(
    (token) => token.address.toLowerCase() === stable.toLowerCase(),
  );
}

export function mergeTokens(chainId: number, ...groups: Token[][]): Token[] {
  const seen = new Map<string, Token>();
  for (const group of groups) {
    for (const token of group) {
      if (token.chainId !== chainId) continue;
      const key = token.address.toLowerCase();
      const existing = seen.get(key);
      /* Earlier groups win on identity: a reader's own import outranks a list. */
      if (!existing) seen.set(key, token);
    }
  }
  return [...seen.values()];
}

/**
 * Reads name/symbol/decimals straight from the contract for unlisted tokens.
 * That is the whole of a token's identity here: the app draws no artwork, so a
 * contract pasted in thirty seconds ago arrives as complete as one that has
 * traded for a year.
 */
export async function readToken(
  client: PublicClient,
  chainId: number,
  address: `0x${string}`,
): Promise<Token> {
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return {
    chainId,
    address: getAddress(address),
    symbol,
    name,
    decimals: Number(decimals),
  };
}

export function sameToken(a: Token | undefined, b: Token | undefined): boolean {
  if (!a || !b) return false;
  return a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();
}

/**
 * Address used when naming a token to a contract that settles native currency
 * itself. SnyperRouter takes the zero address to mean "the chain's own money",
 * which is the usual on-chain convention and is not the sentinel this app
 * carries around in its own state.
 */
export function settlementAddress(token: Token): `0x${string}` {
  return token.native ? "0x0000000000000000000000000000000000000000" : token.address;
}

/** Address used for routing: native currency routes through its wrapper. */
export function routingAddress(token: Token): `0x${string}` {
  const dex = dexMeta(token.chainId);
  if (token.native && dex) return dex.wrapped;
  return token.address;
}

export function tokenKey(token: Token): string {
  return `${token.chainId}:${token.address.toLowerCase()}`;
}

export function searchTokens(tokens: Token[], query: string): Token[] {
  const q = query.trim().toLowerCase();
  if (!q) return tokens;
  return tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase() === q,
  );
}

export function isTokenAddress(value: string): value is `0x${string}` {
  return isAddress(value.trim());
}
