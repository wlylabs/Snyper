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

/**
 * Blocks per minute on chain 4663, at a hundred milliseconds a block.
 *
 * One place rather than three. It turns a block count into an age for the
 * launches list and a window into minutes for the signal's youth reading, and
 * those two were already disagreeing about nothing in two files.
 */
export const PER_MINUTE = 600;

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
 * A launch wearing a name that already belongs to something else.
 *
 * Deploying a token called USDG costs nothing and a ticker is whatever its
 * contract says it is, so the day a screen starts listing brand new pools is
 * the day it starts listing impersonators. One turned up in the first hour of
 * this list: symbol USDG, two dollars resting in it, a claimed market cap of
 * three quarters of a million, and an address that is not the chain's dollar.
 *
 * This is not the balance screen's heuristic, which compares a wallet's rows
 * against each other and weighs which of them anything has priced. It does not
 * need to be. The tokens worth impersonating on this chain are the two the app
 * already knows by address, so the test is an equality rather than a guess, and
 * a row it marks is wearing a name that provably is not its own.
 */
export function impersonates(token: string, symbol: string): boolean {
  const claimed = symbol.trim().toUpperCase();
  if (!claimed) return false;
  return Object.entries(QUOTES).some(
    ([address, quote]) =>
      quote.symbol.toUpperCase() === claimed && address !== token.toLowerCase(),
  );
}

/**
 * What a row has to carry to be tested for wearing someone else's name.
 */
export type Named = {
  token: string;
  symbol: string;
  liquidity: number;
  volume: number;
};

/**
 * One ticker, one row.
 *
 * A ticker is whatever a contract says it is, and deploying one costs nothing,
 * so a screen that lists brand new pools is a screen that lists the same name
 * over and over. Measured across a day of launches on this chain: thirty-six
 * tickers claimed by more than one contract, SIRIUS by thirty-five of them, SIU
 * by twenty-nine, RIP by fifteen. A reader looking at a row that says SIRIUS
 * cannot tell which of the thirty-five they are about to buy, and that is the
 * entire purpose of deploying the other thirty-four.
 *
 * Most of them never reach the screen, because they hold nothing and the floor
 * already refuses them — of all those copies only five cleared it, and only one
 * ticker had two copies clear it at once. So this is not a flood being held
 * back. It is the handful that get through the floor by holding real money,
 * which are also the only ones a reader could lose anything to.
 *
 * Two different tests, because two different things are knowable:
 *
 *   A token calling itself by one of the two names this app knows by address
 *   is refused outright. That is `impersonates`, and it is proof rather than
 *   judgement — the chain's dollar has an address, and a second contract
 *   answering USDG is not it. One turned up in the measured day, named
 *   "Gelobal Dollar".
 *
 *   Among the rest, a ticker held by several contracts keeps the one the market
 *   is in. Note what that claims and what it does not: not that the deepest
 *   pool is the honest token, which nothing here can know, but that it is the
 *   one being traded — and a copy wearing the name without the market is a row
 *   that can only be mistaken for it. Depth decides rather than age, because a
 *   pool's depth is on the chain now and a token's age often is not.
 *
 * Order is preserved, so whatever sorted the list still decides what it shows.
 */
