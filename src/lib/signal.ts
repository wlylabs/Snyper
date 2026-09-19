import { CREATED_WINDOW, DEPTH_RATIO, PER_MINUTE } from "./screener";

/**
 * What a token is doing before it has done anything.
 *
 * Every list this app has shown so far ranks by volume, and so does every other
 * screener on every other chain. That ranking is honest and it is also the
 * whole problem: volume is what a run leaves behind it. A token at the top of a
 * volume list has already moved, and the entry the reader came for went to
 * whoever was in the pool while it was still near the bottom.
 *
 * So this ranks the derivative instead. Not how much has traded, but whether
 * the tape is filling — more buying than selling, arriving faster than it was,
 * from more than one pair of hands — while the price has not yet said so. That
 * combination is what the run is made of a few minutes before it is a run, and
 * it is the one shape a volume column cannot show, because at the moment it
 * matters the volume is still small.
 *
 * Nothing here costs a request. Every figure below is already in the swap logs
 * `useScreener` reads for the whole chain each cycle and was being thrown away:
 * the sign of the amounts, the recipient, the block. The screen was fetching
 * the answer and keeping only the part every other screen already prints.
 *
 * What it is not: a prediction, and not a safety check. A coil is a crowd
 * forming, and a crowd forms around a token that is about to be sold into just
 * as readily as around one that is about to run — whether the pool can be
 * emptied under it is `readLock` in `lib/lock`, and that question is asked
 * separately and answered separately. What it was measured to be worth is
 * under `Signal` below, in the numbers the measurement actually produced.
 */

/**
 * The tape behind one pool across the screener's window.
 *
 * Volume and trades are already on `Pair` and are deliberately not repeated —
 * those describe the pool for the reader, and these describe it for the score.
 * Both sides are kept rather than a net, because the ratio is the reading and a
 * net of zero cannot be told from nothing having happened.
 */
export type Flow = {
  /** Trades in the window, for this pool alone. */
  swaps: number;
  /** Trades that paid the quote token in, and trades that took it back out. */
  buys: number;
  sells: number;
  /** US dollars each way, on the quote side. */
  bought: number;
  sold: number;
  /**
   * Distinct recipients across the window.
   *
   * A proxy, and one that only ever errs downward. A router that forwards a
   * fill on to the trader is the address the pool sees, so a crowd that all
   * arrived through the same one counts as a single pair of hands. Measured on
   * chain 4663 that undercount is real but not fatal — across a live window the
   * pools carrying eight trades or more ran from 0.07 to 0.91 distinct
   * recipients per trade, which is a spread rather than a constant. Erring low
   * is the right direction for a screen whose whole claim is that it found the
   * entry early: it costs a true coil some score and never invents one.
   */
  takers: number;
  /**
   * Distinct blocks the window's swaps landed in.
   *
   * Insurance against the one thing recipients cannot catch: a burst bundled
   * into a block or two, which is one actor whatever addresses it wrote down.
   * On a chain settling every hundred milliseconds a real tape spreads out by
   * itself, and in the sampled window this reading never once bound — it was at
   * or above the recipient count every time. It is kept because the day it does
   * bind is the day the other reading is being gamed.
   */
  blocks: number;
  /** Trades in the older and the newer half of the window. */
  early: number;
  late: number;
};

/** Everything the score reads, which `Pair` already satisfies. */
export type Measured = {
  change: number;
  marketCap?: number;
  liquidity: number;
  age?: number;
  flow?: Flow;
};

/** The five questions, in the order the sheet prints them. */
export type Reading = "pressure" | "accel" | "breadth" | "depth" | "youth";

/**
 * What each reading is worth, and why they do not add up on a quiet row.
 *
 * The three flow readings carry seventy of the hundred between them, because
 * they are the only ones that describe what is happening rather than what is
 * true. Depth and youth are the two standing facts that decide whether the
 * thing happening is an entry at all: a coil in a pool nobody can leave is a
 * trap with a crowd in it, and a coil in a token that has been trading for a
 * week is somebody else's second wind.
 *
 * Nothing is renormalised over the readings that came back. A pair with no
 * tape scores the two it can answer and no more, which caps an untouched
 * launch at thirty however good it looks — and that is the honest shape of it,
 * because two readings is two readings. A screen that scaled those two up to a
 * hundred would be reporting confidence it bought by knowing less.
 */
export const WEIGHTS: Record<Reading, number> = {
  pressure: 0.3,
  accel: 0.2,
  breadth: 0.2,
  depth: 0.17,
  youth: 0.13,
};

