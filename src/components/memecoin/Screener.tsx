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
  clearsFloor,
  dropCopycats,
  inBand,
  underCeiling,
  type Band,
  type Grade,
} from "@/lib/screener";
import { shareOf, verdictOf, type Lock, type Verdict } from "@/lib/lock";
import { useLaunches } from "@/hooks/useLaunches";
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
 * The order the list is read in.
 *
 * Three questions rather than a column to click, because there are only three
 * worth asking of a five-minute window: what is busiest, what is newest, and
 * what has moved furthest. A pair with no creation in the last day has no age,
 * and sorts to the end of `new` rather than to the front — unknown is old here.
 */
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
function keep(pair: Pair, band: Band, grade: Grade): boolean {
  if (!underCeiling(pair)) return false;
  /*
   * A movement filter cannot be answered by something that has not moved. An
   * untraded pool is not flat, it is silent, and letting it fall into `flat`
   * would be the screen making up an answer on its behalf.
   */
  if (band !== "all" && pair.swaps === 0) return false;
  if (!inBand(pair.change, band)) return false;
  /* Volume is asked of a row only if that row has trades behind it. */
  if (!clearsFloor(pair, pair.swaps > 0)) return false;
  return grade === "floor" || deep(pair);
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
 * Busiest first, then freshest.
 *
 * One rule rather than a control, and it falls out of the list holding both
 * sources. What is being traded now goes to the top in the order the money
 * went through it; everything nobody has touched has the same volume as
 * everything else nobody has touched, so what separates those is how recently
 * they opened. A pool with no creation in the last day has no age and sits at
 * the end — unknown is old here.
 */
function order(pairs: Pair[]): Pair[] {
  return [...pairs].sort(
    (a, b) => b.volume - a.volume || (a.age ?? Infinity) - (b.age ?? Infinity),
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
    byToken.set(key, {
      ...(pair.liquidity > held.liquidity ? pair : held),
      volume: held.volume + pair.volume,
      swaps: held.swaps + pair.swaps,
      age: youngest === Infinity ? undefined : youngest,
    });
  }
  return [...byToken.values()];
}

/**
 * What the lock reduces to on screen, and what it refuses to reduce to.
 *
 * Four verdicts and only one of them is good news, which is roughly the shape
 * of the chain: of eighteen pools sampled that held anything, four were burned
 * outright, four were held by wallets that could empty them, one was 89.8%
 * burned, and five were held by contracts nothing here can read. `unread` is
 * not a hedge — it is the largest honest answer this check has.
 */
const LOCK_TONE: Record<Verdict, string> = {
  burned: "long",
  mixed: "warn",
  open: "short",
  unread: "text-faint",
  empty: "short",
};

function lockLabel(verdict: Verdict): TKey {
  return `lock.${verdict}` as TKey;
}

/**
 * The same verdict, on a list row, in two registers.
 *
 * A chip beside the ticker is loud — it is what `NEW` and `FAKE` already use —
 * so it is spent only on the answers worth stopping a scroll for: liquidity
 * that was burned, liquidity that was partly burned, and a pool somebody has
 * already emptied. Those are rare. Measured across the pools this screen
 * surfaces, almost every row is either withdrawable or unreadable, and a list
 * that puts a badge on its own default is a list whose badges stop being read.
 *
 * So the ordinary two go in the metadata line instead, in the same dim type as
 * the depth and the age beside them — which is the pattern this row already
 * uses for a thin pool. They are still said, because a row that says nothing is
 * a row a reader cannot tell apart from one that has not been checked yet, and
 * that ambiguity is the whole reason to print the quiet ones at all.
 *
 * A row still being read has neither, which is the honest third thing: no
 * verdict has arrived. It resolves within a few seconds of the list appearing.
 */
const LOCK_CHIP: Partial<Record<Verdict, { key: TKey; tone: string }>> = {
  burned: { key: "lock.tagBurned", tone: "chip-live" },
  mixed: { key: "lock.tagMixed", tone: "chip-warn" },
  empty: { key: "lock.tagEmpty", tone: "chip-short" },
};

const LOCK_WORD: Partial<Record<Verdict, TKey>> = {
  open: "lock.tagOpen",
  unread: "lock.tagUnread",
};

function LockChip({ lock }: { lock: Lock | undefined }) {
  const { t } = useI18n();
  if (!lock) return null;
  const chip = LOCK_CHIP[verdictOf(lock)];
  if (!chip) return null;
  const share = shareOf(lock);
  return (
    <span className={`chip chip-xs ml-1.5 ${chip.tone}`}>
      {t(chip.key, { share: share === undefined ? 0 : Math.round(share) })}
    </span>
  );
}

function LockWord({ lock }: { lock: Lock | undefined }) {
  const { t } = useI18n();
  if (!lock) return null;
  const word = LOCK_WORD[verdictOf(lock)];
  if (!word) return null;
  return (
    <>
      {" · "}
      <span className="lbl">{t(word)}</span>
    </>
  );
}

/**
 * The one row on this sheet about whether the pool can be taken away.
 *
 * It sits under the figures rather than beside them because it is a different
 * kind of fact: depth, volume and age describe what the pool is doing, and this
 * describes whether it will still be there. The hint is never optional — a
 * verdict this short is exactly the kind a reader fills in for themselves, and
 * `burned` in particular has to carry the sentence saying it is not the same as
 * safe.
 */
function LockNote({
  lock,
  loading,
  failed,
}: {
  lock: Lock | undefined;
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <p className="mt-2 text-[11px] text-faint">{`${t("lock.reading")}…`}</p>
    );
  }
  if (failed || !lock) {
    return <p className="mt-2 text-[11px] text-faint">{t("lock.failed")}</p>;
  }

  const verdict = verdictOf(lock);
  const share = shareOf(lock);
  const rounded = share === undefined ? undefined : Math.round(share);

  return (
    <div className="mt-2 grid gap-1">
      <p className="text-[11px] text-dim">
        {t(`lock.${verdict}Hint` as TKey, { share: rounded ?? 0 })}
      </p>
      {/*
       * Only when the price is known to be outside the burned range. An
       * unreadable price leaves `backsPrice` undefined, and undefined says
       * nothing here rather than printing the warning by default.
       */}
      {lock.burned > 0n && lock.backsPrice === false && (
        <p className="text-[11px] warn">{t("lock.outOfRange")}</p>
      )}
      {lock.partial && <p className="text-[11px] text-faint">{t("lock.partial")}</p>}
    </div>
  );
}

