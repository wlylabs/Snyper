import { encodeFunctionData, type Address } from "viem";
import { swapRouter02Abi } from "./abi";
import { dexMeta } from "./chains";
import { routingAddress, type Token } from "./tokens";

/** SwapRouter02 constant meaning "leave the output inside the router". */
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;

export type SwapPlan = {
  router: Address;
  /** Encoded SwapRouter02.multicall arguments. */
  deadline: bigint;
  calls: `0x${string}`[];
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

/**
 * Builds an exactInputSingle call, wrapped in SwapRouter02.multicall so the
 * deadline is enforced and native currency is wrapped/unwrapped in one tx.
 */
export function buildSwap(params: {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOutMinimum: bigint;
  fee: number;
  recipient: Address;
  deadlineMinutes: number;
}): SwapPlan {
  const { tokenIn, tokenOut, amountIn, amountOutMinimum, fee, recipient } = params;
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
        fee,
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
    router: dex.router,
    deadline: deadlineFrom(params.deadlineMinutes),
    calls,
    value: nativeIn ? amountIn : 0n,
    amountIn,
    amountOutMinimum,
    fee,
  };
}

export function swapRequest(plan: SwapPlan) {
  return {
    address: plan.router,
    abi: swapRouter02Abi,
    functionName: "multicall" as const,
    args: [plan.deadline, plan.calls] as const,
    value: plan.value,
  };
}
