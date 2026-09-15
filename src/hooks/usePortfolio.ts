"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useLiveNative } from "@/hooks/useLiveNative";
import { erc20Abi } from "@/lib/abi";
import { dexMeta } from "@/lib/chains";
import { readIndexedPortfolio, type IndexedPortfolio } from "@/lib/portfolioFeed";
import { midPrice } from "@/lib/quote";
import { readFeedQuotes, type FeedQuote } from "@/lib/tokenFeed";
import { nativeToken, routingAddress, type Token } from "@/lib/tokens";

/**
 * Where a price came from, in descending order of how much money stands behind
 * it. Worth carrying because the four are not interchangeable: a market feed
 * has aggregated every pair a token trades in, an indexer's quote may be a
 * ticker match against a token on another chain entirely, and a pool mid price
 * is whatever the last trade — or the initialising mint — left behind.
 */
export type PriceSource = "feed" | "indexer" | "pool" | "stable";

export type Holding = {
  token: Token;
  balance: bigint;
  amount: number;
  /** USD value, undefined when no source could price the token. */
  value?: number;
  price?: number;
  /**
   * What the whole token is worth: circulating cap where a feed reports one,
   * otherwise fully diluted. The number a memecoin is actually read by — price
   * alone is that figure divided by a supply each launch picks arbitrarily, so
   * two tokens at the same price are not comparable and two at the same cap are.
   */
  marketCap?: number;
  /** True when `marketCap` is fully diluted rather than circulating. */
  diluted?: boolean;
  /** Dollars in the deepest pair, when a feed reported any. */
  liquidity?: number;
  /** Fraction, 0.01 = 1%, over the last day. */
  change24h?: number;
  totalSupply?: bigint;
  priceSource?: PriceSource;
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

/** How many contracts one pass asks for a supply, to bound the multicall. */
const MAX_SUPPLY_READS = 60;

/**
 * A cap past which the price behind it is not a moonshot but a bad reading.
 *
 * Nothing on this chain is worth a trillion dollars, so a price that implies it
 * came from somewhere that answered about a different token — a ticker matched
 * against another chain's listing is the usual way — or from a pool that holds
 * its initialising price and has never traded. Dropping the price leaves the
 * holding unpriced, which the page already knows how to say, and which is a
 * better answer than a confident wrong one on the screen a reader checks their
 * wallet against.
 */
const IMPLAUSIBLE_CAP = 1e12;

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
 * Total supply for each contract, so a price can be turned into a cap.
 *
 * Read from the chain rather than taken from a feed: the feed may not cover
 * this chain at all, and `totalSupply` is one word of storage every ERC-20 has.
 * It doubles as the meme heuristic's supply signal, which is why the figure is
 * kept on the holding rather than consumed here.
 */
async function readSupplies(
  client: PublicClient,
  holdings: Holding[],
): Promise<Map<string, bigint>> {
  const supplies = new Map<string, bigint>();
  const targets = holdings
    .filter((holding) => !holding.token.native)
    .slice(0, MAX_SUPPLY_READS);
  if (targets.length === 0) return supplies;

  const results = await client
    .multicall({
      allowFailure: true,
      contracts: targets.map((holding) => ({
        address: holding.token.address,
        abi: erc20Abi,
        functionName: "totalSupply" as const,
      })),
    })
    .catch(() => []);

  targets.forEach((holding, index) => {
    const entry = results[index];
    if (!entry || entry.status !== "success") return;
    const supply = entry.result as bigint;
    if (supply > 0n) supplies.set(holding.token.address.toLowerCase(), supply);
  });
  return supplies;
}

/**
 * Puts a dollar figure on each holding, best source first.
 *
 * The market price is the one a reader recognises, because it is the number
 * their wallet, their chart and every aggregator are showing at the same
 * moment. The pool's own mid price is the fallback rather than the default: it
 * is the truth about one pool on one venue, and a portfolio priced that way
 * disagrees with every other screen the reader has open.
 *
 * Whatever the source, the price is then made to answer for itself. A cap is
 * worked out from the chain's own supply and, where that comes out absurd, the
 * price is dropped rather than shown — see `IMPLAUSIBLE_CAP`.
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

  const [market, supplies] = await Promise.all([
    readFeedQuotes(holdings.map((holding) => routingAddress(holding.token))),
    readSupplies(client, holdings),
  ]);

  const priced = (holding: Holding, price: number, source: PriceSource): Holding => ({
    ...holding,
    price,
    value: holding.amount * price,
    priceSource: source,
  });

  const valued = holdings.map((holding) => {
    const address = holding.token.address.toLowerCase();
    const routed = routingAddress(holding.token).toLowerCase();
    const withSupply = { ...holding, totalSupply: supplies.get(address) };

    // The USD unit prices itself; asking a feed what a dollar is worth invites
    // a depeg reading into a figure the whole page is denominated in.
    if (stableAddress && address === stableAddress) {
      return priced(withSupply, 1, "stable");
    }

    const quote: FeedQuote | undefined = market.get(routed);
    if (quote) {
      return {
        ...priced(withSupply, quote.priceUsd, "feed"),
        ...(quote.liquidityUsd !== undefined ? { liquidity: quote.liquidityUsd } : {}),
        ...(quote.change24h !== undefined ? { change24h: quote.change24h } : {}),
        ...(quote.marketCapUsd !== undefined
          ? { marketCap: quote.marketCapUsd }
          : quote.fdvUsd !== undefined
            ? { marketCap: quote.fdvUsd, diluted: true }
            : {}),
      };
    }

    const indexed = indexedPrices.get(address);
    return indexed === undefined ? withSupply : priced(withSupply, indexed, "indexer");
  });

  // Whatever no feed knew about, and the chain can still answer for: a pool
  // against the USD unit, one round trip per token, deepest holdings first.
  const stable = stableAddress
    ? tokens.find((token) => token.address.toLowerCase() === stableAddress)
    : undefined;

  if (stable) {
    const pending = valued
      .map((holding, index) => ({ holding, index }))
      .filter((entry) => entry.holding.price === undefined)
      .slice(0, MAX_POOL_PRICED);

    const pooled = await Promise.all(
      pending.map(async ({ holding, index }) => {
        try {
          const mid = await midPrice(client, holding.token, stable);
          if (!mid) return undefined;
          return { index, holding: priced(holding, mid.price, "pool") };
        } catch {
          return undefined;
        }
      }),
    );

    for (const entry of pooled) {
      if (entry) valued[entry.index] = entry.holding;
    }
  }

  return valued.map(withMarketCap);
}

/**
 * Fills in the cap a price implies, and throws the price away when that cap is
 * not a number anything on this chain could be worth.
 */
function withMarketCap(holding: Holding): Holding {
  if (holding.price === undefined) return holding;
  if (holding.priceSource === "stable" || holding.token.native) return holding;

  const supply =
    holding.totalSupply === undefined
      ? undefined
      : Number(formatUnits(holding.totalSupply, holding.token.decimals));

  const implied =
    supply !== undefined && Number.isFinite(supply) && supply > 0
      ? supply * holding.price
      : undefined;

  const cap = holding.marketCap ?? implied;

  if (cap !== undefined && cap > IMPLAUSIBLE_CAP) {
    return {
      ...holding,
      price: undefined,
      value: undefined,
      marketCap: undefined,
      diluted: undefined,
      priceSource: undefined,
    };
  }

  if (holding.marketCap !== undefined || implied === undefined) return holding;
  return { ...holding, marketCap: implied, diluted: true };
}

/**
 * The coin row, carrying the balance the live read returned rather than the one
 * the timed query found.
 *
 * Only the coin, and only its balance: everything else here is as old as the
 * last portfolio pass, and refreshing one number inside a row of stale ones
 * would be worse than refreshing none. The list is deliberately not re-sorted
 * either — a row that jumps position while its own figure ticks is harder to
 * read than one slightly out of order.
 */
function withLiveNative(
  portfolio: Portfolio | undefined,
  balance: bigint | undefined,
  chainId: number | undefined,
): Portfolio | undefined {
  if (!portfolio || balance === undefined || !chainId) return portfolio;

  const index = portfolio.holdings.findIndex((holding) => holding.token.native);

  // A wallet that was empty when the query ran and has since been funded: the
  // coin earns its row now rather than at the next timed read.
  if (index === -1) {
    const native = nativeToken(chainId);
    if (!native || balance <= 0n) return portfolio;
    return { ...portfolio, holdings: [holdingOf(native, balance), ...portfolio.holdings] };
  }

  const current = portfolio.holdings[index];
  if (current.balance === balance) return portfolio;

  const amount = amountOf(balance, current.token.decimals);
  const holdings = [...portfolio.holdings];
  holdings[index] = {
    ...current,
    balance,
    amount,
    value: current.price === undefined ? undefined : amount * current.price,
  };
  return { ...portfolio, holdings };
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
  const live = useLiveNative(chainId);

  const query = useQuery<Portfolio>({
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

  /*
   * Spreading the query result opts out of react-query's tracked-property
   * optimisation, which is the price of handing callers one object with the
   * live balance already in it. The alternative — every caller merging two
   * sources by hand — is how one screen ends up disagreeing with another.
   */
  const data = useMemo(
    () => withLiveNative(query.data, live, chainId),
    [query.data, live, chainId],
  );

  return { ...query, data };
}