export function dropCopycats<T extends Named>(rows: readonly T[]): T[] {
  const genuine = rows.filter((row) => !impersonates(row.token, row.symbol));

  /* Which contract holds the market for each name anyone shares. */
  const holder = new Map<string, T>();
  for (const row of genuine) {
    const name = row.symbol.trim().toUpperCase();
    if (!name) continue;
    const held = holder.get(name);
    if (!held) {
      holder.set(name, row);
      continue;
    }
    if (row.liquidity > held.liquidity) holder.set(name, row);
    else if (row.liquidity === held.liquidity && row.volume > held.volume) {
      holder.set(name, row);
    }
  }

  /*
   * A row with no ticker at all is kept. It is unreadable rather than
   * borrowed, nothing else can be confused with it, and the floor already
   * decides whether it is worth showing.
   */
  return genuine.filter((row) => {
    const name = row.symbol.trim().toUpperCase();
    if (!name) return true;
    return holder.get(name) === row;
  });
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
 * Three of the bands describe the window and nothing wider. A token that is
 * pumping here has been pumping for five minutes, which is not a claim about
 * hours, and hours are what this endpoint will not serve.
 *
 * Fifty percent either way is the line for the two that read the price, because
 * on this chain it is an ordinary five minutes: the screen routinely carries a
 * token up three hundred percent beside one down forty. A band drawn at ten
 * would hold everything.
 *
 * `coiling` is the odd one and the reason this screen exists in its new shape.
 * It does not read the price at all — it reads whether the tape under the price
 * is filling, which is `lib/signal`, and the caller passes the answer in. It
 * took the place of a band called `flat`, which asked a weaker version of the
 * same question and could not tell a token being quietly accumulated from one
 * nobody has looked at in five minutes. Those are the two rows a screen about
 * finding an entry early most needs to keep apart.
 */
export type Band = "all" | "coiling" | "pumping" | "dumping";

export const MOVE = 50;

export function inBand(change: number, band: Band, coiling: boolean): boolean {
  if (band === "coiling") return coiling;
  if (band === "pumping") return change >= MOVE;
  if (band === "dumping") return change <= -MOVE;
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
 *   fdv        no more than twice the market cap. Under two means most of the
 *              supply is already out; over five is the danger line, and eight
 *              to ten is where roughly nine tenths of the supply is still
 *              waiting to land on whoever bought early.
 *
 * Volume is deliberately a dollar floor and not a ratio. The published ratio is
 * against a day's volume — thirty percent of market cap by one account, a full
 * turn by another — and this window is five minutes. Dividing a daily figure by
 * two hundred and eighty-eight assumes a token trades evenly around the clock,
 * which is the one thing a memecoin never does.
 *
 * Both are measurements of the pool's shape at one instant, and neither knows
 * who holds what is in it. A pool can clear both of these and be emptied in the
 * next block by the one wallet that owns every position under it — which is the
 * commonest way a memecoin buyer loses their money, and nothing on this axis
 * can see it coming. That question is `readLock` in `lib/lock`, and the
 * terminal asks it before a shot; these two constants must not be read as
 * though they had.
 */
export const DEPTH_RATIO = 0.1;
export const DILUTION_LIMIT = 2;

/**
 * How hard the list is filtered, in one control.
 *
 * Two settings, and the lower one is still a floor. There used to be a third
 * below it that let everything through, which meant the screen could be sitting
 * on four dollars of volume while the control above it read "Any" — a word that
 * sounds like breadth and was working as an off switch. Any here means any
 * token that has cleared the floor, not any token at all, and there is no
 * longer a way to switch the floor off.
 *
 * The upper one was called `healthy`, and that was the most expensive word in
 * the app. It tests two ratios about the pool's shape — depth against size, and
 * supply already out against supply outright — and a reader reasonably heard it
 * as a verdict on whether the token was safe to buy, which is a question it has
 * never once asked. Tokens passed it and were rugged the same week, because
 * being deep is not the same as being un-pullable and the screen was never
 * claiming it was. `deep` says what the test does, and leaves the safety
 * question to the check that can actually answer it.
 */
export type Grade = "floor" | "deep";

/**
 * The reader's bar, applied to all four figures alike.
 *
 * Liquidity included. It was left out at first on the grounds that the healthy
 * ratio already covered it, which was wrong twice over: the ratio does not
 * apply at the `floor` grade at all, and at the smallest market caps it clears
 * at a hundred dollars of depth, which is not a market anybody can leave.
 */
export const FLOOR = 1_000;

/** The four figures every list in this app judges a pair by. */
export type Sized = {
  marketCap?: number;
  fdv?: number;
  liquidity: number;
  volume: number;
};

/** Above this, the entry belongs to somebody else. */
export function underCeiling(pair: Sized): boolean {
  return pair.marketCap === undefined || pair.marketCap <= CEILING;
}

/**
 * One floor, for every list that claims to have one.
 *
 * There were three, which is how a screen ends up promising a thousand dollars
 * and showing something else. The traded list tested all four figures and
 * refused a pair whose size the contract would not report; the launches list
 * tested depth alone, so a pool with five thousand dollars in it and a three
 * hundred dollar token passed; the terminal's target list tested depth and
 * volume but never size, and let an unreported supply through as though
 * unknown were small. A reader moving between three screens of the same app
 * was reading three different standards, none of them written down.
 *
 * Unknown is not small. A token whose supply its own contract will not report
 * has not been shown to clear anything, and the point of a floor is to stop
 * reading rows that have not been shown to be worth reading.
 *
 * Volume is the one axis that can be absent for a good reason: a pool that
 * opened twenty minutes ago and has not been touched since has none by
 * definition, and testing it there would empty the list of exactly the rows
 * that list exists to show. Nowhere else is it optional.
 */
export function clearsFloor(pair: Sized, traded = true): boolean {
  const { marketCap, fdv, liquidity, volume } = pair;
  if (marketCap === undefined || fdv === undefined) return false;
  if (marketCap < FLOOR || fdv < FLOOR || liquidity < FLOOR) return false;
  return !traded || volume >= FLOOR;
}
