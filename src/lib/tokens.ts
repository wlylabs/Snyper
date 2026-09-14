import type { PublicClient } from "viem";
import { getAddress, isAddress } from "viem";
import { erc20Abi } from "./abi";
import { CHAIN_META, NATIVE } from "./chains";

export type Token = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  /** Marks the chain's native currency, which needs wrapping before routing. */
  native?: boolean;
};

/**
 * Canonical Uniswap token list. Fetched at runtime from the browser — the app
 * ships no bundled price or token snapshots.
 */
const TOKEN_LIST_URL = "https://tokens.uniswap.org";

export function nativeToken(chainId: number): Token | undefined {
  const meta = CHAIN_META[chainId];
  if (!meta) return undefined;
  return {
    chainId,
    address: NATIVE,
    symbol: meta.chain.nativeCurrency.symbol,
    name: meta.chain.nativeCurrency.name,
    decimals: meta.chain.nativeCurrency.decimals,
    native: true,
  };
}

/** Wrapped native + the chain's USD unit are always available offline of the list. */
export function baseTokens(chainId: number): Token[] {
  const meta = CHAIN_META[chainId];
  if (!meta) return [];
  const native = nativeToken(chainId);
  return [
    ...(native ? [native] : []),
    {
      chainId,
      address: meta.wrapped,
      symbol: meta.wrappedSymbol,
      name: `Wrapped ${meta.chain.nativeCurrency.name}`,
      decimals: meta.chain.nativeCurrency.decimals,
    },
    {
      chainId,
      address: meta.stable,
      symbol: meta.stableSymbol,
      name: "USD Coin",
      decimals: meta.stableDecimals,
    },
  ];
}

type RawListToken = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

let listPromise: Promise<Token[]> | undefined;

export async function fetchTokenList(): Promise<Token[]> {
  if (!listPromise) {
    listPromise = (async () => {
      const res = await fetch(TOKEN_LIST_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Token list unavailable (${res.status})`);
      const body: { tokens?: RawListToken[] } = await res.json();
      const tokens = body.tokens ?? [];
      return tokens
        .filter((t) => t.chainId in CHAIN_META && isAddress(t.address))
        .map<Token>((t) => ({
          chainId: t.chainId,
          address: getAddress(t.address),
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          logoURI: t.logoURI,
        }));
    })().catch((error) => {
      listPromise = undefined;
      throw error;
    });
  }
  return listPromise;
}

export function mergeTokens(chainId: number, ...groups: Token[][]): Token[] {
  const seen = new Map<string, Token>();
  for (const group of groups) {
    for (const token of group) {
      if (token.chainId !== chainId) continue;
      const key = token.address.toLowerCase();
      if (!seen.has(key)) seen.set(key, token);
    }
  }
  return [...seen.values()];
}

/** Reads name/symbol/decimals straight from the contract for unlisted tokens. */
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

/** Address used for routing: native currency routes through its wrapper. */
export function routingAddress(token: Token): `0x${string}` {
  const meta = CHAIN_META[token.chainId];
  if (token.native && meta) return meta.wrapped;
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