/**
 * How many trades a window needs before its shape means anything.
 *
 * Eight, and the number was set by watching the first version get this wrong.
 * At four, the top of the list was pools with four trades: one in the older
 * half and three in the newer reads as a tripling, three distinct recipients
 * out of four reads as a crowd, and a single large buy reads as total buy
 * pressure. Every one of the fifteen highest scoring rows in that run was a
 * four-to-six trade pool that then went on to move a fraction of a percent.
 *
 * Eight puts roughly four trades on each side of the split, which is the least
 * that can tell a rate from a coincidence. It costs coverage and is worth it:
 * of three hundred and twenty two non-equity pools that traded in a sampled
 * window, seventy nine cleared eight and forty six cleared twelve. Below it the
 * three flow readings are reported as unread rather than guessed, which is why
 * the sheet prints how many of the five came back.
 */
export const MIN_TRADES = 8;

/**
 * Where buying starts counting, and where it is as loud as it gets.
 *
 * Both ends are measured rather than chosen. Across a live window, non-equity
 * pools carrying eight trades or more put the median buy share at 0.37 and the
 * ninetieth percentile at 0.69 — so an even split is genuinely the middle of
 * this chain, and three dollars bought for every one sold is genuinely the top
 * of it. A scale drawn anywhere tighter reports most of the chain as a coil.
 */
const BUYING = 0.5;
const BOUGHT = 0.75;

/**
 * The tape speeding up, and the smoothing that keeps a small window honest.
 *
 * The ratio is taken over both halves plus one rather than raw, because an
 * empty older half divides by nothing and a single trade in it turns the whole
 * window into a multiple of one. Measured, the smoothed ratio sits at 1.13 in
 * the middle and 3.5 at the ninetieth percentile, so the scale runs from level
 * to a tripling.
 */
const STEADY = 1;
const SURGING = 3;

/**
 * Hands per trade, from one in five up to seven in ten.
 *
 * Measured on the same population: a quarter of pools were under 0.21, the
 * middle was 0.31, and the ninetieth percentile was 0.53. A pool at the bottom
 * of that range is one address trading with itself in public, which is exactly
 * the row a volume ranking rewards and this one should not.
 */
const SHARED = 0.2;
const CROWDED = 0.7;

/**
 * The price that has not caught up yet, which is the whole point.
 *
 * Everything above describes a crowd arriving. This is the reading that decides
 * whether the reader is arriving with them or after them, and it multiplies the
 * other five rather than joining them — because buy pressure under a price that
 * has already tripled is not a coil, it is the run, seen from inside it. The
 * same sum that scores eighty on a flat price scores nothing on a token up a
 * hundred and fifty percent, and that is the intended inversion.
 *
 * Fifteen percent either way is the quiet band, against the fifty the screen
 * already uses to call something a move: a coil is meant to be caught before
 * the move, so its ceiling has to sit under the move's floor. Above it the
 * multiplier falls away to nothing by a hundred and fifty percent up — where
 * the entry is plainly gone — and rather sooner going down, by sixty percent,
 * because a price falling that hard in five minutes is a pool being left
 * rather than one being filled.
 */
const QUIET = 15;
const LOUD = 150;
const BLEED = 60;

/**
 * What a row scores, out of a hundred, and what that was measured to be worth.
 *
 * The test: four windows half an hour apart on chain 4663, scored exactly as
 * this file scores them, filtered by the same floor and ceiling the screen
 * applies, then read against the thirty minutes of chain that followed. Fifty
 * rows cleared the floor and forty-eight were still trading half an hour on.
 *
 * What came out, in full, including the part that does not flatter it:
 *
 *   Higher thirty minutes later, by score band — 54% under twenty, then 57%,
 *   63%, 67%, 67%. Monotonic across all five bands, which is the one result
 *   here worth having, and it is the difference between a coin flip and a
 *   two-in-three, on fifty rows.
 *
 *   The median return over those thirty minutes barely moved with the score at
 *   all: 0.18% in the lowest band against 0.27% in the fourth. The score moves
 *   how often a row is up, not how far.
 *
 *   The two biggest movers in the sample were nowhere near the top. The row
 *   that finished up twenty-seven percent scored 21, and the one that peaked
 *   eighty-two percent scored 22. This does not find lottery tickets and there
 *   is no reading in it that could.
 *
 *   Three of the forty-eight cleared the chip bar, which is the rate a loud
 *   mark should turn up at and is why the bar is where it is.
 *
 * Fifty rows is a small sample and this is written down rather than rounded up
 * because the number appears on a screen beside a button that spends money. A
 * coil is a better place to look than a volume column. It is not a forecast,
 * and no arrangement of five readings off five minutes of chain would be.
 */
