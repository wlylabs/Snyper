"use client";

import { useEffect, useMemo } from "react";
import { encodeFunctionData, erc20Abi } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import {
  EXITS,
  FEE_BIPS,
  FEE_TIERS,
  ROUTER_SELF,
  TREASURY,
  VENUE,
  floorFor,
  quoterAbi,
  routerAbi,
  type Exit,
} from "@/lib/venue";

export type Route = {
  exit: Exit;
  fee: number;
  amountOut: bigint;
  /**
   * What this trade costs itself, in basis points — the gap between the price
   * it gets and the price a trade too small to move anything would get.
   */
  impactBps: number;
};

/**
 * The trade this one is measured against: a hundredth of it.
 *
 * Small enough through any pool worth trading in to come back at what the
 * price is before this trade touches it, and large enough to survive being
 * divided down on a six-decimal token.
 */
const REFERENCE = 100n;

/** One `eth_call` for every tier of every exit, rather than one per tier. */
const ONE_CALL = 0;

/**
 * What this token can be sold into, and at what price, everywhere it trades.
 *
 * Both exits at all four tiers go out together — eight quotes, one request —
 * because a pool existing at a tier says nothing about what is in it, and the
 * only way to know which one fills best is to ask all of them. Tiers with no
 * pool revert; `allowFailure` keeps the rest.
 */
export function useRoutes(token: `0x${string}` | undefined, amountIn: bigint) {
  const exits = useMemo(
    () => EXITS.filter((exit) => exit.address.toLowerCase() !== token?.toLowerCase()),
    [token],
  );

  const reference = amountIn / REFERENCE > 0n ? amountIn / REFERENCE : amountIn;

  /*
   * Every pair, every tier, twice: once for the trade and once for the small
   * one it is priced against. Sixteen quotes still leave as a single call, and
   * asking for the comparison separately would have been a second round trip
   * for an answer the first one could have carried.
   */
  const contracts = useMemo(() => {
    if (!token || amountIn <= 0n) return [];
    const ask = (size: bigint) =>
      exits.flatMap((exit) =>
        FEE_TIERS.map((fee) => ({
          address: VENUE.quoter,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle" as const,
          args: [
            {
              tokenIn: token,
              tokenOut: exit.address,
              amountIn: size,
              fee,
              sqrtPriceLimitX96: 0n,
            },
          ] as const,
          chainId: CHAIN_ID,
        })),
      );
    return [...ask(amountIn), ...ask(reference)];
  }, [token, amountIn, reference, exits]);

  const quoted = useReadContracts({
    contracts,
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: contracts.length > 0, staleTime: 10_000 },
  });

  const routes = useMemo(() => {
    const half = contracts.length / 2;
    const out = (index: number): bigint | undefined => {
      const outcome = quoted.data?.[index];
      if (outcome?.status !== "success") return undefined;
      const value = (outcome.result as readonly unknown[])?.[0];
      return typeof value === "bigint" && value > 0n ? value : undefined;
    };

    const found: Route[] = [];
    for (let index = 0; index < half; index++) {
      const amountOut = out(index);
      if (amountOut === undefined) continue;
      const refOut = out(index + half);

      /*
       * Unpriceable impact is treated as none rather than as infinite: the
       * comparison failing does not make the trade worse, and the floor below
       * still protects it. A pool that genuinely cannot absorb the small trade
       * could not have filled the large one either.
       */
      const impactBps =
        refOut !== undefined && refOut > 0n && reference > 0n
          ? Math.max(
              0,
              10_000 -
                Number((amountOut * reference * 10_000n) / (refOut * amountIn)),
            )
          : 0;

      found.push({
        exit: exits[Math.floor(index / FEE_TIERS.length)],
        fee: FEE_TIERS[index % FEE_TIERS.length],
        amountOut,
        impactBps,
      });
    }
    return found;
  }, [contracts, quoted.data, exits, amountIn, reference]);

  /** The deepest pool for a given exit, which is the one worth trading in. */
  const bestFor = useMemo(
    () => (exit: Exit) =>
      routes
        .filter((route) => route.exit.address === exit.address)
        .reduce<Route | undefined>(
          (best, route) => (!best || route.amountOut > best.amountOut ? route : best),
          undefined,
        ),
    [routes],
  );

  return {
    routes,
    bestFor,
    /** Exits with a pool that actually filled a quote. */
    tradable: useMemo(
      () => exits.filter((exit) => routes.some((route) => route.exit.address === exit.address)),
      [exits, routes],
    ),
    loading: quoted.isFetching,
    asked: contracts.length > 0 && !quoted.isPending,
  };
}

