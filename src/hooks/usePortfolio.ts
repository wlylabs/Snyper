"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/abi";
import { dexMeta } from "@/lib/chains";
import { readIndexedPortfolio, type IndexedPortfolio } from "@/lib/portfolioFeed";
import { midPrice } from "@/lib/quote";
import { readFeedPrices } from "@/lib/tokenFeed";
import { nativeToken, routingAddress, type Token } from "@/lib/tokens";

export type Holding = {
  token: Token;
  balance: bigint;
  amount: number;
  /** USD value, undefined when no source could price the token. */
  value?: number;
  price?: number;
};

/**
 * Where the list of tokens came from. `indexer` means everything the address
 * holds; `chain` means only what the app already knew to ask about, which is a
 * different and much shorter answer worth saying out loud.
 */
export type HoldingSource = "indexer" | "chain";

export type Portfolio = {
  holdings: Holding[];
  source: HoldingSource;
};

/** How many tokens are worth pricing against a pool, one round trip each. */
const MAX_POOL_PRICED = 24;

/**
 * Whole units of a balance. Scaling the raw integer by a power of ten would
 * round it through a float twice — once past 2^53, once on a decimals count
 * that has no exact float — and a wallet comparing this against its own display
 * would find the last digits disagree. `formatUnits` does the scaling in
 * integer arithmetic and only then meets a float.
 */
function amountOf(balance: bigint, decimals: number): number {
  return Number(formatUnits(balance, decimals));
}

function holdingOf(token: Token, balance: bigint): Holding {
  return { token, balance, amount: amountOf(balance, token.decimals) };
}

/**
 * The indexer's rows as tokens this app understands.
 *
 * What the app already knows about a token wins over what the indexer says: a
 * reader who imported a contract named it in the picker, and a third party's
 * copy should not overwrite that. The indexer only covers what nothing else
 * answered.
 */
function fromIndexed(
  indexed: IndexedPortfolio,
  chainId: number,
  known: Map<string, Token>,
): Holding[] {
  return indexed.tokens.map((row) => {
    const existing = known.get(row.address.toLowerCase());
    const token: Token = existing ?? {
      chainId,
      address: row.address,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
    };
    return holdingOf(token, row.balance);
  });
}

/** Balances for tokens the indexer did not cover, read straight off the chain. */
async function fromChain(
  client: PublicClient,
  address: `0x${string}`,
  tokens: Token[],
): Promise<Holding[]> {
  if (tokens.length === 0) return [];

  const results = await client.multicall({
    allowFailure: true,
    contracts: tokens.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address] as const,
    })),
  });

  const holdings: Holding[] = [];
  tokens.forEach((token, index) => {
    const entry = results[index];
    if (!entry || entry.status !== "success") return;
    const balance = entry.result as bigint;
    if (balance <= 0n) return;
    holdings.push(holdingOf(token, balance));
  });
  return holdings;
}

/**
 * Puts a dollar figure on each holding, best source first.
 *
 * The market price is the one a reader recognises, because it is the number
 * their wallet, their chart and every aggregator are showing at the same
 * moment. The pool's own mid price is the fallback rather than the default: it
 * is the truth about one pool on one venue, and a portfolio priced that way
 * disagrees with every other screen the reader has open.
 */
async function priceHoldings(
  client: PublicClient,
  chainId: number,
  holdings: Holding[],
  tokens: Token[],
  indexedPrices: Map<string, number>,
): Promise<Holding[]> {
  const dex = dexMeta(chainId);
  const stableAddress = dex?.stable?.toLowerCase();

  const market = await readFeedPrices(
    holdings.map((holding) => routingAddress(holding.token)),
  );

  const valued = holdings.map((holding) => {
    const address = holding.token.address.toLowerCase();
    const routed = routingAddress(holding.token).toLowerCase();

    // The USD unit prices itself; asking a feed what a dollar is worth invites
    // a depeg reading into a figure the whole page is denominated in.
    if (stableAddress && address === stableAddress) {
      return { ...holding, price: 1, value: holding.amount };
    }

    const price = market.get(routed) ?? indexedPrices.get(address);
    return price === undefined
      ? holding
      : { ...holding, price, value: holding.amount * price };
  });

  // Whatever no feed knew about, and the chain can still answer for: a pool
  // against the USD unit, one round trip per token, deepest holdings first.
  if (!stableAddress) return valued;
  const stable = tokens.find((token) => token.address.toLowerCase() === stableAddress);
  if (!stable) return valued;

  const pending = valued
    .map((holding, index) => ({ holding, index }))
    .filter((entry) => entry.holding.price === undefined)
    .slice(0, MAX_POOL_PRICED);

  const pooled = await Promise.all(
    pending.map(async ({ holding, index }) => {
      try {
        const mid = await midPrice(client, holding.token, stable);
        if (!mid) return undefined;
        return {
          index,
          holding: { ...holding, price: mid.price, value: holding.amount * mid.price },
        };
      } catch {
        return undefined;
      }
    }),
  );

  for (const entry of pooled) {
    if (entry) valued[entry.index] = entry.holding;
  }

  return valued;
}

/**
 * What an address holds, and what it is worth.
 *
 * The holdings list is asked of the chain's own indexer, which is how every
 * wallet a reader might compare this against answers the same question — the
 * chain can say how much of a named token an address holds, and cannot say
 * which tokens to name. The chain stays the authority for the coin balance and
 * for anything the indexer missed, and takes over entirely when it is down.
 */
export function usePortfolio(chainId: number | undefined, tokens: Token[]) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId });

  return useQuery<Portfolio>({
    queryKey: [
      "portfolio",
      chainId,
      address,
      tokens.map((token) => token.address).join(","),
    ],
    enabled: Boolean(client && address && chainId),
    refetchInterval: 45_000,
    staleTime: 20_000,
    queryFn: async (): Promise<Portfolio> => {
      if (!client || !address || !chainId) return { holdings: [], source: "chain" };

      const indexed = await readIndexedPortfolio(address);
      const covered = new Set(
        indexed?.tokens.map((row) => row.address.toLowerCase()) ?? [],
      );

      /*
       * Everything the app knows about that the indexer did not report. On the
       * fallback path that is the whole scope; on the indexed path it is the
       * short tail an indexer can lag behind on — the token a reader bought
       * thirty seconds ago being the one that matters.
       */
      const uncovered = tokens.filter(
        (token) => !token.native && !covered.has(token.address.toLowerCase()),
      );

      const [nativeBalance, chainHoldings] = await Promise.all([
        client.getBalance({ address }),
        fromChain(client, address, uncovered),
      ]);

      const known = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
      const holdings: Holding[] = [];

      // The coin balance is read from the chain either way: it is the one
      // number a reader is about to spend on gas, and it is a single call.
      const native = tokens.find((token) => token.native) ?? nativeToken(chainId);
      if (native && nativeBalance > 0n) holdings.push(holdingOf(native, nativeBalance));

      if (indexed) holdings.push(...fromIndexed(indexed, chainId, known));
      holdings.push(...chainHoldings);

      const indexedPrices = new Map(
        (indexed?.tokens ?? []).flatMap((row) =>
          row.priceUsd === undefined ? [] : [[row.address.toLowerCase(), row.priceUsd]],
        ),
      );

      const priced = await priceHoldings(
        client,
        chainId,
        holdings,
        tokens,
        indexedPrices,
      );

      return {
        holdings: priced.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
        source: indexed ? "indexer" : "chain",
      };
    },
  });
}
