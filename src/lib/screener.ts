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

/**
 * Where supply goes to stop counting.
 *
 * Neither address has a key, so anything sent to one is out of circulation for
 * good. Subtracting them is the difference between a market cap and a fully
 * diluted one on a chain where burning supply is half the pitch — and it is the
 * only part of "circulating" that can be read off the chain rather than taken
 * on somebody's word.
 */
export const BURNED = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
] as const;

/**
 * What the last five minutes did to a token.
 *
 * The bands describe the window and nothing wider. A token that is flat here
 * has been flat for five minutes, which is not the same as accumulating — that
 * is a claim about hours, and hours are what this endpoint will not serve.
 *
 * Fifty percent either way is the line because on this chain it is an ordinary
 * five minutes: the screen routinely carries a token up three hundred percent
 * beside one down forty. A band drawn at ten would hold everything.
 */
export type Band = "all" | "pumping" | "flat" | "dumping";

export const MOVE = 50;
export const STILL = 10;

export function inBand(change: number, band: Band): boolean {
  if (band === "pumping") return change >= MOVE;
  if (band === "dumping") return change <= -MOVE;
  if (band === "flat") return Math.abs(change) < STILL;
  return true;
}

/**
 * The size past which a token is no longer an early entry.
 *
 * This screen exists to find a position before the run rather than after it, so
 * anything already worth more than this is not what it is for. It is a ceiling
 * rather than a filter: nothing on the screen is above it, and there is no
 * control to raise it.
 */
export const CEILING = 10_000_000;

/**
 * How far a token has to clear the floor on every count.
 *
 * The dollar figures are the reader's own bar. The ratios are not: they are the
 * ones the trading write-ups converge on, and both are between two standing
 * quantities, so neither needs the five-minute window translated into a day to
 * mean anything.
 *
 *   liquidity  at least a tenth of the market cap. The common guidance is ten
 *              to twenty percent, and below it a position cannot be closed at
 *              anything near the price the screen is quoting — which is what a
 *              rug is, before anyone has to be dishonest about it.
 *
 *   fdv        no more than twice the market cap. Under two is called healthy
 *              and means most of the supply is already out; over five is the
 *              danger line, and eight to ten is where roughly nine tenths of
 *              the supply is still waiting to land on whoever bought early.
 *
 * Volume is deliberately a dollar floor and not a ratio. The published ratio is
 * against a day's volume — thirty percent of market cap by one account, a full
 * turn by another — and this window is five minutes. Dividing a daily figure by
 * two hundred and eighty-eight assumes a token trades evenly around the clock,
 * which is the one thing a memecoin never does.
 */
export const HEALTHY_LIQUIDITY = 0.1;
export const HEALTHY_DILUTION = 2;

/** How hard the list is filtered, in one control. */
export type Grade = "all" | "floor" | "healthy";

/**
 * The reader's bar, applied to all four figures alike.
 *
 * Liquidity included. It was left out at first on the grounds that the healthy
 * ratio already covered it, which was wrong twice over: the ratio does not
 * apply at the `floor` grade at all, and at the smallest market caps it clears
 * at a hundred dollars of depth, which is not a market anybody can leave.
 */
export const FLOOR = 1_000;