export type Signal = {
  /** Nought to a hundred, after the quiet multiplier. */
  score: number;
  /** The multiplier itself, so the sheet can say why a loud row scored low. */
  quiet: number;
  /** Each reading in printing order, `undefined` where it could not be read. */
  readings: { key: Reading; weight: number; value: number | undefined }[];
  /** How many of the five came back. See `WEIGHTS` on why this is not hidden. */
  read: number;
};

/**
 * Where the chip turns on.
 *
 * Fifty five, and it is deliberately hard to reach: depth and youth together
 * are worth thirty, so a row cannot get here on standing facts alone — it needs
 * a quarter of the seventy that only a filling tape can pay, under a price that
 * has not moved. That is the sentence the chip is making, so it is the bar.
 *
 * Measured, three of forty-eight rows that cleared the screen's floor were
 * over it — and the rows that were had a two-in-three chance of being higher
 * half an hour later against a hair over half for the rest. That rate is the
 * point: the rest of the list still carries its score in the metadata line, in
 * the same dim type as the depth and the age, which follows the lock badge
 * above for the reason that one does. A list that puts a loud mark on its own
 * median is a list whose marks stop being read.
 */
export const COIL = 55;

const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** A reading placed on its own scale, nought at one end and one at the other. */
const span = (value: number, low: number, high: number): number =>
  clamp((value - low) / (high - low));

/** How long a token stays young, in minutes: the launches window, to the day. */
const YOUNG = Number(CREATED_WINDOW) / PER_MINUTE;

/**
 * Depth worth full marks, against the ratio the screen already grades by.
 *
 * Twice `DEPTH_RATIO`, so the grade's own bar — a tenth of the market cap
 * resting in the pool — scores half here rather than everything. Clearing the
 * bar is the floor of this reading, not the top of it.
 */
const BACKED = DEPTH_RATIO * 2;

/** Buying, as a share of the dollars that moved either way. */
function pressureOf(flow: Flow): number | undefined {
  if (flow.swaps < MIN_TRADES) return undefined;
  const moved = flow.bought + flow.sold;
  if (moved <= 0) return undefined;
  return span(flow.bought / moved, BUYING, BOUGHT);
}

/** The newer half of the window against the older one. */
function accelOf(flow: Flow): number | undefined {
  if (flow.swaps < MIN_TRADES) return undefined;
  return span((flow.late + 1) / (flow.early + 1), STEADY, SURGING);
}

/** Distinct hands per trade, on whichever of the two counts is lower. */
function breadthOf(flow: Flow): number | undefined {
  if (flow.swaps < MIN_TRADES) return undefined;
  return span(Math.min(flow.takers, flow.blocks) / flow.swaps, SHARED, CROWDED);
}

/** What is resting in the pool, against what the token claims to be worth. */
function depthOf(pair: Measured): number | undefined {
  if (pair.marketCap === undefined || pair.marketCap <= 0) return undefined;
  return span(pair.liquidity / pair.marketCap, 0, BACKED);
}

/** How much of the launches window the pair has left. */
function youthOf(pair: Measured): number | undefined {
  if (pair.age === undefined) return undefined;
  return clamp(1 - pair.age / YOUNG);
}

/** The multiplier: one while the price is still quiet, nothing once it is not. */
export function quietOf(change: number): number {
  return change >= 0
    ? clamp((LOUD - change) / (LOUD - QUIET))
    : clamp((BLEED + change) / (BLEED - QUIET));
}

/**
 * The five readings, the multiplier, and the number they come to.
 *
 * A reading that could not be taken contributes nothing and is reported as
 * nothing — see `WEIGHTS` on why it is not scaled away instead.
 */
export function signalOf(pair: Measured): Signal {
  const flow = pair.flow;
  const values: Record<Reading, number | undefined> = {
    pressure: flow && pressureOf(flow),
    accel: flow && accelOf(flow),
    breadth: flow && breadthOf(flow),
    depth: depthOf(pair),
    youth: youthOf(pair),
  };

  const readings = (Object.keys(WEIGHTS) as Reading[]).map((key) => ({
    key,
    weight: WEIGHTS[key],
    value: values[key],
  }));

  const quiet = quietOf(pair.change);
  const base = readings.reduce(
    (sum, reading) => sum + (reading.value ?? 0) * reading.weight,
    0,
  );

  return {
    score: Math.round(100 * base * quiet),
    quiet,
    readings,
    read: readings.filter((reading) => reading.value !== undefined).length,
  };
}

/** Whether a row has earned the chip. */
export function coiling(score: number): boolean {
  return score >= COIL;
}
