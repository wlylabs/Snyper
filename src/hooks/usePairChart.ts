"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { priceFrom, swapEvent } from "@/lib/screener";
import type { Pair } from "./useScreener";

export type Candle = {
  /** Seconds, which is what the chart library reads. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** What one query will carry before the endpoint refuses it. */
const LOG_BUDGET = 4_000;

/** Never look further back than this, however quiet the pool. */
const DEEPEST = 216_000n;

/** Nor less far than this, however busy. */
const SHALLOWEST = 3_000n;

/** About this many candles across, which is what fits a sheet on a phone. */
const CANDLES = 60;

/**
 * How far back this pool can be read in one question.
 *
 * The endpoint caps what a single query returns at somewhere near five
 * thousand logs, and a pool's rate over the last five minutes is the only
 * estimate of its rate available before asking. So the span is the budget
 * divided by that rate — a pool doing two swaps a minute is read for six
 * hours, and the chain's main pair for a few minutes — which spends the one
 * query on as much history as it will hold rather than on a fixed window that
 * is too long for the busy and too short for everything else.
 */
function spanFor(swaps: number): bigint {
  if (swaps <= 0) return DEEPEST;
  const blocks = (Number(SHALLOWEST) * LOG_BUDGET) / swaps;
  const span = BigInt(Math.round(blocks));
  if (span > DEEPEST) return DEEPEST;
  if (span < SHALLOWEST) return SHALLOWEST;
  return span;
}

/**
 * The price this pool quoted, over as much of the recent past as it will give.
 *
 * Time comes from the two blocks at the ends of the range rather than from the
 * chain's nominal block time. A hundred milliseconds is an average, and an
 * average is wrong by minutes once it has been multiplied by two hundred
 * thousand blocks — so both ends are asked, and everything between is placed
 * on the line joining them.
 */
async function read(client: PublicClient, pair: Pair): Promise<Candle[]> {
  const head = await client.getBlockNumber();
  const span = spanFor(pair.swaps);
  const from = head - span;

  const [logs, first, last] = await Promise.all([
    client.getLogs({ address: pair.pool, event: swapEvent, fromBlock: from, toBlock: head }),
    client.getBlock({ blockNumber: from }),
    client.getBlock({ blockNumber: head }),
  ]);
  if (logs.length === 0) return [];

  const startedAt = Number(first.timestamp);
  const seconds = Number(last.timestamp) - startedAt;
  const at = (block: bigint) => startedAt + (Number(block - from) / Number(span)) * seconds;

  const orient = (sqrt: bigint) => {
    const oneToZero = priceFrom(sqrt, pair.decimals0, pair.decimals1);
    return (pair.baseIsToken0 ? oneToZero : 1 / oneToZero) * pair.usdRate;
  };

  const width = Math.max(1, Math.floor(Number(span) / CANDLES));
  const buckets = new Map<number, Candle>();

  for (const log of logs) {
    const sqrt = log.args.sqrtPriceX96;
    if (typeof sqrt !== "bigint" || sqrt === 0n) continue;
    const price = orient(sqrt);
    if (!Number.isFinite(price) || price <= 0) continue;

    const slot = Math.floor(Number(log.blockNumber - from) / width);
    const held = buckets.get(slot);
    if (!held) {
      const time = Math.round(at(from + BigInt(slot * width)));
      buckets.set(slot, { time, open: price, high: price, low: price, close: price });
      continue;
    }
    held.high = Math.max(held.high, price);
    held.low = Math.min(held.low, price);
    held.close = price;
  }

  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, candle]) => candle);
}

export function usePairChart(pair: Pair | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID });

  const query = useQuery({
    queryKey: ["pair-chart", pair?.pool],
    queryFn: () => read(client as PublicClient, pair as Pair),
    enabled: Boolean(client && pair),
    staleTime: 30_000,
  });

  return { candles: query.data ?? [], loading: query.isPending, error: query.error };
}
