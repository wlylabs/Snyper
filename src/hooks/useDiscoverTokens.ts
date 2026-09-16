"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/abi";
import { indexPonsLaunches } from "@/lib/launches";
import { readMarketTokens, type MarketToken } from "@/lib/market";
import type { PonsLaunch } from "@/lib/pons";
import { baseTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

/**
 * Where a token the app was never told about came from.
 *
 * The two sources answer different questions and neither subsumes the other.
 * The market knows what people trade, and knows nothing about a token until a
 * pool has been indexed; the launchpad knows what was minted the moment it was
 * minted, and knows nothing about whether anyone wants it. A memecoin terminal
 * needs both, and a reader deciding what to do about a row needs to be told
 * which one is talking.
 */
export type DiscoverSource = "market" | "launchpad";

export type DiscoverToken = Token & {
  sources: DiscoverSource[];
  market?: MarketToken;
  /** The launchpad's own record, when it minted this token. */
  launch?: PonsLaunch;
  totalSupply?: bigint;
  /** Block the launchpad log named it at, which orders the newest launches. */
  launchedAt?: bigint;
};

export type DiscoverResult = {
  tokens: DiscoverToken[];
  /** True when the launch scan's budget ran out before its window was covered. */
  partial: boolean;
  scannedBlocks: number;
  /** True when the market feed answered with nothing, so the list is on-chain only. */
  marketEmpty: boolean;
};

/** Identities confirmed in one multicall, which is one round trip. */
const MAX_RESOLVE = 150;

/** A minute. Long enough not to hammer the feed, short enough for a new launch. */
const STALE_MS = 60_000;

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
 * Orders the list the way a reader reads it: what the most money stands behind,
 * then what was minted most recently. A launch with no pool yet has no depth to
 * sort by and is not therefore last — it is the newest thing on the chain, and
 * on this chain that is the point — so it follows the traded tokens rather than
 * being ranked against them at zero.
 */
function rank(a: DiscoverToken, b: DiscoverToken): number {
  const depthA = a.market?.liquidityUsd ?? 0;
  const depthB = b.market?.liquidityUsd ?? 0;
  if (depthA !== depthB) return depthB - depthA;

  const blockA = a.launchedAt ?? 0n;
  const blockB = b.launchedAt ?? 0n;
  if (blockA !== blockB) return blockB > blockA ? 1 : -1;

  return a.symbol.localeCompare(b.symbol);
}

/**
 * Every token on this chain that the app does not already carry.
 *
 * The two reads are independent and are allowed to fail independently: an
 * endpoint that refuses `eth_getLogs` should cost the launch list and not the
 * traded one, and a reader whose network blocks the feed should still see what
 * was minted this morning.
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
      if (!chainId || !client) {
        return { tokens: [], partial: false, scannedBlocks: 0, marketEmpty: true };
      }

      const base = baseTokens(chainId);
      /* The pair token every pool on this chain is quoted against, which is
         what the feed is searched by and what it must not hand back. */
      const seeds = base
        .filter((token) => !token.native)
        .map((token) => token.address);
      const known = new Set(base.map((token) => token.address.toLowerCase()));

      const [market, launches] = await Promise.all([
        readMarketTokens(seeds).catch((): MarketToken[] => []),
        indexPonsLaunches(client, chainId).catch(() => ({
          launches: [],
          scannedBlocks: 0,
          partial: false,
        })),
      ]);

      type Entry = {
        address: `0x${string}`;
        sources: DiscoverSource[];
        market?: MarketToken;
        launch?: PonsLaunch;
        launchedAt?: bigint;
      };

      const merged = new Map<string, Entry>();

      const entryFor = (address: `0x${string}`): Entry | undefined => {
        const key = address.toLowerCase();
        if (known.has(key)) return undefined;
        const held = merged.get(key);
        if (held) return held;
        const created: Entry = { address, sources: [] };
        merged.set(key, created);
        return created;
      };

      for (const token of market) {
        const entry = entryFor(token.address);
        if (!entry) continue;
        entry.market = token;
        entry.sources.push("market");
      }

      for (const listing of launches.launches) {
        const entry = entryFor(listing.address);
        if (!entry) continue;
        entry.launch = listing.launch;
        entry.launchedAt = listing.block;
        entry.sources.push("launchpad");
      }

      const entries = [...merged.values()].slice(0, MAX_RESOLVE);
      const identities = await resolveIdentities(
        client,
        chainId,
        entries.map((entry) => entry.address),
      );

      const tokens: DiscoverToken[] = [];
      for (const entry of entries) {
        const identity = identities.get(entry.address.toLowerCase());
        if (!identity) continue;
        tokens.push({
          ...identity,
          sources: entry.sources,
          market: entry.market,
          launch: entry.launch,
          launchedAt: entry.launchedAt,
        });
      }

      tokens.sort(rank);

      return {
        tokens,
        partial: launches.partial,
        scannedBlocks: launches.scannedBlocks,
        marketEmpty: market.length === 0,
      };
    },
  });
}
