import type { Drift } from "./memory";
import { verdictOf, type Lock } from "./lock";
import { DEPTH_RATIO, DILUTION_LIMIT, FLOOR } from "./screener";

/**
 * Whether the thing the coil found can be walked away from.
 *
 * The score in `lib/signal` answers when, and answering when is half a screen.
 * A tape filling under a quiet price looks identical whether the crowd is
 * arriving at a token about to run or at one whose pool is about to be pulled
 * out from under it, and the reader of a list that only ranks opportunity has
 * no way to tell those apart — which is the exact shape of most of the money
 * lost buying memecoins.
 *
 * So this is the other axis, and it is deliberately the shape a reader already
 * knows from the rug checkers: a handful of named checks, each with a verdict,
 * and the worst of them standing for the row. Nothing here is new evidence —
 * the lock read, the depth, the supply and the drift were all already on the
 * screen, spread across a badge, a warning colour, a filter and a sheet note
 * that nobody read to the end of. Gathered into one verdict they are worth
 * more than they were scattered.
 *
 * Two things it will not do. It does not score: a risk total invites the reader
 * to average a rug against a thin pool, and those do not average. And it does
 * not answer for a check it could not take — an unreadable lock is reported as
 * unreadable, never as a pass, because a rug checker that shows green when it
 * failed to look is worse than no rug checker at all.
 */

export type Level = "clear" | "caution" | "danger";

export type CheckKey = "lock" | "exit" | "supply" | "market" | "drain";

export type Check = {
  key: CheckKey;
  /** Undefined when the check could not be taken at all. */
  level?: Level;
  /**
   * The figure the check turned on, for the row to print. Its unit is the
   * check's own — a share, a multiple, dollars, a drift — because a reader
   * scanning five lines wants what the check found, not what it concluded.
   */
  value?: number;
};

export type Risk = {
  /** The worst of the checks that could be taken. Undefined when none could. */
  verdict?: Level;
  checks: Check[];
  read: number;
};

/**
 * Below a thirtieth of its own size, a pool is not a discount, it is a door
 * that does not open. Above a tenth is the bar the app already measures by —
 * see `DEPTH_RATIO` — so this only has to name the floor under it.
 */
const STRANDED = 0.03;

/**
 * Five times the market cap in unissued supply is `screener`'s own danger line,
 * written down there and until now not acted on anywhere.
 */
const OVERHANG = 5;

/** Depth worth calling a market, against the floor the screen already has. */
const TRADEABLE = FLOOR * 5;

/** A fifth of a pool gone is worth saying; half of it gone is worth stopping. */
const LEAKING = 0.8;
const PULLED = 0.5;

const RANK: Record<Level, number> = { clear: 0, caution: 1, danger: 2 };

/** What a pair has to carry to be checked. */
export type Checkable = {
  marketCap?: number;
  fdv?: number;
  liquidity: number;
};

function band(value: number, caution: number, danger: number, lower: boolean): Level {
  if (lower) return value < danger ? "danger" : value < caution ? "caution" : "clear";
  return value > danger ? "danger" : value > caution ? "caution" : "clear";
}

/**
 * The lock, reduced the same way the sheet already reduced it — plus the two
 * things that used to be said underneath it in prose and are said here instead.
 *
 * Burned is the only pass, and `empty` is the only one of the rest that is
 * danger rather than caution: a pool with nothing left in it is not a risk, it
 * is an outcome. Withdrawable and unreadable are both caution, for the same
 * reason stated two different ways — in neither case does anything stop the
 * holder leaving with it.
 *
 * Two burns are not a pass, and both were previously a sentence a reader could
 * skip under a badge that said Locked:
 *
 *   A burn parked outside the price the pool trades at cannot be withdrawn and
 *   is also not holding anything up. Burning a range nobody trades in is the
 *   cheap way to buy a badge, and it buys nothing here. Only `false` demotes
 *   it — an unreadable price leaves `backsPrice` undefined, and undefined is
 *   not evidence of anything.
 *
 *   A pool with more positions than the check could enumerate has been read in
 *   part, so "every position is burned" means every position it got to. The
 *   ones it did not reach could be held by anybody.
 */
function lockCheck(lock: Lock | undefined): Check {
  if (!lock) return { key: "lock" };
  const verdict = verdictOf(lock);
  if (verdict === "empty") return { key: "lock", level: "danger" };
  if (verdict !== "burned") return { key: "lock", level: "caution" };
  const proven = lock.backsPrice !== false && !lock.partial;
  return { key: "lock", level: proven ? "clear" : "caution" };
}

export function riskOf(
  pair: Checkable,
  lock: Lock | undefined,
  drift: Drift | undefined,
): Risk {
  const { marketCap, fdv, liquidity } = pair;

  const checks: Check[] = [
    lockCheck(lock),
    marketCap === undefined || marketCap <= 0
      ? { key: "exit" }
      : {
          key: "exit",
          level: band(liquidity / marketCap, DEPTH_RATIO, STRANDED, true),
          value: liquidity / marketCap,
        },
    marketCap === undefined || fdv === undefined || marketCap <= 0
      ? { key: "supply" }
      : {
          key: "supply",
          level: band(fdv / marketCap, DILUTION_LIMIT, OVERHANG, false),
          value: fdv / marketCap,
        },
    { key: "market", level: band(liquidity, TRADEABLE, FLOOR, true), value: liquidity },
    drift?.depth === undefined
      ? { key: "drain" }
      : { key: "drain", level: band(drift.depth, LEAKING, PULLED, true), value: drift.depth },
  ];

  const taken = checks.filter((check) => check.level !== undefined);
  const worst = taken.reduce<Level | undefined>(
    (held, check) => (held === undefined || RANK[check.level!] > RANK[held] ? check.level : held),
    undefined,
  );

  /*
   * One check is decisive, and without it there is no verdict worth printing.
   *
   * The lock arrives per row and out of order — it is the most expensive read
   * in the app and `useLiquidityLocks` paces it — so for the first seconds of
   * a list every row has four checks answered and the one that matters
   * missing. Reporting the worst of the four would have put the word Good on
   * a pool that turns out a moment later to be withdrawable, and a safety
   * label that flickers from green to red is worse than one that waits: the
   * reader who acted on it acted on the green.
   *
   * Danger is the exception and is never premature. A pool that cannot be sold
   * out of is a pool that cannot be sold out of whoever holds the liquidity,
   * so a danger found among the other four stands on its own. Everything
   * gentler than that waits for the lock.
   */
  const decided = checks.find((check) => check.key === "lock")?.level !== undefined;
  const verdict = worst === "danger" || decided ? worst : undefined;

  return { verdict, checks, read: taken.length };
}
