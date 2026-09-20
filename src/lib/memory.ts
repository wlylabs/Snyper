import { WINDOW } from "./screener";

/**
 * What this app saw the last time it looked.
 *
 * Every screener on this chain is a camera: it reads five minutes of swaps,
 * prints them, and forgets. That is not a design choice anybody made, it is the
 * endpoint's cap — chain 4663 refuses a query for more than ten thousand logs,
 * and five minutes is what fits. So every screen here, this one included, has
 * been answering questions about five minutes and letting the reader imagine
 * the hour.
 *
 * The hour is available for nothing. The screen already re-reads the chain
 * every thirty seconds; it simply threw the last reading away before taking the
 * next one. Keeping them turns the app from a camera into a witness, and a
 * witness can answer the two questions that matter most before a run and that
 * no single window can reach:
 *
 *   Is depth arriving? Someone funding a pool over half an hour is the
 *   clearest thing a memecoin does before it moves, and it is invisible inside
 *   a five-minute window because the pool's balance is a standing figure — it
 *   looks the same whether it has been there for an hour or arrived a minute
 *   ago. Two readings apart in time is the whole of what it takes to tell.
 *
 *   Is it busier than it was? The window's own halves answer a version of this
 *   and answer it badly: four trades against four is not a rate. Two readings
 *   five minutes apart are two disjoint five-minute windows, which is a rate.
 *
 * What this is not, and the screen says so rather than implying otherwise: a
 * history. It is what this browser happened to be open for. Close the tab for
 * six hours and the gap is real — the oldest reading kept is still true, and
 * what happened inside the gap was not watched by anyone. So every figure
 * derived here is printed beside the span it was actually measured over, never
 * beside a span it was assumed to cover.
 */

/** One reading of one token, at the block the screen read the chain at. */
export type Sample = {
  /** The chain's clock rather than the browser's, and the only one worth using:
      it keeps counting while a laptop sleeps and cannot be set wrong. */
  block: number;
  /** What the token was worth, what was resting behind it, what traded. */
  cap: number;
  liq: number;
  vol: number;
};

/** Readings by token address, lowercased. */
export type Watch = Record<string, Sample[]>;

/** What a row has to carry to be worth remembering. */
export type Watchable = {
  token: string;
  marketCap?: number;
  liquidity: number;
  volume: number;
};

/**
 * One reading per window, and never two of the same window.
 *
 * The screen refetches every thirty seconds and the window it reads is five
 * minutes wide, so nine readings in ten describe a window already recorded.
 * Spacing the samples a full window apart is what makes the volume figures
 * comparable at all: two readings this far apart cover five minutes each and
 * do not overlap, which is the difference between a rate and the same trades
 * counted twice.
 */
const GAP = Number(WINDOW);

/**
 * How many readings a token keeps, and how far back they are allowed to reach.
 *
 * Eighteen at a window apart is an hour and a half, which is the span a
 * memecoin's accumulation actually happens over and comfortably more than the
 * five minutes anything else on this chain can see. The horizon throws away
 * what is older even when the count would not, because a reading from this
 * morning next to one from now is not a trend, it is two facts with a day
 * between them.
 */
const SAMPLES = 18;
const HORIZON = GAP * 24;

/**
 * How many tokens are remembered at once.
 *
 * Sixty, which is more than the list shows and less than the chain carries.
 * This lives in the reader's own browser storage beside their settings and
 * their cost basis, and a screener that quietly grew to a megabyte of someone
 * else's disk would deserve everything it got. When the cap is reached the
 * tokens nobody has seen for longest go first.
 */
const TOKENS = 60;

/**
 * Stored small on purpose.
 *
 * These are estimates read off a pool, not accounts, and six significant
 * figures is more precision than any of them has. Rounding before writing is
 * the difference between a hundred kilobytes and three hundred, on storage
 * this app is only borrowing.
 */
function trim(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Number(value.toPrecision(6));
}

