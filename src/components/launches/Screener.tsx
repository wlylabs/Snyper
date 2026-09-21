"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Figure } from "@/components/ui/Figure";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, explorerAddress } from "@/lib/chains";
import { formatCompact, truncateAddress } from "@/lib/format";
import {
  CEILING,
  DEPTH_RATIO,
  DILUTION_LIMIT,
  FLOOR,
  LAUNCH_FLOOR,
  clearsFloor,
  clearsLaunchFloor,
  dropCopycats,
  inBand,
  underCeiling,
  type Band,
  type Grade,
} from "@/lib/screener";
import { shareOf, verdictOf, type Lock } from "@/lib/lock";
import { riskOf, type Check, type Level, type Risk } from "@/lib/risk";
import { coiling, filling, leaving, signalOf, type Signal } from "@/lib/signal";
import { driftOf, type Drift } from "@/lib/memory";
import { useLaunches } from "@/hooks/useLaunches";
import { useWatch } from "@/hooks/useWatch";
import { useLiquidityLock, useLiquidityLocks } from "@/hooks/useLiquidityLock";
import { useScreener, type Pair } from "@/hooks/useScreener";
import type { TKey } from "@/lib/i18n";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { useAppStore } from "@/store/useAppStore";

/**
 * The chart is fetched only once a pair is opened.
 *
 * It carries a charting library and the query that feeds it, and neither is
 * wanted by a reader scrolling the list — which is most of them, most of the
 * time. Behind a dynamic import it stays off the bundle the screen opens with.
 */
const PairChart = dynamic(() => import("./PairChart").then((module) => module.PairChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[190px] w-full rounded-[var(--radius-xs)]" />,
});

/** Where the rest of the market is already looking at this pair. */
const DEXSCREENER = "https://dexscreener.com/robinhood";

/** Under this many minutes old, a pair is still announcing itself. */
const FRESH = 180;

