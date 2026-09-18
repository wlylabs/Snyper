"use client";

import { useEffect, useMemo } from "react";
import { erc20Abi } from "viem";
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
  FEE_TIERS,
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
};

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

  const contracts = useMemo(() => {
    if (!token || amountIn <= 0n) return [];
    return exits.flatMap((exit) =>
      FEE_TIERS.map((fee) => ({
        address: VENUE.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle" as const,
        args: [
          {
            tokenIn: token,
            tokenOut: exit.address,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0n,
          },
        ] as const,
        chainId: CHAIN_ID,
      })),
    );
  }, [token, amountIn, exits]);

  const quoted = useReadContracts({
    contracts,
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: contracts.length > 0, staleTime: 10_000 },
  });

  const routes = useMemo(() => {
    const found: Route[] = [];
    contracts.forEach((_, index) => {
      const outcome = quoted.data?.[index];
      if (outcome?.status !== "success") return;
      const amountOut = (outcome.result as readonly unknown[])?.[0];
      if (typeof amountOut !== "bigint" || amountOut <= 0n) return;
      found.push({
        exit: exits[Math.floor(index / FEE_TIERS.length)],
        fee: FEE_TIERS[index % FEE_TIERS.length],
        amountOut,
      });
    });
    return found;
  }, [contracts, quoted.data, exits]);

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

  const simulation = useSimulateContract({
    address: VENUE.router,
    abi: routerAbi,
    functionName: "exactInputSingle",
    args:
      token && route && address
        ? [
            {
              tokenIn: token,
              tokenOut: route.exit.address,
              fee: route.fee,
              recipient: address,
              amountIn,
              amountOutMinimum: floor,
              sqrtPriceLimitX96: 0n,
            },
          ]
        : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(token && route && address && approved) },
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
