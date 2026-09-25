"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type GetLogsReturnType, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { REFERENCE_FEE, WINDOW, poolAbi, priceFrom, quoteFor, swapEvent } from "@/lib/screener";
import { VENUE, factoryAbi } from "@/lib/venue";

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/**
 * How many `WINDOW`-sized chunks a refresh asks for.
 *
 * `WINDOW` is 3,000 blocks because that is what the endpoint will answer for a
 * `Swap` scan in one request, whatever the scan is filtered to — the refusal is
 * about how much chain it has to look through, not how much it finds. Filtered
 * to one wallet's own trades the request comes back in one round trip instead
 * of the many `swapsIn` sometimes needs for the whole market, so ten chunks —
 * the last fifty minutes — is affordable in a way ten market-wide ones would
 * not be, and it is asked for in one breath rather than only when it is short.
 */
const CHUNKS = 10;

/** One fill, read back from the swap itself rather than kept anywhere. */
export type Fill = {
  hash: `0x${string}`;
  block: bigint;
  pool: `0x${string}`;
  token: `0x${string}`;
  symbol: string;
  quote: string;
  side: "buy" | "sell";
  tokenAmount: number;
  usd: number;
};

type SwapLog = GetLogsReturnType<typeof swapEvent>[number];

/**
 * Every swap this wallet was the recipient of, across the last ten windows.
 *
 * `recipient` is indexed on the event, which is what makes this possible
 * without a contract of this app's own to log into: both the buy path in the
 * terminal and the sell path off the balance screen name the connected wallet
 * as the recipient, so the chain is already holding the ledger. Fetched in
 * parallel rather than by paging backward one refusal at a time, because each
 * piece is the size the endpoint already answers for.
 */
async function fillsIn(client: PublicClient, owner: `0x${string}`, head: bigint): Promise<SwapLog[]> {
  const spans = await Promise.all(
    Array.from({ length: CHUNKS }, (_, index) => {
      const to = head - WINDOW * BigInt(index);
      const from = to - WINDOW + 1n;
      return from < 0n
        ? []
        : client.getLogs({ event: swapEvent, args: { recipient: owner }, fromBlock: from, toBlock: to });
    }),
  );
  return spans.flat().sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

async function read(
  client: PublicClient,
  owner: `0x${string}` | undefined,
): Promise<{ fills: Fill[]; head: bigint | undefined }> {
  if (!owner) return { fills: [], head: undefined };

  const head = await client.getBlockNumber();
  const logs = await fillsIn(client, owner, head);
  if (logs.length === 0) return { fills: [], head };

  const pools = [...new Set(logs.map((log) => log.address.toLowerCase()))] as `0x${string}`[];
  const sides = await client.multicall({
    allowFailure: true,
    batchSize: ONE_CALL,
    contracts: [
      ...pools.flatMap((pool) => [
        { address: pool, abi: poolAbi, functionName: "token0" } as const,
        { address: pool, abi: poolAbi, functionName: "token1" } as const,
      ]),
      {
        address: VENUE.factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [VENUE.wrapped, VENUE.stable, REFERENCE_FEE],
      } as const,
    ],
  });

  /*
   * A pair needs one side this app can price and one it cannot — two quote
   * tokens or two unknown ones is a pool this screen has no honest price for,
   * same test `useScreener` applies to the market list.
   */
  const poolSides = new Map<string, { base: `0x${string}`; quoteToken: `0x${string}`; baseIsToken0: boolean }>();
  pools.forEach((pool, index) => {
    const token0 = sides[index * 2];
    const token1 = sides[index * 2 + 1];
    if (token0?.status !== "success" || token1?.status !== "success") return;
    const a = token0.result as `0x${string}`;
    const b = token1.result as `0x${string}`;
    const aIsQuote = Boolean(quoteFor(a));
    const bIsQuote = Boolean(quoteFor(b));
    if (aIsQuote === bIsQuote) return;
    poolSides.set(pool, { base: aIsQuote ? b : a, quoteToken: aIsQuote ? a : b, baseIsToken0: !aIsQuote });
  });

  const referencePool = sides[pools.length * 2];
  const tokens = [...new Set([...poolSides.values()].map((side) => side.base.toLowerCase()))] as `0x${string}`[];

  const detailOffset = referencePool?.status === "success" ? 1 : 0;
  const details = await client.multicall({
    allowFailure: true,
    batchSize: ONE_CALL,
    contracts: [
      ...(referencePool?.status === "success"
        ? [{ address: referencePool.result as `0x${string}`, abi: poolAbi, functionName: "slot0" } as const]
        : []),
      ...tokens.flatMap((token) => [
        { address: token, abi: erc20Abi, functionName: "symbol" } as const,
        { address: token, abi: erc20Abi, functionName: "decimals" } as const,
      ]),
    ],
  });

  /* What a WETH figure is worth beside a USDG one. See `useScreener`. */
  const priced = detailOffset > 0 ? details[0] : undefined;
  const ethUsd =
    priced?.status === "success" && Array.isArray(priced.result)
      ? priceFrom(priced.result[0] as bigint, 18, 6)
      : undefined;
  const inUsd = (symbol: string) => (symbol === "USDG" ? 1 : (ethUsd ?? 0));

  const tokenMeta = new Map<string, { symbol: string; decimals: number }>();
  tokens.forEach((token, index) => {
    const at = detailOffset + index * 2;
    const symbol = details[at];
    const decimals = details[at + 1];
    tokenMeta.set(token, {
      symbol: symbol?.status === "success" && typeof symbol.result === "string" ? symbol.result : "—",
      decimals: decimals?.status === "success" ? Number(decimals.result) : 18,
    });
  });

  const fills: Fill[] = [];
  for (const log of logs) {
    const pool = log.address.toLowerCase() as `0x${string}`;
    const side = poolSides.get(pool);
    if (!side || !log.transactionHash) continue;
    const quote = quoteFor(side.quoteToken);
    const meta = tokenMeta.get(side.base.toLowerCase());
    if (!quote || !meta) continue;

    const amount0 = log.args.amount0 ?? 0n;
    const amount1 = log.args.amount1 ?? 0n;
    /* Positive is that side arriving in the pool — see `useScreener`. */
    const quoteAmount = side.baseIsToken0 ? amount1 : amount0;
    const baseAmount = side.baseIsToken0 ? amount0 : amount1;
    const rate = inUsd(quote.symbol);

    fills.push({
      hash: log.transactionHash,
      block: log.blockNumber,
      pool,
      token: side.base,
      symbol: meta.symbol,
      quote: quote.symbol,
      side: quoteAmount > 0n ? "buy" : "sell",
      tokenAmount: Math.abs(Number(baseAmount)) / 10 ** meta.decimals,
      usd: (Math.abs(Number(quoteAmount)) / 10 ** quote.decimals) * rate,
    });
  }

  return { fills, head };
}

/**
 * What this wallet has bought and sold through this app, live.
 *
 * This is a trade log and not a cost basis — the opposite of what `useAppStore`
 * keeps — and it is read rather than remembered for the same reason the basis
 * is remembered rather than read: the chain already carries every fill, so
 * keeping a second copy would only be a second copy to disagree with it.
 */
export function useActivity() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();

  const query = useQuery({
    queryKey: ["activity", address?.toLowerCase()],
    queryFn: () => read(client as PublicClient, address),
    enabled: Boolean(client) && Boolean(address),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  return {
    fills: query.data?.fills ?? [],
    head: query.data?.head,
    loading: query.isPending,
    error: query.isError,
    refetch: query.refetch,
  };
}