function age(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/** Everything on this screen is dollars — see the fold in `useScreener`. */
function usd(value: number | undefined): string {
  return value === undefined ? "—" : `$${formatCompact(value)}`;
}

function signed(change: number): string {
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

/**
 * A drift, written as the change it stands for rather than as the ratio it is.
 *
 * The meters above these sentences all read the same way — how much of a
 * reading a row earned — which is what makes them comparable and is also why
 * the two watched readings need their figures said again in words. A meter
 * full at "depth arriving" means the reading was maxed out, and a reader who
 * took that for "depth doubled" would be reading a different number entirely.
 */
function drifted(ratio: number): string {
  const percent = Math.round((ratio - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

/** The same for a figure that is naturally read as a multiple. */
function times(ratio: number): string {
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×`;
}

/**
 * Whether a row survives the reader's questions.
 *
 * The ceiling comes first and is not theirs to move: a token already worth more
 * than ten million is not an early entry whatever else is true of it.
 *
 * The floor is proof rather than size. A token whose supply the contract would
 * not report has not been shown to clear anything, so it fails every grade
 * above `all` — undefined is not small, it is unknown, and the reason to set a
 * floor is to stop reading rows that have not been shown to be worth reading.
 *
 * Liquidity is in the floor and not only in the ratio. Left to the ratio alone
 * it let a pool holding fifty dollars through: a tenth of a thousand-dollar
 * market cap is a hundred, and a hundred dollars of depth is not a market.
 */
function keep(pair: Pair, score: number, band: Band, grade: Grade, view: View): boolean {
  if (!underCeiling(pair)) return false;
  /*
   * A movement filter cannot be answered by something that has not moved. An
   * untraded pool is not rising and is not falling, it is silent, and letting
   * it fall into either band would be the screen making up an answer on its
   * behalf.
   *
   * The coil band needs no such guard and is the reason the old `flat` band is
   * gone. It asks whether the tape is filling, which a silent pool answers
   * honestly — with the two readings it has and a score that cannot reach the
   * band's bar on them. Nothing is invented and nothing is excluded by rule.
   */
  if ((band === "pumping" || band === "dumping") && pair.swaps === 0) return false;
  if (!inBand(pair.change, band, coiling(score))) return false;
  /*
   * Which floor, and it is the view that decides rather than the row. A pool
   * that opened an hour ago is the same pool whether the reader found it under
   * New or under Trending, but the two lists are asking different questions of
   * it — one whether it can be entered, the other whether it is worth entering
   * now — and a bar set for the second answers the first by refusing almost
   * everything. See `LAUNCH_FLOOR` for what that cost in rows.
   *
   * Deep escalates both of them to the same place. It is the thousand-dollar
   * bar plus the ratio, on either list, so nothing the launches are let off
   * here is out of the reader's reach — it is one tap away and always was.
   *
   * Volume is asked of a row only if that row has trades behind it.
   */
  if (grade === "deep") return clearsFloor(pair, pair.swaps > 0) && deep(pair);
  return view === "new" ? clearsLaunchFloor(pair) : clearsFloor(pair, pair.swaps > 0);
}

/** Deep enough for its size, and not mostly supply that has not arrived yet. */
function deep(pair: Pair): boolean {
  const { marketCap, fdv, liquidity } = pair;
  if (marketCap === undefined || fdv === undefined) return false;
  return liquidity >= marketCap * DEPTH_RATIO && fdv <= marketCap * DILUTION_LIMIT;
}

/** Whether the pool behind a row could absorb the position it is quoting. */
function thin(pair: Pair): boolean {
  return pair.marketCap !== undefined && pair.liquidity < pair.marketCap * DEPTH_RATIO;
}

/**
 * A row, what the chain says about its chances, and what this screen watched
 * it do to get there. The drift travels beside the signal rather than inside
 * it because the sheet prints it as figures — a span, a ratio — where the
 * signal only carries it as two readings out of seven.
 */
type Scored = { pair: Pair; signal: Signal; drift: Drift | undefined };

/**
 * Coil first, then busiest, then freshest.
 *
 * This used to be volume first, which is what every screener on every chain
 * does, and it is the one thing this screen should not do. Volume is the wake
 * a run leaves behind it: a token at the top of a volume column has already
 * moved, and the entry the reader opened this screen for belonged to whoever
 * was in the pool while it was still near the bottom of that column. Ranking
 * by it puts the answer to yesterday's question at the top of today's screen.
 *
 * So the first key is the score in `lib/signal` — buying against selling, the
 * tape's rate against its own rate five minutes ago, hands against trades, all
 * of it multiplied away as the price catches up. Volume is kept as the second
 * key rather than dropped, because between two rows the chain says nothing
 * about, the one money is going through is the better guess; and age settles
 * the rest, since everything nobody has touched has the same volume as
 * everything else nobody has touched. A pool with no creation in the last day
 * has no age and sits at the end — unknown is old here.
 */
function order(rows: Scored[]): Scored[] {
  return [...rows].sort(
    (a, b) =>
      b.signal.score - a.signal.score ||
      b.pair.volume - a.pair.volume ||
      (a.pair.age ?? Infinity) - (b.pair.age ?? Infinity),
  );
}

/**
 * Which of the screen's two windows the reader is looking through.
 *
 * They are two questions, not one list with a filter on it. New asks what
 * opened in the last day; trending asks what is moving in the last five
 * minutes. The app is named for the first and opens on it.
 */
type View = "new" | "trending";

/**
 * Whether the pool behind a row opened inside the creation window.
 *
 * An age is only ever set from a `PoolCreated` log, and that read covers a day
 * — see `CREATED_WINDOW`. So a row with an age is a row this screen watched
 * open, and a row without one is older than the window rather than unmeasured.
 */
function launched(pair: Pair): boolean {
  return pair.age !== undefined;
}

/**
 * Freshest first, then deepest.
 *
 * The other order ranks by the coil score and is right to, but it cannot rank
 * this list: a pool that opened and has not traded carries no tape, so the
 * signal scores it on the two standing facts it can answer for and every
 * untraded row lands on nearly the same number. Ordering the launches that way
 * put them in an order that looked considered and was mostly arbitrary, and it
 * buried the ten-minute-old pool under the twenty-hour-old one that had a
 * little volume behind it — which is the entry this screen exists to find.
 *
 * Age is the only key that means anything here, and depth settles the ties,
 * because between two pools opened in the same minute the one with money in it
 * is the one that can actually be bought from. Nothing needs a floor on top:
 * the day's launches are overwhelmingly empty pools, and `useLaunches` has
 * already kept only the forty deepest of them.
 */
function newest(rows: Scored[]): Scored[] {
  return [...rows].sort(
    (a, b) =>
      (a.pair.age ?? Infinity) - (b.pair.age ?? Infinity) ||
      b.pair.liquidity - a.pair.liquidity,
  );
}

/**
 * The two sources, as one list, one row per token.
 *
 * Per token and not per pool, which is the distinction that bit. A token can
 * have several pools and they do not have to agree: DEGEN turned up three
 * times in one reading — a thin pool that had traded and two deeper ones that
 * had not — pricing one contract at nine thousand dollars and at one and a
 * half million. A token has one size, so a screen showing it twice is a screen
 * contradicting itself, and the traded list has always folded by token for
 * exactly this reason. Merging by pool quietly opted the launches out of that
 * rule and then stood the results next to each other.
 *
 * The deepest pool wins the figures, because depth is what a price is worth
 * anything at: a market cap read off two thousand dollars of liquidity is a
 * number one person could have moved by themselves, and depth is already the
 * rule the launches are chosen by. Volume and trades are summed across the
 * token's pools rather than taken from the winner, since money that went
 * through a shallow pool still went through. Nothing is double counted — a
 * launch row carries no volume and no trades by construction, so a pool in
 * both sources adds zero to itself.
 */
function merge(traded: Pair[], launched: Pair[]): Pair[] {
  const byToken = new Map<string, Pair>();
  for (const pair of [...launched, ...traded]) {
    const key = pair.token.toLowerCase();
    const held = byToken.get(key);
    if (!held) {
      byToken.set(key, pair);
      continue;
    }
    const youngest = Math.min(held.age ?? Infinity, pair.age ?? Infinity);
    /*
     * The figures come from the deepest pool and the flow from the busiest,
     * which are not always the same pool and must not be forced to be. Depth
     * is what a price is worth anything at; a tape is only a tape where trades
     * happened, and the deepest of a token's pools is routinely the one nobody
     * has touched. Taking the flow from the winner would have thrown away the
     * whole signal every time a launch out-rested the pool doing the trading.
     */
    const busiest = pair.swaps > held.swaps ? pair : held;
    byToken.set(key, {
      ...(pair.liquidity > held.liquidity ? pair : held),
      volume: held.volume + pair.volume,
      swaps: held.swaps + pair.swaps,
      age: youngest === Infinity ? undefined : youngest,
      flow: busiest.flow,
    });
  }
  return [...byToken.values()];
}

/**
 * The verdict, and the colour it is read in.
 *
 * Three words and an absence, which is the whole vocabulary. A reader scanning
 * a list is not weighing a risk score against an opportunity score; they are
 * deciding whether to open the row, and three words decide that faster than any
 * number could. `undefined` is the fourth state and is never dressed as one of
 * the three — a check that has not come back yet is not a pass.
 */
const RISK_TONE: Record<Level, string> = {
  clear: "long",
  caution: "warn",
  danger: "short",
};

const RISK_DOT: Record<Level, string> = {
  clear: "dot-long",
  caution: "dot-warn",
  danger: "dot-short",
};

function riskWord(level: Level | undefined): TKey {
  return level === undefined ? "risk.unread" : (`risk.${level}` as TKey);
}

/**
 * The verdict at the head of the row's own line, as a dot and a word.
 *
 * It took the place of a chip and a word that used to carry the lock alone.
 * A chip is the loudest thing a row has and the risk verdict is on every row,
 * so it would have been a mark that stopped being read within a screenful —
 * and it was competing for the same corner as the coil, which is the other
 * half of the sentence and has to survive beside it. A dot is legible at a
 * glance, costs the row nothing, and is the one element on this screen that
 * is already used for exactly this: a state, in a colour.
 */
function RiskWord({
  pair,
  lock,
  drift,
}: {
  pair: Pair;
  lock: Lock | undefined;
  drift: Drift | undefined;
}) {
  const { t } = useI18n();
  /*
   * Worked out on the row rather than carried onto it. The checks are pure and
   * cost nothing, and the lock they need arrives per row and out of order —
   * see `useLiquidityLocks` for why it is paced — so a verdict computed where
   * the list is built would have been a verdict computed before its evidence.
   */
  const risk = riskOf(pair, lock, drift);
  const dot = risk.verdict === undefined ? "" : RISK_DOT[risk.verdict];
  const tone = risk.verdict === undefined ? "text-faint" : RISK_TONE[risk.verdict];
  return (
    <>
      <span className={`dot mr-1 inline-block align-middle ${dot}`} />
      <span className={`lbl ${tone}`}>{t(riskWord(risk.verdict))}</span>
      {" · "}
    </>
  );
}

/**
 * What each check found, in the check's own unit.
 *
 * A level decides the colour and a figure fills the line, because a reader
 * looking at five checks wants what was found rather than what was concluded:
 * "4% of mcap" says more than "caution" does, and the colour has already said
 * the caution part. The lock is the exception and keeps its own word — a
 * share of a pool burned is not a figure anybody reads as one, and the screen
 * already had the five words for it.
 */
function reading(check: Check, lock: Lock | undefined): string {
  if (check.key === "lock") return "";
  if (check.value === undefined) return "";
  if (check.key === "exit") return `${(check.value * 100).toFixed(0)}% MC`;
  if (check.key === "supply") return `${check.value.toFixed(1)}× MC`;
  if (check.key === "market") return usd(check.value);
  return drifted(check.value);
}

function CheckRow({ check, lock }: { check: Check; lock: Lock | undefined }) {
  const { t } = useI18n();
  const tone = check.level === undefined ? "text-faint" : RISK_TONE[check.level];

  if (check.level === undefined) {
    return (
      <Row k={t(`risk.${check.key}` as TKey)} v={<span className="num text-faint">—</span>} />
    );
  }

  /* The lock says which of its five answers it gave; the rest say a figure. */
  const said =
    check.key === "lock" && lock
      ? t(`lock.${verdictOf(lock)}` as TKey, {
          share: Math.round(shareOf(lock) ?? 0),
        })
      : reading(check, lock);

  return <Row k={t(`risk.${check.key}` as TKey)} v={<span className={`num ${tone}`}>{said}</span>} />;
}

/**
 * The rug check, as the reader already knows the shape of it.
 *
 * Five named checks and the worst of them at the top. There is deliberately no
 * total: a risk score invites a reader to average a pool that can be pulled
 * against one that is merely thin, and those two do not average — one of them
 * ends at zero. The worst check is the verdict because the worst check is what
 * happens to you.
 */
function RiskPanel({ risk, lock, loading }: { risk: Risk; lock: Lock | undefined; loading: boolean }) {
  const { t } = useI18n();

  return (
    <>
      <Panel label={t("risk.title")}>
        <Row
          k={t("risk.verdict")}
          v={
            loading && risk.verdict === undefined ? (
              <span className="skel inline-block h-[12px] w-[72px] align-middle" />
            ) : (
              <span
                className={`num ${risk.verdict === undefined ? "text-faint" : RISK_TONE[risk.verdict]}`}
              >
                {t(riskWord(risk.verdict))}
              </span>
            )
          }
        />
        {risk.checks.map((check) => (
          <CheckRow key={check.key} check={check} lock={lock} />
        ))}
      </Panel>
      <p className="mt-2 text-[11px] text-dim">{t("risk.hint")}</p>
    </>
  );
}

/**
 * The score, in the two registers the lock verdict already established.
 *
 * A chip beside the ticker is loud, so it is spent only on the answer worth
 * stopping a scroll for — a tape filling under a price that has not moved yet.
 * That is rare by construction: depth and youth together cannot reach the bar,
 * so nothing gets the chip on standing facts alone.
 *
 * Every other row carries the same number quietly, at the end of the metadata
 * line in the same dim type as the depth and the age. It is printed rather
 * than hidden because the list is now sorted by it, and a reader owed an
 * explanation for the order should not have to open a sheet to get one.
 */
function SignalChip({ signal }: { signal: Signal }) {
  const { t } = useI18n();
  if (!coiling(signal.score)) return null;
  return (
    <span className="chip chip-xs chip-coil ml-1.5">
      {t("signal.tag", { score: signal.score })}
    </span>
  );
}

/**
 * The row's one word about what this screen watched the pool do.
 *
 * Only where the coil chip is not, and only upward. See `filling` in
 * `lib/signal` for why both marks never sit on the same row, and `leaving` for
 * where the opposite of this is said instead.
 */
function FillingChip({ signal, drift }: { signal: Signal; drift: Drift | undefined }) {
  const { t } = useI18n();
  if (coiling(signal.score) || !filling(drift)) return null;
  return (
    <span className="chip chip-xs chip-coil ml-1.5">
      {t("signal.tagFilling", { percent: Math.round(((drift?.depth ?? 1) - 1) * 100) })}
    </span>
  );
}

function SignalWord({ signal }: { signal: Signal }) {
  const { t } = useI18n();
  if (coiling(signal.score)) return null;
  return (
    <>
      {" · "}
      <span className="lbl">{t("signal.word", { score: signal.score })}</span>
    </>
  );
}

/** What was watched, in one line, saying only what it actually has. */
function watched(t: (key: TKey, vars?: Record<string, string | number>) => string, drift: Drift | undefined): string {
  if (!drift) return t("signal.watching");
  const span = age(drift.span);
  if (drift.depth === undefined) return t("signal.watchedFlat", { span, samples: drift.samples });
  const depth = drifted(drift.depth);
  return drift.trade === undefined
    ? t("signal.watchedDepth", { span, samples: drift.samples, depth })
    : t("signal.watched", { span, samples: drift.samples, depth, trade: times(drift.trade) });
}

/** One reading, drawn as the share of the bar it fills. */
function Meter({ value }: { value: number }) {
  const filled = Math.round(value * 100);
  return (
    <span className="flex items-center gap-2">
      <span className="meter" aria-hidden>
        <span style={{ width: `${filled}%` }} />
      </span>
      <span className="num w-[34px] text-right">{`${filled}%`}</span>
    </span>
  );
}

/**
 * Why the row scored what it scored, reading by reading.
 *
 * The number on its own would be an oracle, and this app does not ship those:
 * a reader about to spend money on the strength of a figure is owed the parts
 * it was made of and the ones that could not be read at all. The five are
 * printed in the order they are weighted, the quiet multiplier last because it
 * is the only one that divides rather than adds, and the count underneath says
 * how much of the evidence actually came back — which is the difference
 * between a low score and a quiet chain.
 */
function SignalPanel({ signal, drift }: { signal: Signal; drift: Drift | undefined }) {
  const { t } = useI18n();

  return (
    <>
      <Panel label={t("signal.title")}>
        <Row
          k={t("signal.score")}
          v={
            <Figure
              className={`num ${coiling(signal.score) ? "long" : ""}`}
              value={String(signal.score)}
            />
          }
        />
        {signal.readings.map((reading) => (
          <Row
            key={reading.key}
            k={t(`signal.${reading.key}` as TKey)}
            v={
              reading.value === undefined ? (
                <span className="num text-faint">{t("signal.unread")}</span>
              ) : (
                <Meter value={reading.value} />
              )
            }
          />
        ))}
        <Row k={t("signal.quiet")} v={<Meter value={signal.quiet} />} />
        <Row
          k={t("signal.read")}
          v={
            <span className="num">{`${signal.read} / ${signal.readings.length}`}</span>
          }
        />
      </Panel>

      {/*
       * Three lines under the panel, at most, and each one earns its place: the
       * span the watched readings were taken over, what the score is and is
       * not, and — only when it happened — money that has left the pool.
       *
       * There were five paragraphs here, which is a wall rather than a note,
       * and a wall gets skipped exactly like a badge on every row does. The
       * count of readings that came back moved into the panel as a figure,
       * where it is read at a glance instead of explained.
       */}
      <div className="mt-2 grid gap-1">
        <p className="text-[11px] text-faint">{watched(t, drift)}</p>
        <p className="text-[11px] text-dim">{t("signal.hint")}</p>
        {leaving(drift) && (
          <p className="text-[11px] warn">
            {t("signal.leaving", { percent: Math.round((1 - (drift?.depth ?? 1)) * 100) })}
          </p>
        )}
      </div>
    </>
  );
}

function PairSheet({
  entry,
  onSnipe,
  onClose,
}: {
  entry: Scored | undefined;
  onSnipe: (pair: Pair) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  /*
   * Asked for the pool this row was built from, and only while the sheet is
   * open — the hook is the most expensive question in the app and a reader
   * scrolling the list behind this has not asked it.
   */
  const { lock, loading: lockLoading, failed: lockFailed } = useLiquidityLock(entry?.pair.pool);

  if (!entry) return null;
  const { pair, signal, drift } = entry;
  const risk = riskOf(pair, lock, drift);

  return (
    <Sheet open title={t("launches.pair")} onClose={onClose}>
      <div className="identity">
        <div>
          <p className="text-[19px] leading-tight font-bold">
            {pair.symbol}
            <span className="text-faint">/{pair.quote}</span>
          </p>
          <p className="num mt-1 text-[11px] text-faint">{truncateAddress(pair.token, 6, 4)}</p>
        </div>
        <div className="mt-1">
          <p className="num text-[26px] leading-none">
            <Figure value={usd(pair.marketCap)} />
          </p>
          <p className="lbl mt-1">{t("launches.mcap")}</p>
          <p className={`lbl mt-2 ${pair.change >= 0 ? "long" : "short"}`}>
            <Figure value={signed(pair.change)} />
          </p>
        </div>
      </div>

      <div className="px-3 pb-4">
        <div className="mb-3">
          <PairChart pair={pair} />
        </div>

        {/*
         * Why this row is where it is, before what it is. The chart says what
         * the price has done and the panel below says how big the thing is;
         * neither answers the question the reader came to this screen with,
         * which is whether anybody is arriving yet.
         */}
        <div className="mb-3">
          <SignalPanel signal={signal} drift={drift} />
        </div>

        <Panel>
          <Row k={t("launches.fdv")} v={<Figure className="num" value={usd(pair.fdv)} />} />
          <Row
            k={t("launches.volume")}
            v={<Figure className="num" value={usd(pair.volume)} />}
          />
          <Row
            k={t("launches.liquidity")}
            v={<Figure className="num" value={usd(pair.liquidity)} />}
          />
          <Row k={t("launches.trades")} v={<Figure className="num" value={String(pair.swaps)} />} />
          <Row k={t("launches.age")} v={<Figure className="num" value={age(pair.age)} />} />
          <Row
            k={t("launches.pool")}
            v={<span className="num">{`${pair.fee / 10_000}%`}</span>}
          />
          <Row
            k={t("launches.token")}
            v={<span className="num">{truncateAddress(pair.token, 8, 6)}</span>}
          />
        </Panel>

        {/*
         * Under the figures rather than beside them, because it is a different
         * kind of fact: everything above describes what the pool is doing, and
         * this describes whether it will still be there.
         */}
        <div className="mt-3">
          <RiskPanel risk={risk} lock={lock} loading={lockLoading && !lockFailed} />
        </div>

        {/*
         * The one action on this sheet, above the two places to go and read
         * more about it. Everything above this — the chart, the depth, the age
         * — is there to answer one question, and it was ending in two outbound
         * links and no way to act on the answer.
         */}
        <button
          type="button"
          className="btn btn-accent aim mt-3 w-full"
          onClick={() => onSnipe(pair)}
        >
          <Icon name="crosshair" size={14} />
          {t("launches.snipe", { symbol: pair.symbol })}
        </button>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <a
            href={explorerAddress(CHAIN_ID, pair.token)}
            target="_blank"
            rel="noreferrer"
            className="tile justify-center"
          >
            <Icon name="external" size={14} className="text-dim" />
            {t("common.explorer")}
          </a>
          {/*
           * Out to the pair's own page, by pool address rather than by token:
           * a token with several pools has a page per pool there, and the one
           * worth opening is the one this row was built from.
           */}
          <a
            href={`${DEXSCREENER}/${pair.pool}`}
            target="_blank"
            rel="noreferrer"
            className="tile justify-center"
          >
            <Icon name="candles" size={14} className="text-dim" />
            {t("launches.dexscreener")}
          </a>
        </div>
      </div>
    </Sheet>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
      ))}
    </div>
  );
}

export function Screener() {
  const mounted = useMounted();
  const { t } = useI18n();
  /*
   * The screen opens on the launches.
   *
   * This is the whole point of the rename. Both lists were merged into one and
   * ranked together, and ranking is exactly what a launch cannot survive: it
   * has no volume and no trades by construction, so it lost the second and
   * third keys of `order` to anything that had traded at all, and it could
   * only ever win on a coil score read off a tape it does not have. The most
   * valuable rows on the screen were the hardest ones to see on it.
   *
   * So they get the screen, and the merged list keeps its order under the
   * other tab. The merge itself stays — a token that opened today and has been
   * traded since is one row with both sets of figures, and it belongs in both
   * views.
   */
  const [view, setView] = useState<View>("new");
  const [band, setBand] = useState<Band>("all");
  /*
   * The screen opens with the floor on.
   *
   * It used to open on `all`, which applies no floor at all, and nothing on the
   * screen said so — so a reader who had been told the list has a thousand
   * dollar minimum saw four dollars of volume in it and was right to call that
   * broken. The filter was never leaking; the screen was simply starting with
   * it switched off. The terminal has always applied the same floor and has no
   * control to switch it off, and two screens reading one chain to two unstated
   * standards is the actual defect.
   */
  const [grade, setGrade] = useState<Grade>("floor");
  const [opened, setOpened] = useState<string>();
  const { pairs, births, head, loading, error, refetch } = useScreener();
  const router = useRouter();
  const aim = useAppStore((state) => state.aim);

  /*
   * Hand the whole pair over and go. The terminal can quote anything it is
   * given, so nothing here has to check whether its own list would have
   * carried this one — and the launches list is full of pairs that would not
   * be in it, because a pool nobody traded in the last five minutes is still a
   * pool you can buy from.
   */
  const snipe = (pair: Pair) => {
    aim(pair);
    router.push("/");
  };
  const { launches, loading: pricing } = useLaunches(births, head, true);

  /*
   * Copycats go before the reader's own filters rather than after them. Which
   * contract holds a ticker is decided against everything the screen knows
   * about, so a band or a grade that happens to exclude the real one cannot
   * promote a copy into being the only thing wearing the name.
   */
  const all = useMemo(() => dropCopycats(merge(pairs, launches)), [pairs, launches]);
  /*
   * This reading goes into the record before anything is scored against it.
   * The screen is the only caller that records — see `useWatch` — because it
   * is the only one holding both sources merged into one row per token, which
   * is the shape everything filed under a token has to have been measured in.
   */
  const watch = useWatch(all, head);

  /*
   * Scored once, then filtered and ordered on what came out. The band reads
   * the score, the order reads the score and both chips read the score, and a
   * screen that worked it out in three places would eventually work it out
   * three ways.
   */
  const scored = useMemo(
    () =>
      all.map((pair) => {
        const drift = driftOf(watch[pair.token.toLowerCase()]);
        return { pair, drift, signal: signalOf({ ...pair, drift }) };
      }),
    [all, watch],
  );
  /*
   * The view narrows first, because it is not one of the reader's filters. The
   * band and the grade are questions about a row; this is a question about
   * which of the chain's two windows is on screen, and the counts under the
   * header have to be counts of that window rather than of both.
   */
  const inView = useMemo(
    () => (view === "new" ? scored.filter(({ pair }) => launched(pair)) : scored),
    [scored, view],
  );
  /*
   * The band is not asked of the launches at all, and that is stronger than
   * hiding its control. A segmented row left on Pumping and then taken off
   * screen is a filter the reader can neither see nor clear — so the new view
   * answers as though it were All, and the trending view reads it back exactly
   * where it was left.
   */
  const listed = useMemo(() => {
    const kept = inView.filter(({ pair, signal }) =>
      keep(pair, signal.score, view === "new" ? "all" : band, grade, view),
    );
    return view === "new" ? newest(kept) : order(kept);
  }, [inView, band, grade, view]);

  /*
   * Filled in the background of the list the reader is already reading, and
   * shared with the sheet — a row checked here is a row the sheet does not have
   * to check again. See `useLiquidityLocks` for what that costs and why it is
   * paced rather than fired at once.
   */
  const pools = useMemo(() => listed.map(({ pair }) => pair.pool), [listed]);
  const locks = useLiquidityLocks(pools);

  const body = () => {
    /*
     * Both reads, not just the first. The launches are priced after the
     * screener hands over the day's pool creations, so showing the traded rows
     * the moment they land would reflow the list under the reader's thumb a
     * moment later.
     */
    if (!mounted || loading || (pricing && launches.length === 0)) return <Loading />;

    if (error) {
      return (
        <Empty
          title={t("launches.failed")}
          hint={t("launches.failedHint")}
          action={
            <button type="button" className="btn btn-sm btn-short" onClick={() => void refetch()}>
              <Icon name="refresh" size={13} />
              {t("balance.retry")}
            </button>
          }
        />
      );
    }

    if (listed.length === 0) {
      /*
       * An empty five minutes and an empty filter are different failures, and
       * a reader who has narrowed the list to nothing should be told that they
       * did it rather than that the chain went quiet.
       */
      return inView.length === 0 ? (
        <Empty
          title={t(view === "new" ? "launches.emptyNew" : "launches.empty")}
          hint={t(view === "new" ? "launches.emptyNewHint" : "launches.emptyHint")}
        />
      ) : (
        <Empty
          title={t("launches.noMatch")}
          hint={t("launches.noMatchHint")}
          action={
            <button
              type="button"
              className="btn btn-sm btn-short"
              onClick={() => {
                setBand("all");
                setGrade("floor");
              }}
            >
              {t("launches.clear")}
            </button>
          }
        />
      );
    }

    return (
      <div className="flex flex-col gap-1.5">
        {listed.map(({ pair, signal, drift }) => (
          /*
           * Two controls, side by side, rather than one inside the other — a
           * button cannot legally contain a button, and the reader is asking
           * two different questions anyway: tell me more, or take me to it.
           */
          <div key={pair.pool} className="flex items-stretch gap-1.5">
          <button
            type="button"
            className="tile min-w-0 flex-1"
            onClick={() => setOpened(pair.pool)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {pair.symbol}
                <span className="font-normal text-faint">/{pair.quote}</span>
                {/*
                 * One chip about what the row is doing, at most, and then the
                 * lock. The three are in order of what they claim: a coil is
                 * the strongest, depth arriving is the part of a coil that can
                 * stand alone, and NEW is a fact about the calendar. A row
                 * that has earned a louder one gives up the quieter, and the
                 * age it would have said is three words along the line below.
                 */}
                {pair.age !== undefined &&
                  pair.age < FRESH &&
                  !coiling(signal.score) &&
                  !filling(drift) && (
                    <span className="chip chip-xs chip-live ml-1.5">{t("launches.fresh")}</span>
                  )}
                <SignalChip signal={signal} />
                <FillingChip signal={signal} drift={drift} />
              </span>
              {/*
               * A row nobody has traded has no volume and has not moved, so it
               * says what it does have — how deep it is and how long it has
               * existed — rather than printing two zeroes that read as a
               * failed call. Decided per row, since both kinds share one list.
               */}
              <span className="block truncate text-[11px] font-normal text-faint">
                <RiskWord pair={pair} lock={locks.get(pair.pool.toLowerCase())} drift={drift} />
                {pair.swaps > 0 && (
                  <>
                    <span className="lbl">{t("launches.volShort")}</span>{" "}
                    <Figure className="num" value={usd(pair.volume)} />
                    {" · "}
                  </>
                )}
                <span className={`lbl ${thin(pair) ? "warn" : ""}`}>
                  {t("launches.liqShort")}
                </span>{" "}
                <Figure className={`num ${thin(pair) ? "warn" : ""}`} value={usd(pair.liquidity)} />
                {" · "}
                <Figure className="num" value={age(pair.age)} />
                <SignalWord signal={signal} />
              </span>
            </span>
            <span className="shrink-0 text-right">
              <Figure className="num block text-[12px]" value={usd(pair.marketCap)} />
              {pair.swaps > 0 ? (
                <Figure
                  className={`num block text-[11px] font-normal ${pair.change >= 0 ? "long" : "short"}`}
                  value={signed(pair.change)}
                />
              ) : (
                <span className="lbl block">{t("launches.mcapShort")}</span>
              )}
            </span>
          </button>
          <button
            type="button"
            className="tile aim w-[46px] shrink-0 justify-center px-0 text-accent"
            aria-label={t("launches.snipe", { symbol: pair.symbol })}
            onClick={() => snipe(pair)}
          >
            <Icon name="crosshair" size={16} />
          </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="sr-only">{t("page.launches.title")}</h1>

      {mounted && (
        <div className="mb-3 flex flex-col gap-1.5">
          {/*
           * Two windows, named for what each one can see rather than for how
           * it is sorted. New is the day's pool creations, priced off what is
           * resting in them; trending is the last five minutes of swaps. The
           * app opens on the first because that is the only one of the two
           * still holding entries nobody has taken.
           */}
          <Segmented
            options={[
              { value: "new", label: t("launches.viewNew") },
              { value: "trending", label: t("launches.viewTrending") },
            ]}
            value={view}
            onChange={setView}
          />
          {/*
           * Asking for a movement narrows the list to rows that have moved,
           * which is what it has always meant — it also drops the ones that
           * have not traded at all, because silence is not a direction.
           *
           * The first of the three is the odd one and the point of the screen.
           * It asks for what has not moved yet and has a crowd arriving under
           * it, which is the only one of these four questions whose answer is
           * still buyable. It took the place of a band called Flat, which
           * could not tell a token being accumulated from one nobody had
           * looked at in five minutes.
           *
           * And it is gone under the launches, because almost none of them can
           * answer it — which is the same rule as the one above, taken to its
           * conclusion. A pool that opened and has not traded is silent on all
           * four counts, so three of these options would empty that list and
           * the fourth is the only one ever in force. A control whose every
           * setting but one is a dead end is worse than no control. Depth,
           * below, every launch can answer, so depth stays on both.
           */}
          {view === "trending" && (
            <Segmented
              options={[
                { value: "all", label: t("launches.bandAll") },
                { value: "coiling", label: t("launches.bandCoil") },
                { value: "pumping", label: t("launches.bandPump") },
                { value: "dumping", label: t("launches.bandDump") },
              ]}
              value={band}
              onChange={setBand}
            />
          )}
          <Segmented
            options={[
              { value: "floor", label: t("launches.gradeAll") },
              { value: "deep", label: t("launches.gradeDeep") },
            ]}
            value={grade}
            onChange={setGrade}
          />
        </div>
      )}

      <Panel
        /*
         * The header names the window the reader is in, and how it is ordered.
         * It used to name both windows at once because there was only ever one
         * list; now that they are two, a header still saying `coil ranked`
         * over a list ordered by age would be describing the other tab.
         *
         * Both labels say both bars, because both bars are on in both views.
         * The floor is one figure short under the launches rather than absent
         * — `clearsFloor` asks it of the market cap, the fully diluted figure
         * and the depth either way, and only lets a row off the volume leg if
         * nothing has traded — and a header that quietly dropped it there
         * would be understating what emptied the list. A measured reading:
         * thirty-nine pools opened in the day, five of them clear a thousand
         * dollars, and a reader looking at five rows deserves to know which
         * number took the other thirty-four.
         *
         * What the window is stays off the line. It is the longest fact and
         * the least surprising one — the tab is called New, every row prints
         * its own age in hours, and the empty state says the day outright —
         * and the label is one line on a phone before it truncates.
         *
         * The figure follows the grade and not only the view, because Deep
         * escalates the launches back to the thousand — see `keep`. A header
         * left saying the launch floor under a list the reader had just
         * narrowed past it would be naming a bar that had stopped running, in
         * the one place on the screen whose whole job is to name the bar.
         */
        label={
          view === "new"
            ? t("launches.opened", {
                floor: `$${formatCompact(grade === "deep" ? FLOOR : LAUNCH_FLOOR)}`,
              })
            : t("launches.live", { floor: `$${formatCompact(FLOOR)}` })
        }
        meta={
          mounted && inView.length > 0 ? (
            <span className="lbl">
              {t("launches.showing", { shown: listed.length, total: inView.length })}
            </span>
          ) : undefined
        }
      >
        {body()}
      </Panel>

      <PairSheet
        entry={listed.find(({ pair }) => pair.pool === opened)}
        onSnipe={snipe}
        onClose={() => setOpened(undefined)}
      />
    </div>
  );
}
