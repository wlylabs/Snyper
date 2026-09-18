import { parseAbi } from "viem";

/**
 * Where a trade on Robinhood Chain actually happens.
 *
 * The chain publishes no deployment list, so these five addresses were read off
 * chain 4663 itself and checked again against it before anything was built on
 * them. None of them can move: a Uniswap v3 factory is immutable, and so are the
 * router and quoter deployed against it.
 *
 *   factory  the address `router.factory()` and `quoter.factory()` both return
 *   router   SwapRouter02 — its bytecode carries `exactInputSingle` at
 *            0x04e45aaf, the variant whose params have no deadline, and not the
 *            v1 selector at 0x414bf389
 *   quoter   QuoterV2, pinned to that same factory. A quoter belongs to one
 *            deployment, and borrowing one for another venue is how a quote
 *            stops describing the trade
 *   wrapped  `router.WETH9()`, symbol WETH, 18 decimals
 *   stable   Global Dollar, symbol USDG, 6 decimals — the chain's USD unit, and
 *            what a holding is most often being sold for
 */
export const VENUE = {
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  router: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  wrapped: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  stable: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
} as const;

export type Exit = { address: `0x${string}`; symbol: string; decimals: number };

/** What a holding can be sold into. Both are one hop from most of this chain. */
export const EXITS: readonly Exit[] = [
  { address: VENUE.stable, symbol: "USDG", decimals: 6 },
  { address: VENUE.wrapped, symbol: "WETH", decimals: 18 },
];

/**
 * Every tier is quoted, because picking one would be picking a price.
 *
 * Measured on this chain, the spread between tiers is not a rounding error: at
 * the time of writing NVDA quoted 82 USDG through the 0.01% pool and 220 USDG
 * through the 0.05% one, and MSFT quoted 496 through 0.3% and 0.42 through 1%.
 * A pool can exist at a tier and hold almost nothing, and the quote it gives is
 * real — it is simply the price of trading against an empty pool. So all four
 * are asked and the best answer wins.
 */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;

/**
 * `view` is a lie told deliberately.
 *
 * QuoterV2 works by running the swap and reverting, which makes it nonpayable
 * in Uniswap's own ABI and unusable through anything that insists on a static
 * read. It is meant to be called exactly the way this app calls it — through
 * `eth_call`, where the state it touches is thrown away — so it is declared
 * here as what it is from the caller's side. Uniswap's own SDK does the same.
 */
export const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** SwapRouter02's shape: no deadline in the struct. Verified against bytecode. */
export const routerAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

/** Bounds offered for how far a fill may drift before it is refused. */
export const SLIPPAGE = [50, 100, 500] as const;

/** Basis points, applied to a quote to get the floor a swap will accept. */
export function floorFor(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
