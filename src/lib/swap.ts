import { encodeFunctionData, type Abi, type Address } from "viem";
import { ponsCurveAbi, swapRouter02Abi } from "./abi";
import { dexMeta } from "./chains";
import type { Quote } from "./quote";
import { routingAddress, type Token } from "./tokens";

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
};

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
}): SwapPlan {
  return params.quote.venue === "curve" ? buildCurveTrade(params) : buildV3Swap(params);
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
}): SwapPlan {
  const { tokenIn, tokenOut, amountIn, amountOutMinimum, quote, recipient } = params;
  const dex = dexMeta(tokenIn.chainId);
  if (!dex) throw new Error("No routing venue on this chain");

  const nativeIn = Boolean(tokenIn.native);
  const nativeOut = Boolean(tokenOut.native);

  const swapData = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: routingAddress(tokenIn),
        tokenOut: routingAddress(tokenOut),
        fee: quote.fee,
        // Native output settles inside the router, then unwraps to the user.
        recipient: nativeOut ? ADDRESS_THIS : recipient,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const calls: `0x${string}`[] = [swapData];

  if (nativeOut) {
    calls.push(
      encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: "unwrapWETH9",
        args: [amountOutMinimum, recipient],
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