/**
 * Turning a route into a transaction, in the two steps the chain requires.
 *
 * An ERC-20 cannot be moved by a contract that has not been allowed to move it,
 * so a sale is an approval and then a swap. The approval is written for exactly
 * the amount being sold rather than the unlimited allowance most apps ask for:
 * it costs a signature every time, and it means a router that is later found to
 * be something other than what it is today cannot reach anything the reader did
 * not already agree to hand it.
 *
 * Nothing is offered for signature until it has been simulated. `exactInputSingle`
 * is run against the current state first, and the wallet is only asked once the
 * chain has said the call goes through — so a swap that would revert costs the
 * reader nothing and never reaches their wallet as a prompt they have to judge.
 */
export function useSwapAction({
  token,
  route,
  amountIn,
  slippageBps,
  onDone,
}: {
  token: `0x${string}` | undefined;
  route: Route | undefined;
  amountIn: bigint;
  slippageBps: number;
  onDone?: () => void;
}) {
  const { address } = useAccount();

  const allowance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, VENUE.router] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(token && address) },
  });

  const approved = (allowance.data ?? 0n) >= amountIn && amountIn > 0n;

  const approval = useWriteContract();
  const approvalReceipt = useWaitForTransactionReceipt({ hash: approval.data });

  // The allowance the swap simulation reads is the one the approval just wrote.
  useEffect(() => {
    if (approvalReceipt.isSuccess) void allowance.refetch();
  }, [approvalReceipt.isSuccess, allowance]);

  const floor = route ? floorFor(route.amountOut, slippageBps) : 0n;

  /*
   * The sale and the app's cut, in one transaction.
   *
   * The swap is told to deliver into the router rather than into the wallet —
   * `ROUTER_SELF` is the router's own sentinel for that — and the sweep that
   * follows splits what landed: the cut to the treasury, the rest to the
   * reader. It is the router's own fee mechanism, so there is no contract of
   * this app's in the path and nothing to audit that Uniswap has not already
   * deployed. The deployed bytecode refuses anything over one percent, which is
   * a ceiling this app cannot raise.
   *
   * The floor is checked on the way out of the pool, before the split, so it is
   * a gross figure; what the reader is guaranteed is that figure less the cut,
   * which is what the panels above print.
   */
  const calls = useMemo(() => {
    if (!token || !route || !address) return undefined;
    const sale = (recipient: `0x${string}`) =>
      encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: token,
            tokenOut: route.exit.address,
            fee: route.fee,
            recipient,
            amountIn,
            amountOutMinimum: floor,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
    if (FEE_BIPS === 0) return [sale(address)];
    return [
      sale(ROUTER_SELF),
      encodeFunctionData({
        abi: routerAbi,
        functionName: "sweepTokenWithFee",
        args: [route.exit.address, floor, address, BigInt(FEE_BIPS), TREASURY],
      }),
    ];
  }, [token, route, address, amountIn, floor]);

  const simulation = useSimulateContract({
    address: VENUE.router,
    abi: routerAbi,
    functionName: "multicall",
    args: calls ? [calls] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(calls && approved) },
  });

  const swap = useWriteContract();
  const swapReceipt = useWaitForTransactionReceipt({ hash: swap.data });

  useEffect(() => {
    if (swapReceipt.isSuccess) onDone?.();
  }, [swapReceipt.isSuccess, onDone]);

  return {
    approved,
    floor,
    approve: () => {
      if (!token) return;
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [VENUE.router, amountIn],
        chainId: CHAIN_ID,
      });
    },
    approving: approval.isPending || approvalReceipt.isLoading,
    send: () => {
      if (simulation.data?.request) swap.writeContract(simulation.data.request);
    },
    sending: swap.isPending || swapReceipt.isLoading,
    done: swapReceipt.isSuccess,
    hash: swap.data,
    /** Why the chain says this trade cannot go through, when it says so. */
    blocked: approved ? simulation.error : undefined,
    checking: simulation.isFetching,
    failure: approval.error ?? swap.error,
    reset: () => {
      approval.reset();
      swap.reset();
    },
  };
}
