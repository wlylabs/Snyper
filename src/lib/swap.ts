import { encodeFunctionData, type Abi, type Address } from "viem";
import { ponsCurveAbi, snyperRouterAbi, swapRouter02Abi } from "./abi";
import { dexMeta } from "./chains";
import { feePolicy, feeRouter, maxFeeBps } from "./fees";
import type { Quote } from "./quote";
import { routingAddress, settlementAddress, type Token } from "./tokens";

/** SwapRouter02 constant meaning "leave the output inside the router". */
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;

/**
 * A trade, encoded for whichever venue priced it. The two shapes settle very
 * differently — a router multicall against a Uniswap v3 pool, or a direct call
 * on a Pons bonding curve — but both come out of here as one request the
 * executor can sign, and both carry the spender an ERC-20 input has to approve.
 */
export type SwapPlan = {
  /** Contract the trade is sent to, and the spender an ERC-20 input approves. */
  target: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
  fee: number;
  /**
   * Snyper's cut, in bps of the output, as the router was actually told to take
   * it. Zero on every route that cannot carry one, so what the interface quotes
   * and what the transaction does can never drift apart.
   */
  feeBps: number;
};

/**
 * The fee leg a plan is allowed to carry, or nothing. A build with no recipient
 * configured, a share outside what the router accepts, or a venue with no fee
 * call at all each come back the same way: no leg, and a trade encoded exactly
 * as it was before any of this existed.
 */
function feeLeg(feeBps: number | undefined): { bps: bigint; recipient: Address } | undefined {
  const recipient = feePolicy().recipient;
  if (!recipient) return undefined;
  const bps = Math.floor(feeBps ?? 0);
  if (!(bps >= 1 && bps <= maxFeeBps())) return undefined;
  return { bps: BigInt(bps), recipient };
}

export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(5_000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

export function deadlineFrom(minutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(minutes)) * 60);
}

export function buildSwap(params: {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOutMinimum: bigint;
  quote: Quote;
  recipient: Address;
  deadlineMinutes: number;
  /** Snyper's share of the trade, in bps. Ignored where none can be taken. */
  feeBps?: number;
  /** Which end the fee comes off. Callers point it at the funding asset. */
  feeOnInput?: boolean;
}): SwapPlan {
  /*
   * A trade that owes nothing goes straight to its venue, whatever is deployed.
   * Sending a free trade through an extra contract would cost the reader gas to
   * collect nothing, and a snype's entry — and every exit that lost money — is
   * exactly that trade.
   */
  const snyper = feeRouter();
  if (snyper && feeLeg(params.feeBps)) {
    return buildSnyperTrade({ ...params, router: snyper });
  }
  return params.quote.venue === "curve" ? buildCurveTrade(params) : buildV3Swap(params);
}

/**
 * A trade routed through Snyper's own contract, which is what makes two things
 * possible that SwapRouter02's split cannot do: a share above one percent, and
 * any share at all on a launchpad curve.
 *
 * The bound handed over is what the caller must actually end up with, net of
 * the fee, and the contract checks it after taking its part rather than before.
 */
function buildSnyperTrade(params: {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOutMinimum: bigint;
  quote: Quote;
  deadlineMinutes: number;
  feeBps?: number;
  feeOnInput?: boolean;
  router: Address;
}): SwapPlan {
  const { tokenIn, tokenOut, amountIn, amountOutMinimum, quote, router } = params;
  const fee = feeLeg(params.feeBps);
  const bps = fee ? Number(fee.bps) : 0;
  const feeOnInput = params.feeOnInput ?? true;
  // The fee comes off one end or the other, so either way the caller ends up
  // with the same share of the trade less than the gross quote.
  const minOut = amountOutMinimum - (amountOutMinimum * BigInt(bps)) / 10_000n;
  const deadline = deadlineFrom(params.deadlineMinutes);

  const plan = {
    target: router,
    abi: snyperRouterAbi as unknown as Abi,
    amountIn,
    amountOutMinimum: minOut,
    fee: quote.fee,
    feeBps: bps,
  };

  if (quote.venue === "curve") {
    const buying = quote.curveSide !== "sell";
    // The launched token is named; its curve is resolved on chain, never passed.
    const token = buying ? tokenOut : tokenIn;
    return {
      ...plan,
      functionName: "tradeCurve",
      args: [
        {
          token: token.address,
          buying,
          amountIn,
          minOut,
          feeBps: bps,
          feeOnInput,
          deadline,
        },
      ] as const,
      value: tokenIn.native ? amountIn : 0n,
    };
  }

  return {
    ...plan,
    functionName: "swapV3",
    args: [
      {
        tokenIn: settlementAddress(tokenIn),
        tokenOut: settlementAddress(tokenOut),
        poolFee: quote.fee,
        amountIn,
        minOut,
        feeBps: bps,
        feeOnInput,
        deadline,
      },
    ] as const,
    value: tokenIn.native ? amountIn : 0n,
  };
}

