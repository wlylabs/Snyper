"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { readLock, type Lock } from "@/lib/lock";
import { cachedLock, rememberLock } from "@/lib/lockCache";

/**
 * One question, asked the same way wherever it is asked from.
 *
 * The list and the sheet share a key, which is the point: a reader who scrolls
 * past a row and then opens it is asking about the same pool, and paying for a
 * pool twice is most of what makes this expensive. What they do not share is
 * how long they will trust an answer — see the two hooks below.
 */
function lockQuery(client: PublicClient | undefined, pool: `0x${string}` | undefined) {
  const held = pool ? cachedLock(pool) : undefined;
  return {
    queryKey: ["lock", pool?.toLowerCase()] as const,
    queryFn: async () => {
      const lock = await readLock(client as PublicClient, pool as `0x${string}`);
      if (pool) rememberLock(pool, lock);
      return lock;
    },
    /*
     * A reading kept from a previous visit, handed over as though it had just
     * been fetched — with the time it was actually taken, so the staleness each
     * caller sets is measured from the reading and not from this mount.
     */
    initialData: held?.lock,
    initialDataUpdatedAt: held?.at,
    refetchOnWindowFocus: false,
  };
}

/** How long the list will go on believing a reading it did not take. */
const LIST_STALE = 10 * 60 * 1000;

/** How long the sheet will. Shorter, because this is the screen people act on. */
const SHEET_STALE = 60_000;

/**
 * The lock under one pair, for the sheet a reader opened.
 *
 * Deliberately less trusting than the list. A badge in a list is something
 * glanced at while scrolling; this is the panel above the button that buys the
 * token, so a reading more than a minute old is taken again rather than shown.
 * Both observers sit on the same cached query, so the list keeps showing what
 * it had while the fresher read is in flight.
 */
export function useLiquidityLock(pool: `0x${string}` | undefined, enabled = true) {
  const client = usePublicClient({ chainId: CHAIN_ID });

  const query = useQuery({
    ...lockQuery(client, pool),
    enabled: Boolean(client && pool && enabled),
    staleTime: SHEET_STALE,
    retry: 1,
  });

  return {
    lock: query.data,
    loading: query.isPending && Boolean(pool) && enabled,
    failed: query.isError,
  };
}

/**
 * How many pools are read at once.
 *
 * Three. The ceiling is not the browser's, it is the chain's: this app already
 * reads the market through one endpoint that answers a wide scan grudgingly and
 * a burst with a 429, and a list of thirty rows fired at once is roughly a
 * hundred requests arriving together. Three keeps the fill in the background of
 * a screen the reader is already using, which is the only speed it needs — a
 * badge is not worth a refused market scan behind it.
 */
const AT_ONCE = 3;

/**
 * How far down the list the fill goes.
 *
 * The list is ordered by what is busiest, so the rows a reader will actually
 * look at are the ones at the top, and a row nobody scrolls to is a pool read
 * for nothing. Thirty covers every row the screener will show plus room.
 */
const FILL_DEPTH = 30;

/**
 * The lock under every pair on screen, filled in a few at a time.
 *
 * Everything already read comes back on the first render — from this session's
 * cache or from the shelf a previous visit left — so a reader returning to the
 * list sees the badges immediately and the chain is asked only about pools
 * nothing has answered for yet. Those are admitted in list order, a few at a
 * time, and a row that has not had its turn yet renders without a badge rather
 * than with a placeholder: an answer that has not arrived is not a state a
 * reader needs shown, and thirty spinners are not a list.
 */
export function useLiquidityLocks(pools: readonly `0x${string}`[]) {
  const client = usePublicClient({ chainId: CHAIN_ID });

  const wanted = useMemo(() => pools.slice(0, FILL_DEPTH), [pools]);

  /**
   * Which pools have been let through, by address rather than by position.
   *
   * Two earlier shapes of this stalled, and both stalled for the same reason:
   * they described the fill in terms of where a pool sat in the list. The list
   * is re-sorted by volume on every market scan, so a pool's position is not a
   * fact about it — gating on one meant the fill restarted every few seconds
   * and never reached the bottom of the list. A set of addresses only grows,
   * survives a reorder, and survives a pool leaving the list and coming back.
   */
  const [admitted, setAdmitted] = useState<readonly string[]>([]);
  const isAdmitted = useMemo(() => new Set(admitted), [admitted]);

  const results = useQueries({
    queries: wanted.map((pool) => ({
      ...lockQuery(client, pool),
      enabled: Boolean(client) && isAdmitted.has(pool.toLowerCase()),
      staleTime: LIST_STALE,
      /*
       * More patient than the sheet, and slower each time.
       *
       * Reading a pool is eight calls, a screenful of them is two hundred, and
       * the endpoint answers a burst of those with a refusal rather than an
       * error — so the rows that miss are rarely unreadable, they are queued
       * behind the rows that went first. An immediate retry rejoins the same
       * crowd; backing off to a second, then three, then nine puts the request
       * somewhere the crowd has already left. Nothing is waiting on this, so
       * slow is free — the row it fills is one the reader has not scrolled to.
       */
      retry: 3,
      retryDelay: (attempt: number) => Math.min(1_000 * 3 ** attempt, 15_000),
    })),
  });

  /**
   * Let through and still owing an answer.
   *
   * Not `isFetching`, which is the trap the first version fell into: a query
   * enabled in this pass has not started fetching yet, so every run of the
   * effect saw an idle pipe and opened the gate again until the whole list had
   * left at once and the endpoint refused half of it. A pool counts against the
   * budget from the moment it is admitted, whatever react-query is doing with
   * it, so the gate can only be read one way.
   */
  const owing = wanted.filter((pool, index) => {
    if (!isAdmitted.has(pool.toLowerCase())) return false;
    const result = results[index];
    return !(result?.isSuccess || result?.isError);
  }).length;

  useEffect(() => {
    if (!client) return;
    const room = AT_ONCE - owing;
    if (room <= 0) return;
    const next = wanted
      .map((pool) => pool.toLowerCase())
      .filter((pool) => !isAdmitted.has(pool))
      .slice(0, room);
    if (next.length > 0) setAdmitted((held) => [...held, ...next]);
  }, [client, wanted, isAdmitted, owing]);

  return useMemo(() => {
    const byPool = new Map<string, Lock>();
    wanted.forEach((pool, index) => {
      const lock = results[index]?.data;
      if (lock) byPool.set(pool.toLowerCase(), lock);
    });
    return byPool;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, results.map((result) => result.dataUpdatedAt).join()]);
}
