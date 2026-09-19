import { encodePacked, parseAbi } from "viem";

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
  "function quoteExactInput(bytes path, uint256 amountIn) view returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

/**
 * SwapRouter02's shape: no deadline in the struct. Verified against bytecode.
 *
 * Both entry points are here because they answer different questions. The
 * single one names its two tokens and is what a sale out of the balance screen
 * uses. The path one takes the road packed into bytes and is what the terminal
 * fires, because a token quoted in dollars is two hops from the coin and one
 * hop from nothing — reading `exactInput` as the only way in means the terminal
 * never has to care which.
 *
 * `0xb858183f` is present in the deployed bytecode and `0xc04b8d59`, the
 * variant carrying a deadline, is not — checked the same way the single one was.
 */
export const routerAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
  "struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }",
  "function exactInput(ExactInputParams params) payable returns (uint256 amountOut)",
]);

/**
 * The tier the coin crosses on its way to the dollar.
 *
 * A pair quoted in USDG cannot be reached from the coin in one hop, so the
 * trade goes through the WETH/USDG pool — the same 0.01% pool the memecoin
 * screen prices the coin from, which is the deepest thing on this chain and
 * the only pool on the road that is not the one being sniped.
 */
export const HOP_FEE = 100;

/**
 * The road into a token, packed the way the router reads it.
 *
 * A path is addresses and tiers laid end to end with nothing between them:
 * twenty bytes, three bytes, twenty bytes, and again for every further hop.
 * One hop when the pair is already quoted in the coin's own wrapper, two when
 * it is quoted in dollars.
 *
 * The point of routing every buy through a path, even the one-hop ones, is that
 * the coin going in is the chain's own. It rides on the transaction as its
 * value, so there is no allowance to grant first and none left standing after —
 * which is the whole of what the terminal promises, and it holds for both
 * shapes of pair only because the second hop is paid for out of the first.
 */
export function buyPath(
  token: `0x${string}`,
  quoteToken: `0x${string}`,
  fee: number,
): `0x${string}` {
  return direct(quoteToken)
    ? encodePacked(["address", "uint24", "address"], [VENUE.wrapped, fee, token])
    : encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [VENUE.wrapped, HOP_FEE, quoteToken, fee, token],
      );
}

/** The same road walked backwards, which is what a sale would have to take. */
export function sellPath(
  token: `0x${string}`,
  quoteToken: `0x${string}`,
  fee: number,
): `0x${string}` {
  return direct(quoteToken)
    ? encodePacked(["address", "uint24", "address"], [token, fee, VENUE.wrapped])
    : encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [token, fee, quoteToken, HOP_FEE, VENUE.wrapped],
      );
}

function direct(quoteToken: `0x${string}`): boolean {
  return quoteToken.toLowerCase() === VENUE.wrapped.toLowerCase();
}

export const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

/** The least this will ever accept, for a pool deep enough not to move. */
export const SLIPPAGE_FLOOR = 50;

/**
 * The most it will accept before refusing to guess.
 *
 * Past five percent the number stops being a tolerance and starts being a
 * haircut, and a reader clicking through a control they were handed has no way
 * to tell the difference. A trade that needs more than this is a trade against
 * a pool too thin to price, and the screen says so instead.
 */
export const SLIPPAGE_CEILING = 500;

/**
 * How far a fill may drift, worked out rather than asked for.
 *
 * Slippage is a bet on how much the pool will move between the quote and the
 * block the swap lands in, and a reader has no way to price that. What they
 * are usually handed instead is three buttons and the hope that they pick the
 * one that neither fails nor gets them sandwiched.
 *
 * The pool answers it better than they can. Quoting the trade beside a
 * hundredth of itself gives the price the trade moves through — thin pools
 * move a lot, deep ones barely at all — and a pool that swallows this trade
 * whole is a pool that will not have wandered far by the next block either.
 * So the floor is what a deep pool gets, and the margin above it is set by
 * what this trade already costs itself, with half again for the wait.
 */
export function slippageFor(impactBps: number): number {
  const need = SLIPPAGE_FLOOR + Math.ceil((Math.max(impactBps, 0) * 3) / 2);
  return Math.min(need, SLIPPAGE_CEILING);
}

/** Whether the pool is too thin for any tolerance worth offering. */
export function tooThin(impactBps: number): boolean {
  return slippageFor(impactBps) >= SLIPPAGE_CEILING;
}

/**
 * The most a shot will accept, which is four times what a sale will.
 *
 * Five percent is the right ceiling for selling a holding into a pool that has
 * been trading for months, and it is the wrong one for buying into a pair that
 * opened an hour ago: those pools are thin by definition, they move between the
 * quote and the block the trade lands in, and a tolerance that tight is a trade
 * that reverts rather than a trade that is protected. The screen was calling
 * that "this pool cannot take a stake this size" when what it meant was that
 * this app would not.
 *
 * Twenty is where the outside world has put it. Uniswap's own wallet caps a
 * reader's custom slippage at twenty percent; the sniping guides that bother to
 * give a number say ten to twenty for a new pair and stop there, on the grounds
 * that a trade needing more than twenty is either a token with a transfer tax
 * over twenty — which is a honeypot by another name — or a pool with nothing in
 * it. Both of those are already answered on this screen: the tax and the trap
 * by the exit check, the empty pool by the quote that would not fill.
 *
 * So this is not a refusal, and nothing on the terminal blocks on it. It is the
 * last line under the fill — at the cap, the trade still goes through and still
 * cannot land more than a fifth below what was quoted.
 */
export const SNIPE_CEILING = 2000;

/**
 * The same bet as `slippageFor`, priced for a pair nobody has traded yet.
 *
 * One times the impact rather than one and a half. The extra half was there to
 * cover the wait on a pool thin enough to wander, and against a twenty percent
 * cap it did the opposite: it pinned the tolerance at the ceiling from thirteen
 * percent impact upward, so the number stopped describing the pool long before
 * the pool stopped being tradeable. At one times, the cap is reached where the
 * guidance says it should be — a fill that has already cost a fifth.
 */
export function snipeSlippageFor(impactBps: number): number {
  return Math.min(SLIPPAGE_FLOOR + Math.max(impactBps, 0), SNIPE_CEILING);
}

/** Whether the tolerance above is pinned at its cap rather than measured. */
export function slippageCapped(impactBps: number): boolean {
  return snipeSlippageFor(impactBps) >= SNIPE_CEILING;
}

/** Basis points, applied to a quote to get the floor a swap will accept. */
export function floorFor(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