/**
 * Builds an exactInputSingle call, wrapped in SwapRouter02.multicall so the
 * deadline is enforced and native currency is wrapped/unwrapped in one tx.
 */
function buildV3Swap(params: {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOutMinimum: bigint;
  quote: Quote;
  recipient: Address;
  deadlineMinutes: number;
  feeBps?: number;
}): SwapPlan {
  const { tokenIn, tokenOut, amountIn, amountOutMinimum, quote, recipient } = params;
  const dex = dexMeta(tokenIn.chainId);
  if (!dex) throw new Error("No routing venue on this chain");

  const nativeIn = Boolean(tokenIn.native);
  const nativeOut = Boolean(tokenOut.native);
  const fee = feeLeg(params.feeBps);

  const swapData = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: routingAddress(tokenIn),
        tokenOut: routingAddress(tokenOut),
        fee: quote.fee,
        // Native output settles inside the router, then unwraps to the user. A
        // fee leg needs the output parked there too, whatever it is made of,
        // because the split happens on the router's own balance.
        recipient: nativeOut || fee ? ADDRESS_THIS : recipient,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const calls: `0x${string}`[] = [swapData];

  /*
   * Settling what the swap left in the router. The bound handed to each call is
   * the same gross minimum `exactInputSingle` already enforced: the fee is a
   * share of whatever arrived, so a bound net of it would be a second, looser
   * check on a number the swap had already refused to go below.
   */
  if (nativeOut) {
    calls.push(
      encodeFunctionData(
        fee
          ? {
              abi: swapRouter02Abi,
              functionName: "unwrapWETH9WithFee",
              args: [amountOutMinimum, recipient, fee.bps, fee.recipient],
            }
          : {
              abi: swapRouter02Abi,
              functionName: "unwrapWETH9",
              args: [amountOutMinimum, recipient],
            },
      ),
    );
  } else if (fee) {
    calls.push(
      encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: "sweepTokenWithFee",
        args: [
          routingAddress(tokenOut),
          amountOutMinimum,
          recipient,
          fee.bps,
          fee.recipient,
        ],
      }),
    );
  }

  if (nativeIn) {
    calls.push(encodeFunctionData({ abi: swapRouter02Abi, functionName: "refundETH" }));
  }

  return {
    target: dex.router,
    abi: swapRouter02Abi as unknown as Abi,
    functionName: "multicall",
    args: [deadlineFrom(params.deadlineMinutes), calls] as const,
    value: nativeIn ? amountIn : 0n,
    amountIn,
    amountOutMinimum,
    fee: quote.fee,
    feeBps: fee ? Number(fee.bps) : 0,
  };
}

/**
 * Builds a buy or a sell straight against a Pons bonding curve. There is no
 * router and no deadline: the curve settles the trade itself, bounds it with
 * `minTokensOut`/`minQuoteOut`, and refunds any part of a buy it could not
 * fill. A native-quoted curve is paid in value; an ERC-20 one pulls the input
 * with `transferFrom`, so the curve is the spender to approve.
 */
function buildCurveTrade(params: {
  tokenIn: Token;
  amountIn: bigint;
  amountOutMinimum: bigint;
  quote: Quote;
  recipient: Address;
}): SwapPlan {
  const { tokenIn, amountIn, amountOutMinimum, quote, recipient } = params;
  const curve = quote.pool;
  const buying = quote.curveSide !== "sell";

  return {
    target: curve,
    abi: ponsCurveAbi as unknown as Abi,
    functionName: buying ? "buy" : "sell",
    args: [amountIn, amountOutMinimum, recipient] as const,
    // A native-quoted curve checks `msg.value` against `quoteIn` exactly; a
    // sell and an ERC-20 quoted buy are both pulled with `transferFrom`.
    value: buying && tokenIn.native ? amountIn : 0n,
    amountIn,
    amountOutMinimum,
    fee: quote.fee,
    // A curve settles the trade itself and takes no instruction about a third
    // party, so a launchpad route is free until something of Snyper's own
    // stands in front of it.
    feeBps: 0,
  };
}

export function swapRequest(plan: SwapPlan) {
  return {
    address: plan.target,
    abi: plan.abi,
    functionName: plan.functionName,
    args: plan.args,
    value: plan.value,
  };
}
