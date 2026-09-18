"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/abi";
import {
  readMarketTokens,
  tradeable,
  type MarketMeta,
  type MarketReading,
  type MarketToken,
} from "@/lib/market";
import { readPonsLaunches, type PonsLaunch } from "@/lib/pons";
import { baseTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

/**
 * Tokens the app was never told about, offered only where a market stands
 * behind them.
 *
 * A chain like this one mints far more contracts than anybody trades. Listing
 * all of them is not a fuller picker, it is a phone book with a handful of real
 * entries buried in it, and every row that cannot be bought costs the reader
 * the time it takes to work out that it cannot be bought. So a pool, a day's
 * volume and a cap are the price of admission here: those three are what a
 * memecoin is read by, and a contract that has none of them has no market at
 * all. It stays reachable — its address still imports by hand — it is simply
 * not offered.
 */
export type DiscoverToken = Token & {
  /** Always present: a token with no market reading is not offered at all. */
  market: MarketToken;
  /**
   * Price times total supply. Always fully diluted: circulating supply is not
   * a fact the chain holds, so the honest figure is the one every token's own
   * record can back. Absent where the pool could not be priced in dollars.
   */
  fdvUsd?: number;
  /** The launchpad's own record, when it minted this token. */
  launch?: PonsLaunch;
  totalSupply?: bigint;
};

export type DiscoverResult = {
  tokens: DiscoverToken[];
  /** Pools that traded but could not be named, so were not offered. */
  rejected: number;
  /** True when the index answered with nothing, so there is nothing to offer. */
  marketEmpty: boolean;
  /** How the index that produced these rows was doing. */
  meta?: MarketMeta;
};

/** Identities confirmed in one multicall, which is one round trip. */
const MAX_RESOLVE = 150;

/** A minute. Long enough not to hammer the feed, short enough to stay current. */
const STALE_MS = 60_000;

const EMPTY: DiscoverResult = { tokens: [], rejected: 0, marketEmpty: true };

/**
 * Reads name, symbol and decimals off each contract.
 *
 * The market feed carries a symbol and a name but no decimals, and decimals are
 * not decoration — they decide what every amount in a trade means. A feed that
 * is stale, wrong, or describing a token on another chain that shares this
 * address would otherwise put a tradeable row in the picker that misprices
 * every order sent through it. So identity comes from the contract, always, and
 * a contract that will not answer is simply not offered.
 */
async function resolveIdentities(
  client: PublicClient,
  chainId: number,
  addresses: readonly `0x${string}`[],
): Promise<Map<string, Token & { totalSupply?: bigint }>> {
  const resolved = new Map<string, Token & { totalSupply?: bigint }>();
  if (addresses.length === 0) return resolved;

  const reads = await client.multicall({
    allowFailure: true,
    contracts: addresses.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
      { address: token, abi: erc20Abi, functionName: "name" as const },
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "totalSupply" as const },
    ]),
  });

  addresses.forEach((token, index) => {
    const [symbol, name, decimals, supply] = reads.slice(index * 4, index * 4 + 4);
    // A contract that cannot answer symbol and decimals is not an ERC-20.
    if (symbol?.status !== "success" || decimals?.status !== "success") return;
    resolved.set(token.toLowerCase(), {
      chainId,
      address: token,
      symbol: String(symbol.result),
      name: name?.status === "success" ? String(name.result) : String(symbol.result),
      decimals: Number(decimals.result),
      totalSupply: supply?.status === "success" ? (supply.result as bigint) : undefined,
    });
  });

  return resolved;
}

/**
 * Every tradeable token on this chain that the app does not already carry.
 *
 * Rows come from the market feed, because it is the only thing that can say a
 * token is traded. The launchpad is then asked which of them it minted: that is
 * one multicall against a contract that cannot be wrong about its own mints,
 * and it is the strongest provenance signal available on this chain, so the
 * Pons tag on a row is a fact rather than the name-and-supply guess the meme
 * heuristics fall back on.
 */
export function useDiscoverTokens(chainId: number | undefined) {
  const client = usePublicClient({ chainId });
  const venueKey = useAppStore((state) => state.venueKey);

  return useQuery<DiscoverResult>({
    queryKey: ["discover-tokens", chainId, venueKey],
    enabled: Boolean(chainId && client),
    staleTime: STALE_MS,
    gcTime: 5 * STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!chainId || !client) return EMPTY;

      const base = baseTokens(chainId);
      /* The assets every pool on this chain is quoted against, which label the
         depth of a pool the dollar could not value and must not come back as
         rows of their own. */
      const seeds = base
        .filter((token) => !token.native)
        .map((token) => ({ address: token.address, symbol: token.symbol }));
      const known = new Set(base.map((token) => token.address.toLowerCase()));

      const reading = await readMarketTokens(seeds).catch(
        (): MarketReading => ({ tokens: [] }),
      );
      const market = reading.tokens;
      if (market.length === 0) return EMPTY;

      const offered = market.filter(
        (token) => !known.has(token.address.toLowerCase()) && tradeable(token),
      );
      const candidates = offered.slice(0, MAX_RESOLVE);
      const addresses = candidates.map((token) => token.address);

      /* Identity is the chain's to answer; provenance is the launchpad's. A
         launchpad that will not answer costs a tag, never a row. */
      const [identities, launches] = await Promise.all([
        resolveIdentities(client, chainId, addresses),
        readPonsLaunches(client, addresses).catch(
          () => new Map<string, PonsLaunch>(),
        ),
      ]);

      const tokens: DiscoverToken[] = [];
      for (const entry of candidates) {
        const key = entry.address.toLowerCase();
        const identity = identities.get(key);
        if (!identity) continue;
        /* Fully diluted value, worked out here because this is the first place
           that holds both halves of it: the index priced the pool, and the
           contract just said how much of itself exists. */
        const supply =
          identity.totalSupply === undefined
            ? undefined
            : Number(identity.totalSupply) / 10 ** identity.decimals;
        const fdvUsd =
          entry.priceUsd !== undefined && supply !== undefined && supply > 0
            ? entry.priceUsd * supply
            : undefined;
        tokens.push({
          ...identity,
          market: entry,
          ...(fdvUsd === undefined ? {} : { fdvUsd }),
          launch: launches.get(key),
        });
      }

      /* `readMarketTokens` already ranked these, and nothing above reorders. */
      return {
        tokens,
        rejected: reading.meta?.unnamed ?? 0,
        marketEmpty: false,
        ...(reading.meta ? { meta: reading.meta } : {}),
      };
    },
  });
}