function PairSheet({
  pair,
  onSnipe,
  onClose,
}: {
  pair: Pair | undefined;
  onSnipe: (pair: Pair) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  /*
   * Asked for the pool this row was built from, and only while the sheet is
   * open — the hook is the most expensive question in the app and a reader
   * scrolling the list behind this has not asked it.
   */
  const { lock, loading: lockLoading, failed: lockFailed } = useLiquidityLock(pair?.pool);

  if (!pair) return null;

  const verdict = lock ? verdictOf(lock) : undefined;
  const share = lock ? shareOf(lock) : undefined;

  return (
    <Sheet open title={t("memecoin.pair")} onClose={onClose}>
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
          <p className="lbl mt-1">{t("memecoin.mcap")}</p>
          <p className={`lbl mt-2 ${pair.change >= 0 ? "long" : "short"}`}>
            <Figure value={signed(pair.change)} />
          </p>
        </div>
      </div>

      <div className="px-3 pb-4">
        <div className="mb-3">
          <PairChart pair={pair} />
        </div>

        <Panel>
          <Row k={t("memecoin.fdv")} v={<Figure className="num" value={usd(pair.fdv)} />} />
          <Row
            k={t("memecoin.volume")}
            v={<Figure className="num" value={usd(pair.volume)} />}
          />
          <Row
            k={t("memecoin.liquidity")}
            v={<Figure className="num" value={usd(pair.liquidity)} />}
          />
          <Row k={t("memecoin.trades")} v={<Figure className="num" value={String(pair.swaps)} />} />
          <Row k={t("memecoin.age")} v={<Figure className="num" value={age(pair.age)} />} />
          <Row
            k={t("memecoin.pool")}
            v={<span className="num">{`${pair.fee / 10_000}%`}</span>}
          />
          <Row
            k={t("memecoin.token")}
            v={<span className="num">{truncateAddress(pair.token, 8, 6)}</span>}
          />
          <Row
            k={t("memecoin.lock")}
            v={
              lockLoading ? (
                <span className="skel inline-block h-[12px] w-[72px] align-middle" />
              ) : verdict ? (
                <span className={`num ${LOCK_TONE[verdict]}`}>
                  {t(lockLabel(verdict), {
                    share: share === undefined ? 0 : Math.round(share),
                  })}
                </span>
              ) : (
                <span className="num text-faint">—</span>
              )
            }
          />
        </Panel>

        <LockNote lock={lock} loading={lockLoading} failed={lockFailed} />

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
          {t("memecoin.snipe", { symbol: pair.symbol })}
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
            {t("memecoin.dexscreener")}
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
  /*
   * Copycats go before the reader's own filters rather than after them. Which
   * contract holds a ticker is decided against everything the screen knows
   * about, so a band or a grade that happens to exclude the real one cannot
   * promote a copy into being the only thing wearing the name.
   */
  const all = useMemo(() => dropCopycats(merge(pairs, launches)), [pairs, launches]);
  const listed = useMemo(
    () => order(all.filter((pair) => keep(pair, band, grade))),
    [all, band, grade],
  );

  /*
   * Filled in the background of the list the reader is already reading, and
   * shared with the sheet — a row checked here is a row the sheet does not have
   * to check again. See `useLiquidityLocks` for what that costs and why it is
   * paced rather than fired at once.
   */
  const pools = useMemo(() => listed.map((pair) => pair.pool), [listed]);
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
          title={t("memecoin.failed")}
          hint={t("memecoin.failedHint")}
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
      return all.length === 0 ? (
        <Empty title={t("memecoin.empty")} hint={t("memecoin.emptyHint")} />
      ) : (
        <Empty
          title={t("memecoin.noMatch")}
          hint={t("memecoin.noMatchHint")}
          action={
            <button
              type="button"
              className="btn btn-sm btn-short"
              onClick={() => {
                setBand("all");
                setGrade("floor");
              }}
            >
              {t("memecoin.clear")}
            </button>
          }
        />
      );
    }

    return (
      <div className="flex flex-col gap-1.5">
        {listed.map((pair) => (
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
                {pair.age !== undefined && pair.age < FRESH && (
                  <span className="chip chip-xs chip-live ml-1.5">{t("memecoin.fresh")}</span>
                )}
                <LockChip lock={locks.get(pair.pool.toLowerCase())} />
              </span>
              {/*
               * A row nobody has traded has no volume and has not moved, so it
               * says what it does have — how deep it is and how long it has
               * existed — rather than printing two zeroes that read as a
               * failed call. Decided per row, since both kinds share one list.
               */}
              <span className="block truncate text-[11px] font-normal text-faint">
                {pair.swaps > 0 && (
                  <>
                    <span className="lbl">{t("memecoin.volShort")}</span>{" "}
                    <Figure className="num" value={usd(pair.volume)} />
                    {" · "}
                  </>
                )}
                <span className={`lbl ${thin(pair) ? "warn" : ""}`}>
                  {t("memecoin.liqShort")}
                </span>{" "}
                <Figure className={`num ${thin(pair) ? "warn" : ""}`} value={usd(pair.liquidity)} />
                {" · "}
                <Figure className="num" value={age(pair.age)} />
                <LockWord lock={locks.get(pair.pool.toLowerCase())} />
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
                <span className="lbl block">{t("memecoin.mcapShort")}</span>
              )}
            </span>
          </button>
          <button
            type="button"
            className="tile aim w-[46px] shrink-0 justify-center px-0 text-accent"
            aria-label={t("memecoin.snipe", { symbol: pair.symbol })}
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
      <h1 className="sr-only">{t("page.memecoin.title")}</h1>

      {mounted && (
        <div className="mb-3 flex flex-col gap-1.5">
          {/*
           * Asking for a movement narrows the list to rows that have moved,
           * which is what it has always meant — it now also drops the ones
           * that have not traded at all, because silence is not a direction.
           */}
          <Segmented
            options={[
              { value: "all", label: t("memecoin.bandAll") },
              { value: "pumping", label: t("memecoin.bandPump") },
              { value: "flat", label: t("memecoin.bandFlat") },
              { value: "dumping", label: t("memecoin.bandDump") },
            ]}
            value={band}
            onChange={setBand}
          />
          <Segmented
            options={[
              { value: "floor", label: t("memecoin.gradeAll") },
              { value: "deep", label: t("memecoin.gradeDeep") },
            ]}
            value={grade}
            onChange={setGrade}
          />
        </div>
      )}

      <Panel
        /*
         * One list, one header, and it names both windows — they are the whole
         * of what this screen can see: what traded in the last five minutes,
         * and what opened since yesterday. The floor is always on, so it is
         * always said.
         */
        label={t("memecoin.live", { floor: `$${formatCompact(FLOOR)}` })}
        meta={
          mounted && all.length > 0 ? (
            <span className="lbl">
              {t("memecoin.showing", { shown: listed.length, total: all.length })}
            </span>
          ) : undefined
        }
      >
        {body()}
      </Panel>

      <PairSheet
        pair={listed.find((pair) => pair.pool === opened)}
        onSnipe={snipe}
        onClose={() => setOpened(undefined)}
      />
    </div>
  );
}
