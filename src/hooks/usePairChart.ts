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

/** How many of those queries one chart is worth. */
const PAGES = 8;

/** The narrowest a chunk may shrink to before the walk gives up on it. */
const NARROWEST = 500n;

/** A starting chunk for a pool whose rate is not known. */
const OPENING = 36_000n;

/** About this many candles across, which is what fits a sheet on a phone. */
const CANDLES = 90;

type Tick = { block: number; price: number };

/**
 * Everything this pool has done, as far back as the endpoint will go.
 *
 * It will not answer a wide range in one question — the cap is somewhere near
 * five thousand logs — so the range is walked backwards in chunks instead, each
 * sized from the pool's own rate over the last five minutes. The walk stops on
 * its own when a chunk comes back empty, which is the pool's beginning and, for
 * a token the screen was built to find, usually a few chunks in. Otherwise it
 * stops when the budget runs out, and the chart shows what it reached.
 *
 * Only two numbers survive each log. The chain's main pair returns thirty-odd
 * thousand swaps over this walk, and keeping the log objects for them would
 * cost tens of megabytes on a phone to draw ninety candles.
 */
async function walk(client: PublicClient, pair: Pair, head: bigint): Promise<Tick[]> {
  const orient = (sqrt: bigint) => {
    const oneToZero = priceFrom(sqrt, pair.decimals0, pair.decimals1);
    return (pair.baseIsToken0 ? oneToZero : 1 / oneToZero) * pair.usdRate;
  };

  let span = pair.swaps > 0 ? BigInt(Math.round((3_000 * LOG_BUDGET) / pair.swaps)) : OPENING;
  let to = head;
  let pages = 0;
  const ticks: Tick[] = [];

  while (pages < PAGES && to > 0n) {
    const from = to > span ? to - span : 0n;
    let logs;
    try {
      logs = await client.getLogs({
        address: pair.pool,
        event: swapEvent,
        fromBlock: from,
        toBlock: to,
      });
    } catch {
      // Too wide for this endpoint: halve and ask again, without spending a page.
      span /= 2n;
      if (span < NARROWEST) break;
      continue;
    }

    pages++;
    for (const log of logs) {
      const sqrt = log.args.sqrtPriceX96;
      if (typeof sqrt !== "bigint" || sqrt === 0n) continue;
      const price = orient(sqrt);
      if (!Number.isFinite(price) || price <= 0) continue;
      ticks.push({ block: Number(log.blockNumber), price });
    }

    if (logs.length === 0) break;
    if (from === 0n) break;
    to = from - 1n;
  }

  return ticks;
}

/**
 * The price this pool has quoted over its life, in candles.
 *
 * Time comes from the blocks at both ends of what the walk actually reached
 * rather than from the chain's nominal hundred milliseconds. An average is
 * wrong by minutes once it has been multiplied by two hundred thousand blocks,
 * so both ends are asked and everything between is placed on the line joining
 * them.
 */
async function read(client: PublicClient, pair: Pair): Promise<Candle[]> {
  const head = await client.getBlockNumber();
  const ticks = await walk(client, pair, head);
  if (ticks.length === 0) return [];

  ticks.sort((a, b) => a.block - b.block);
  const first = ticks[0].block;
  const last = ticks[ticks.length - 1].block;
  const reach = Math.max(1, last - first);

  const [opened, closed] = await Promise.all([
    client.getBlock({ blockNumber: BigInt(first) }),
    client.getBlock({ blockNumber: BigInt(last) }),
  ]);
  const startedAt = Number(opened.timestamp);
  const seconds = Number(closed.timestamp) - startedAt;
  const at = (block: number) => startedAt + ((block - first) / reach) * seconds;

  const width = Math.max(1, Math.floor(reach / CANDLES));
  const buckets = new Map<number, Candle>();

  for (const tick of ticks) {
    const slot = Math.floor((tick.block - first) / width);
    const held = buckets.get(slot);
    if (!held) {
      buckets.set(slot, {
        time: Math.round(at(first + slot * width)),
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      });
      continue;
    }
    held.high = Math.max(held.high, tick.price);
    held.low = Math.min(held.low, tick.price);
    held.close = tick.price;
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
