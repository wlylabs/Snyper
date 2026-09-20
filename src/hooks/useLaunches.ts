"use client";

import { useMemo } from "react";
import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { BURNED, PER_MINUTE, isEquity, poolAbi, priceFrom, quoteFor } from "@/lib/screener";
import { useCoinUsd } from "./useCoinUsd";
import type { Birth, Pair } from "./useScreener";

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/**
 * How many of the day's launches get described in full.
 *
 * Pricing every one of them would be three thousand reads. Forty is where the
 * endpoint is comfortable, and which forty is the whole question — see the note
 * on the two passes below.
 */
const LAUNCHES = 40;

/** A bound on the first pass, so a strange day cannot make it unbounded. */
const SCANNED = 400;

/** Reads per launch in the second pass: see the contracts it assembles. */
const READS = 5 + BURNED.length;

/**
 * The day's launches, priced.
 *
 * The other list is built from swaps, which means a pair nobody traded in the
 * last five minutes is not on it however recently it opened. That is the right
 * rule for a screen about what is moving and the wrong one for a screen about
 * what is new: a token that launched forty minutes ago and has been quiet since
 * is exactly what somebody looking for an early entry wants to see, and it was
 * invisible.
 *
 * Everything here is read rather than inferred. A pool with no swap in the
 * window has no price to take from a log, so the price comes from what the pool
 * itself is quoting; the depth comes from what is resting in it; the supply
 * comes from the token. Volume and movement are reported as nothing rather than
 * guessed, because nothing is what happened.
 *
 * It runs only when a reader opens the list. The launches themselves cost no
 * request — `useScreener` already reads a day of them to date the pairs that
 * are new — but pricing them is a call of its own, and a reader who never opens
 * this tab should not pay for it.
 */
