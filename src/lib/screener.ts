import { parseAbi, parseAbiItem } from "viem";
import { VENUE } from "./venue";

/**
 * What is trading on this chain, right now.
 *
 * The window is five minutes, and that is the endpoint's decision rather than a
 * design one. Asked for every `Swap` on chain 4663, it answers for three
 * thousand blocks and refuses four: a chain that settles every hundred
 * milliseconds puts four thousand swaps in five minutes, and the public
 * endpoint caps what one query may return. Narrowing to a handful of pools does
 * not buy a longer reach either — the same refusal comes back for thirty pools
 * over an hour. So the column says 5m, because five minutes is what there is,
 * and a screen that labelled it 24h would be inventing the other twenty-three.
 */
export const WINDOW = 3_000n;

/**
 * How far back a pool still counts as new.
 *
 * Creations are sparse where swaps are not — a day of them is three hundred
 * odd logs and comes back in under two hundred milliseconds — so this window
 * can be long enough to be useful without being refused.
 */
export const CREATED_WINDOW = 864_000n;

/** Rows the screen asks the chain about in detail. */
export const DEPTH = 40;

export const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

export const poolCreatedEvent = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);

export const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

/** The tier of the WETH/USDG pool the screen prices the coin from. */
export const REFERENCE_FEE = 100;

/** What a pair is quoted in, and what the screen prices it against. */
export const QUOTES: Record<string, { symbol: string; decimals: number }> = {
  [VENUE.wrapped.toLowerCase()]: { symbol: "WETH", decimals: 18 },
  [VENUE.stable.toLowerCase()]: { symbol: "USDG", decimals: 6 },
};

export function quoteFor(token: string) {
  return QUOTES[token.toLowerCase()];
}

/**
 * A v3 pool's price, from the square root it stores.
 *
 * `sqrtPriceX96` is the square root of token1 per token0, held as a Q64.96
 * fixed-point number. Squaring it in floating point would overflow long before
 * it was useful, so the shift is taken off first and the square is done on what
 * is left, which is small enough to be a number.
 */
export function priceFrom(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const root = Number(sqrtPriceX96) / 2 ** 96;
  return root * root * 10 ** (decimals0 - decimals1);
}

/**
 * What the chain's tokenised equities call themselves.
 *
 * Robinhood Chain is not the memecoin chain its name on this nav implies — most
 * of what trades here is a tokenised stock, and by volume they dominate: left
 * in, this screen opened on SPCX, NVDA, GOOGL, SPY and GME, which is a fine
 * screen and not the one the nav promises. They are excluded by the suffix they
 * all carry in their own `name()`, so nothing is hardcoded ticker by ticker.
 */
const EQUITY = "• Robinhood Token";

export function isEquity(name: string): boolean {
  return name.includes(EQUITY);
}

/** How the list is ordered, which is the only question this screen asks. */
export type Sort = "volume" | "new" | "movers";
