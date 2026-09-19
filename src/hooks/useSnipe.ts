"use client";

import { useEffect, useMemo, useState } from "react";
import { parseEther } from "viem";
import {
  useAccount,
  useBalance,
  useReadContracts,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import { encodeFunctionData } from "viem";
import {
  TREASURY,
  VENUE,
  buyPath,
  feeOn,
  floorFor,
  quoterAbi,
  routerAbi,
  sellPath,
  slippageCapped,
  snipeSlippageFor,
} from "@/lib/venue";
import { REFERENCE_FEE } from "@/lib/screener";
import type { Pair } from "./useScreener";

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/** The trade a quote is measured against, for impact. */
const REFERENCE = 100n;

/**
 * Sizes offered without typing, in dollars.
 *
 * A sniper's whole advantage is the seconds between seeing a token and holding
 * it, and a number pad spends them. These are the sizes, and the reader picks
 * one.
 *
 * Dollars rather than the coin, because that is the unit the decision is made
 * in. Nobody chooses to risk 0.038 of a coin; they choose to risk a hundred
 * dollars, and a ladder priced in the coin quietly changes what every rung
 * means every time the coin moves. The chain is still paid in the coin — see
 * `stakeIn`, which is the one place the two meet.
 */
export const STAKES = [10, 50, 100, 250] as const;

/**
 * A dollar stake as the coin the chain actually takes.
 *
 * Zero when the coin has no price yet, which is the honest answer: a stake that
 * cannot be converted is not a small stake, and every quote downstream is gated
 * on it being above zero rather than guessing a rate.
 */
export function stakeIn(usd: number, coinUsd: number | undefined): bigint {
  if (!coinUsd || !Number.isFinite(coinUsd) || coinUsd <= 0) return 0n;
  const coins = usd / coinUsd;
  return Number.isFinite(coins) && coins > 0 ? parseEther(coins.toFixed(18)) : 0n;
}

export type Shot = {
  /** Units of the token this buy is expected to return. */
  amountOut: bigint;
  /** The least it will accept before refusing. */
  floor: bigint;
  /** What the trade costs itself, in basis points. */
  impactBps: number;
  slippageBps: number;
  /** True when the tolerance above is pinned at its cap rather than measured. */
  capped: boolean;
  /**
   * True when this is the last size's answer, still on screen while the one for
   * the size now staked is out. Every figure in it is a real quote and none of
   * them is current, so it may be read and must not be fired — see the guard in
   * `useFire`, which is what makes holding it on screen safe.
   */
  stale: boolean;
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
  /*
   * Everything below is quoted on what is left after the app's cut, never on
   * the gross stake. The figure on screen is then the figure that arrives, and
   * the fee is not a surprise subtracted from it afterwards — which is the only
   * way to charge for something without the screen starting to lie.
   */
  const net = stake - feeOn(stake);

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
    if (!road || net <= 0n) return [];
    const ask = (amountIn: bigint) =>
      ({
        address: VENUE.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInput" as const,
        args: [road.in, amountIn] as const,
        chainId: CHAIN_ID,
      }) as const;
    return [ask(net), ask(net / REFERENCE)];
  }, [road, net]);

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

  const asked = useMemo((): Shot | undefined => {
    if (!amountOut) return undefined;

    const small = bought.data?.[1];
    const reference =
      small?.status === "success"
        ? ((small.result as readonly unknown[])?.[0] as bigint)
        : undefined;
    const size = net / REFERENCE;

    /*
     * Unpriceable impact is read as none rather than as infinite. The
     * comparison failing does not make this trade worse, and the floor below
     * still holds it to a number — a pool that could not absorb a hundredth of
     * the stake could not have filled the whole of it either.
     */
    const impactBps =
      reference && reference > 0n && size > 0n
        ? Math.max(0, 10_000 - Number((amountOut * size * 10_000n) / (reference * net)))
        : 0;

    const outcome = back.data?.[0];
    const returned =
      outcome?.status === "success"
        ? ((outcome.result as readonly unknown[])?.[0] as bigint)
        : undefined;

    const slippageBps = snipeSlippageFor(impactBps);
    return {
      amountOut,
      floor: floorFor(amountOut, slippageBps),
      impactBps,
      slippageBps,
      capped: slippageCapped(impactBps),
      /*
       * Measured against the gross stake, not the net one. What the reader
       * wants to know is how much of the money they parted with comes back,
       * and the fee is part of what they parted with.
       */
      roundTrip:
        returned && stake > 0n ? Number((returned * 10_000n) / stake) / 10_000 : undefined,
      trapped: back.isFetched && returned === undefined,
      stale: false,
    };
  }, [amountOut, bought.data, back.data, back.isFetched, stake, net]);

  /*
   * The answer the reader is already looking at, kept until the next one lands.
   *
   * A stake is chosen by tapping a rung, and every rung is a different query —
   * so between the tap and the chain answering there is no data at all, and six
   * rows that had figures in them turn into six dashes and then into figures
   * again. That is what the panel breaking looks like: the reader tapped `$50`
   * and watched it come apart and reassemble, twice if they tapped twice.
   *
   * Held whole rather than figure by figure, and that is the point. Every number
   * in a shot was measured against the same stake through the same pool in the
   * same call, so keeping the object is keeping a set of figures that agree with
   * each other; holding them one at a time would let the panel show a round trip
   * from one size beside an output from another — figures that were each true
   * once and were never true together.
   *
   * Filed under the pool it was asked about, because a shot describes one pair.
   * A quote held across a change of target would be printed under the new
   * ticker's symbol, which is not a stale figure but a wrong one.
   */
  const [kept, setKept] = useState<{ pool: string; shot: Shot }>();
  useEffect(() => {
    if (asked && pair) setKept({ pool: pair.pool, shot: asked });
  }, [asked, pair]);

  /*
   * Only while the chain has yet to answer. A quote that came back with nothing
   * is an answer — this pool cannot fill a trade this size — and holding the
   * last size's figures under it would leave a panel of numbers standing where
   * the screen has just been told there are none.
   */
  const settling = bought.isFetching || !bought.isFetched;
  const held =
    settling && stake > 0n && pair && kept?.pool === pair.pool
      ? ({ ...kept.shot, stale: true } as const)
      : undefined;

  return {
    shot: asked ?? held,
    /** No quote at all, which is a pool that cannot fill a trade this size. */
    unquotable: contracts.length > 0 && bought.isFetched && amountOut === undefined,
    loading: bought.isFetching || back.isFetching,
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

  /*
   * Two legs, one transaction, one signature, still no allowance.
   *
   * The first sends the app's cut through the WETH/USDG pool so the treasury
   * receives dollars; the second buys the target with the rest. Taking the cut
   * out of the output instead would have been one call cheaper and would have
   * paid the treasury in whatever memecoin was just bought — a balance of dust
   * across hundreds of tokens, each of which would have to be sold through the
   * thin pool it came from.
   *
   * Measured against a live pool: the second leg fills at exactly the figure
   * the quoter gave for the net amount, to the last wei, and the trader ends up
   * marginally ahead of the cheaper shape, because the cut leaves before their
   * leg touches the pool.
   */
  const legs = useMemo(() => {
    /*
     * A held quote is for reading, never for signing. Its floor was measured
     * against the last size staked, so a transaction built on it would go out
     * with the wrong number guarding it — too low to protect the trade if the
     * stake went up, too high to fill if it went down. The panel shows it; this
     * waits for the chain.
     */
    if (!pair || !address || !shot || shot.stale) return undefined;
    const cut = feeOn(stake);
    const buy = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInput",
      args: [
        {
          path: buyPath(pair.token, pair.quoteToken, pair.fee),
          recipient: address,
          amountIn: stake - cut,
          amountOutMinimum: shot.floor,
        },
      ],
    });
    if (cut === 0n) return [buy];
    return [
      encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInput",
        args: [
          {
            path: buyPath(VENUE.stable, VENUE.wrapped, REFERENCE_FEE),
            recipient: TREASURY,
            amountIn: cut,
            amountOutMinimum: 0n,
          },
        ],
      }),
      buy,
    ];
  }, [pair, address, shot, stake]);

  const simulation = useSimulateContract({
    address: VENUE.router,
    abi: routerAbi,
    functionName: "multicall",
    value: stake,
    args: legs ? [legs] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(legs && shot && !shot.trapped) },
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