/**
 * The readings, with this one folded in — or the same readings back, unchanged.
 *
 * Returning the identical object when nothing was recorded is not an
 * optimisation, it is what keeps the screen from re-rendering itself every
 * thirty seconds for a sample it decided not to take. Two screens reading the
 * same query both call this; the second one finds the window already recorded
 * and changes nothing.
 */
export function remember(watch: Watch, rows: readonly Watchable[], head: bigint): Watch {
  const block = Number(head);
  let next: Watch | undefined;

  for (const row of rows) {
    const key = row.token.toLowerCase();
    const kept = watch[key] ?? [];
    const last = kept[kept.length - 1];
    if (last && block - last.block < GAP) continue;

    /*
     * A row whose size the contract would not report is remembered anyway, at
     * a cap of nothing. The depth and the volume are still readable and are
     * still the two figures most of this is made of, and refusing the whole
     * reading over the one missing figure would lose the pool exactly while it
     * is newest.
     */
    const sample: Sample = {
      block,
      cap: trim(row.marketCap ?? 0),
      liq: trim(row.liquidity),
      vol: trim(row.volume),
    };

    next ??= { ...watch };
    next[key] = [...kept, sample]
      .filter((entry) => block - entry.block <= HORIZON)
      .slice(-SAMPLES);
  }

  if (!next) return watch;

  /* The oldest-seen tokens go when there are too many to keep. */
  const keys = Object.keys(next);
  if (keys.length <= TOKENS) return next;
  const newest = (key: string) => next![key][next![key].length - 1]?.block ?? 0;
  const kept = keys.sort((a, b) => newest(b) - newest(a)).slice(0, TOKENS);
  return Object.fromEntries(kept.map((key) => [key, next![key]]));
}

/**
 * What changed between the first reading kept and the last one.
 *
 * Every figure comes with the span it was measured over, and nothing is
 * reported at all until that span is two windows wide. Ten minutes is the
 * least that can be called a direction; below it this is a screen dressing one
 * refetch up as a trend, which is the whole failure it exists to avoid.
 */
export type Drift = {
  /** Minutes between the oldest reading kept and the newest. */
  span: number;
  samples: number;
  /** What is resting in the pool now, against what was resting then. */
  depth?: number;
  /** What the token is worth now, against then. */
  cap?: number;
  /** The newest window's trading, against the median of the windows before it. */
  trade?: number;
};

/** The least the readings have to span before any of them is a direction. */
const SETTLED = GAP * 2;

/** Windows needed before a median of the earlier ones means anything. */
const RATED = 4;

/** Blocks per minute on chain 4663 — see `PER_MINUTE` in `lib/screener`. */
const MINUTE = 600;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export function driftOf(raw: readonly Sample[] | undefined): Drift | undefined {
  if (!raw || raw.length < 2) return undefined;
  /*
   * The horizon is applied again here rather than trusted from the write.
   * Readings are only pruned when a token is recorded, so one that dropped off
   * the screen for three hours and came back carries its old readings until
   * the write that re-adds it — and the render between those two moments would
   * otherwise print a drift measured across the gap. Reading it back through
   * the same horizon makes that a shorter span or no span at all, which is
   * what it always was.
   */
  const last = raw[raw.length - 1];
  const samples = raw.filter((entry) => last.block - entry.block <= HORIZON);
  if (samples.length < 2) return undefined;

  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const blocks = newest.block - oldest.block;
  if (blocks < SETTLED) return undefined;

  const drift: Drift = {
    span: blocks / MINUTE,
    samples: samples.length,
    depth: oldest.liq > 0 ? newest.liq / oldest.liq : undefined,
    cap: oldest.cap > 0 && newest.cap > 0 ? newest.cap / oldest.cap : undefined,
  };

  /*
   * The newest window against the middle of the ones before it, rather than
   * against the one before it. A single quiet window is ordinary and a run of
   * them is the baseline this is asking the newest window to beat; comparing
   * two adjacent readings would call every other refetch a surge.
   */
  if (samples.length >= RATED) {
    const earlier = samples.slice(0, -1).map((entry) => entry.vol);
    const middle = median(earlier);
    if (middle > 0) drift.trade = newest.vol / middle;
  }

  return drift;
}
