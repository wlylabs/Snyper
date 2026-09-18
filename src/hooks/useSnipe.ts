"use client";

import { useEffect, useMemo } from "react";
import {
  useAccount,
  useBalance,
  useReadContracts,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import {
  VENUE,
  buyPath,
  floorFor,
  quoterAbi,
  routerAbi,
  sellPath,
  slippageFor,
  tooThin,
} from "@/lib/venue";
import type { Pair } from "./useScreener";

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/** The trade a quote is measured against, for impact. */
const REFERENCE = 100n;

/**
 * Sizes offered without typing.
 *
 * A sniper's whole advantage is the seconds between seeing a token and holding
 * it, and a number pad spends them. These are the sizes, in the coin gas is
 * paid in, and the reader picks one.
 */
export const STAKES = [
  10_000_000_000_000_000n,
  50_000_000_000_000_000n,
  100_000_000_000_000_000n,
  250_000_000_000_000_000n,
] as const;

export type Shot = {
  /** Units of the token this buy is expected to return. */
  amountOut: bigint;
  /** The least it will accept before refusing. */
  floor: bigint;
  /** What the trade costs itself, in basis points. */
  impactBps: number;
  slippageBps: number;
  /**
   * What fraction of the stake comes back if the position is sold again at
   * once, quoted rather than assumed. Undefined while the sell side has not
   * answered yet, and paired with `trapped` once it has refused.
   */
  roundTrip?: number;
  /** True when the sell side refused outright. */
  trapped: boolean;
};

/**
 * Everything the reader should know before firing, in one question.
 *
 * Three quotes go out together: the buy at the size being staked, the same buy
 * at a hundredth of it, and the sale of what the first one returns. The first
 * two give the price and what this trade does to it. The third is the one that
 * matters most and the one no screen usually shows — a token that can be bought
 * and not sold is the oldest trick on any chain, and the quoter runs the pool's
 * own code, so a sell side that will not quote is a sell side that will not
 * work.
 *
 * Every one of them is asked along a path rather than between two tokens, for
 * the reason `buyPath` gives: it is the same question whether the pair is
 * quoted in the coin or in dollars, and the terminal should not have to ask it
 * two different ways.
 */
export function useShot(pair: Pair | undefined, stake: bigint) {
  const road = useMemo(
    () =>
      pair
        ? {
            in: buyPath(pair.token, pair.quoteToken, pair.fee),
            out: sellPath(pair.token, pair.quoteToken, pair.fee),
          }
        : undefined,
    [pair],
  );

  const contracts = useMemo(() => {
    if (!road || stake <= 0n) return [];
    const ask = (amountIn: bigint) =>
      ({
        address: VENUE.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInput" as const,
        args: [road.in, amountIn] as const,
        chainId: CHAIN_ID,
      }) as const;
    return [ask(stake), ask(stake / REFERENCE)];
  }, [road, stake]);

  const bought = useReadContracts({
    contracts,
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: contracts.length > 0, staleTime: 10_000 },
  });

  const amountOut = useMemo(() => {
    const outcome = bought.data?.[0];
    if (outcome?.status !== "success") return undefined;
    const value = (outcome.result as readonly unknown[])?.[0];
    return typeof value === "bigint" && value > 0n ? value : undefined;
  }, [bought.data]);

  /** The sale of exactly what the buy returns, which is the trap check. */
  const back = useReadContracts({
    contracts:
      road && amountOut
        ? [
            {
              address: VENUE.quoter,
              abi: quoterAbi,
              functionName: "quoteExactInput" as const,
              args: [road.out, amountOut] as const,
              chainId: CHAIN_ID,
            } as const,
          ]
        : [],
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: Boolean(road && amountOut), staleTime: 10_000 },
  });

  const shot = useMemo((): Shot | undefined => {
    if (!amountOut) return undefined;

    const small = bought.data?.[1];
    const reference =
      small?.status === "success"
        ? ((small.result as readonly unknown[])?.[0] as bigint)
        : undefined;
    const size = stake / REFERENCE;

    /*
     * Unpriceable impact is read as none rather than as infinite. The
     * comparison failing does not make this trade worse, and the floor below
     * still holds it to a number — a pool that could not absorb a hundredth of
     * the stake could not have filled the whole of it either.
     */
    const impactBps =
      reference && reference > 0n && size > 0n
        ? Math.max(0, 10_000 - Number((amountOut * size * 10_000n) / (reference * stake)))
        : 0;

    const outcome = back.data?.[0];
    const returned =
      outcome?.status === "success"
        ? ((outcome.result as readonly unknown[])?.[0] as bigint)
        : undefined;

    const slippageBps = slippageFor(impactBps);
    return {
      amountOut,
      floor: floorFor(amountOut, slippageBps),
      impactBps,
      slippageBps,
      roundTrip:
        returned && stake > 0n ? Number((returned * 10_000n) / stake) / 10_000 : undefined,
      trapped: back.isFetched && returned === undefined,
    };
  }, [amountOut, bought.data, back.data, back.isFetched, stake]);

  return {
    shot,
    /** No quote at all, which is a pool that cannot fill a trade this size. */
    unquotable: contracts.length > 0 && bought.isFetched && amountOut === undefined,
    loading: bought.isFetching || back.isFetching,
    thin: shot ? tooThin(shot.impactBps) : false,
  };
}

/**
 * Firing.
 *
 * A buy needs no allowance and never has: the coin going in is the chain's own,
 * so it rides on the transaction as its value rather than being pulled out of a
 * balance the router has been given permission over. One signature, nothing
 * granted before it and nothing left standing after it. That is the whole
 * reason this screen buys with the coin and not with a token.
 *
 * Nothing reaches the wallet unsimulated. The call is run against the chain's
 * current state first, and the reader is only asked to sign once it has come
 * back saying the trade goes through — so a shot that would revert costs them
 * nothing and never arrives as a prompt they have to judge.
 */
export function useFire({
  pair,
  stake,
  shot,
  onDone,
}: {
  pair: Pair | undefined;
  stake: bigint;
  shot: Shot | undefined;
  onDone?: () => void;
}) {
  const { address } = useAccount();
  const balance = useBalance({ address, chainId: CHAIN_ID });

  const simulation = useSimulateContract({
    address: VENUE.router,
    abi: routerAbi,
    functionName: "exactInput",
    value: stake,
    args:
      pair && address && shot
        ? [
            {
              path: buyPath(pair.token, pair.quoteToken, pair.fee),
              recipient: address,
              amountIn: stake,
              amountOutMinimum: shot.floor,
            },
          ]
        : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(pair && address && shot && !shot.trapped) },
  });

  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  useEffect(() => {
    if (receipt.isSuccess) onDone?.();
  }, [receipt.isSuccess, onDone]);

  /*
   * Gas is paid out of the same balance the stake comes from, so a wallet
   * holding exactly the stake cannot fire it. The simulation catches that too,
   * but this says which of the two things went wrong.
   */
  const short = balance.data !== undefined && balance.data.value <= stake;

  return {
    fire: () => {
      if (simulation.data?.request) write.writeContract(simulation.data.request);
    },
    firing: write.isPending || receipt.isLoading,
    done: receipt.isSuccess,
    hash: write.data,
    short,
    checking: simulation.isFetching,
    /** Why the chain says this shot cannot go through, when it says so. */
    blocked: short ? undefined : simulation.error,
    failure: write.error,
    ready: Boolean(simulation.data?.request) && !short,
    /** Stable, so a caller can clear the last receipt from an effect. */
    reset: write.reset,
  };
}