export function useLaunches(births: Birth[], head: bigint | undefined, enabled: boolean) {
  const coinUsd = useCoinUsd();
  const scanned = useMemo(() => births.slice(0, SCANNED), [births]);

  /*
   * First pass: how much is resting in each of them, and nothing else.
   *
   * This is the read that decides which launches are worth describing, so it
   * has to cover all of them — and it can, because it is one call per pool. A
   * measured day: three hundred and seventy-nine launches, three hundred and
   * thirteen with something in them, twenty with a hundred dollars, eight with
   * a thousand. Taking the newest forty and pricing those found one of the
   * eight. The day's launches are overwhelmingly empty pools, and recency alone
   * cannot tell them apart from the real ones.
   */
  const depths = useReadContracts({
    contracts: scanned.map(
      (birth) =>
        ({
          address: birth.quoteToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [birth.pool],
          chainId: CHAIN_ID,
        }) as const,
    ),
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: enabled && scanned.length > 0, staleTime: 30_000 },
  });

  /*
   * The forty deepest, then back into the order they opened in.
   *
   * Deepest rather than newest, because a pool with four dollars in it is not
   * an entry at any age; newest within that, because among pools that can
   * actually be traded the fresh one is the point of the screen. Forty is a
   * capacity limit and the screen says so rather than implying it has shown
   * everything.
   */
  const taken = useMemo(() => {
    if (!depths.data) return [];
    const measured = scanned
      .map((birth, index) => {
        const outcome = depths.data[index];
        if (outcome?.status !== "success" || typeof outcome.result !== "bigint") return undefined;
        const quote = quoteFor(birth.quoteToken);
        if (!quote) return undefined;
        const rate = quote.symbol === "USDG" ? 1 : coinUsd;
        if (rate === undefined) return undefined;
        return { birth, liquidity: (Number(outcome.result) / 10 ** quote.decimals) * rate };
      })
      .filter((entry): entry is { birth: Birth; liquidity: number } => entry !== undefined)
      .filter((entry) => entry.liquidity > 0);

    return measured
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, LAUNCHES)
      .sort((a, b) => Number(b.birth.block - a.birth.block));
  }, [depths.data, scanned, coinUsd]);

  /* Second pass: everything else, asked only of the ones that survived. */
  const contracts = useMemo(
    () =>
      taken.flatMap(({ birth }) => [
        { address: birth.pool, abi: poolAbi, functionName: "slot0", chainId: CHAIN_ID } as const,
        { address: birth.token, abi: erc20Abi, functionName: "symbol", chainId: CHAIN_ID } as const,
        { address: birth.token, abi: erc20Abi, functionName: "decimals", chainId: CHAIN_ID } as const,
        { address: birth.token, abi: erc20Abi, functionName: "name", chainId: CHAIN_ID } as const,
        { address: birth.token, abi: erc20Abi, functionName: "totalSupply", chainId: CHAIN_ID } as const,
        ...BURNED.map(
          (grave) =>
            ({
              address: birth.token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [grave],
              chainId: CHAIN_ID,
            }) as const,
        ),
      ]),
    [taken],
  );

  const read = useReadContracts({
    contracts,
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: enabled && contracts.length > 0, staleTime: 30_000 },
  });

  const launches = useMemo((): Pair[] => {
    if (!read.data || head === undefined) return [];

    return taken
      .map(({ birth, liquidity }, index): Pair | undefined => {
        const at = index * READS;
        const slot = read.data[at];
        const symbol = read.data[at + 1];
        const decimals = read.data[at + 2];
        const named = read.data[at + 3];
        const supply = read.data[at + 4];
        const graves = BURNED.map((_, grave) => read.data[at + 5 + grave]);

        const quote = quoteFor(birth.quoteToken);
        if (!quote || slot?.status !== "success") return undefined;

        const sqrt = (slot.result as readonly unknown[])[0];
        if (typeof sqrt !== "bigint" || sqrt === 0n) return undefined;

        const baseDecimals = decimals?.status === "success" ? Number(decimals.result) : 18;
        const decimals0 = birth.baseIsToken0 ? baseDecimals : quote.decimals;
        const decimals1 = birth.baseIsToken0 ? quote.decimals : baseDecimals;
        const oneToZero = priceFrom(sqrt, decimals0, decimals1);

        /*
         * Dollars per quote unit. The stable is the unit itself; the coin has
         * to be asked, and until it answers a coin-quoted launch has no price
         * this screen can honestly print.
         */
        const rate = quote.symbol === "USDG" ? 1 : coinUsd;
        if (rate === undefined) return undefined;

        const price = (birth.baseIsToken0 ? oneToZero : 1 / oneToZero) * rate;
        if (!Number.isFinite(price) || price <= 0) return undefined;

        const whole = (value: unknown) =>
          typeof value === "bigint" ? Number(value) / 10 ** baseDecimals : 0;
        const issued = supply?.status === "success" ? whole(supply.result) : undefined;
        const buried = graves.reduce(
          (sum, grave) => sum + (grave?.status === "success" ? whole(grave.result) : 0),
          0,
        );

        return {
          pool: birth.pool,
          token: birth.token,
          name: named?.status === "success" && typeof named.result === "string" ? named.result : "",
          symbol:
            symbol?.status === "success" && typeof symbol.result === "string" ? symbol.result : "—",
          quote: quote.symbol,
          quoteToken: birth.quoteToken,
          decimals: baseDecimals,
          fee: birth.fee,
          marketCap: issued === undefined ? undefined : Math.max(issued - buried, 0) * price,
          fdv: issued === undefined ? undefined : issued * price,
          /* Nothing traded in the window, so nothing moved and nothing changed
             hands. Reported as the nothing it is rather than left to look like
             a figure that failed to arrive. The same goes for the flow this
             row does not carry: a pool with no trades has no tape to read, and
             the signal scores it on the two standing facts it can answer for
             rather than on zeroes standing in for a market. */
          change: 0,
          volume: 0,
          swaps: 0,
          /* Already measured, in the pass that chose this row. */
          liquidity,
          age: Number(head - birth.block) / PER_MINUTE,
          baseIsToken0: birth.baseIsToken0,
          decimals0,
          decimals1,
          usdRate: rate,
        } satisfies Pair;
      })
      .filter((row): row is Pair => row !== undefined && !isEquity(row.name));
  }, [read.data, taken, head, coinUsd]);

  return { launches, loading: depths.isFetching || read.isFetching };
}
