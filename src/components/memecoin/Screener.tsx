"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, explorerAddress } from "@/lib/chains";
import { formatCompact, truncateAddress } from "@/lib/format";
import {
  CEILING,
  FLOOR,
  HEALTHY_DILUTION,
  HEALTHY_LIQUIDITY,
  clearsFloor,
  impersonates,
  inBand,
  underCeiling,
  type Band,
  type Grade,
} from "@/lib/screener";
import { useLaunches } from "@/hooks/useLaunches";
import { useScreener, type Pair } from "@/hooks/useScreener";
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
  if (!inBand(pair.change, band)) return false;
  if (grade === "all") return true;
  if (!clearsFloor(pair)) return false;
  return grade === "floor" || healthy(pair);
}

/** Deep enough for its size, and not mostly supply that has not arrived yet. */
function healthy(pair: Pair): boolean {
  const { marketCap, fdv, liquidity } = pair;
  if (marketCap === undefined || fdv === undefined) return false;
  return liquidity >= marketCap * HEALTHY_LIQUIDITY && fdv <= marketCap * HEALTHY_DILUTION;
}

/**
 * Whether a launch survives, which is a different question from whether a
 * trade does.
 *
 * Volume cannot be in this test. A pool that opened twenty minutes ago and has
 * not been touched since has no volume by definition, and a floor that tested
 * it would empty the list of exactly the rows the list exists to show. What
 * can be asked of a launch is whether there is anything in it to trade against,
 * so depth is the whole of the floor here, and the ceiling still holds.
 */
function keepNew(pair: Pair, grade: Grade): boolean {
  if (!underCeiling(pair)) return false;
  if (grade === "all") return true;
  /* Every test the traded list makes except volume — see `clearsFloor`. */
  if (!clearsFloor(pair, false)) return false;
  return grade === "floor" || healthy(pair);
}

/** Whether the pool behind a row could absorb the position it is quoting. */
function thin(pair: Pair): boolean {
  return pair.marketCap !== undefined && pair.liquidity < pair.marketCap * HEALTHY_LIQUIDITY;
}

/**
 * Busiest first, and only busiest.
 *
 * The sort control is gone: inside a ten-million ceiling the question of what
 * to read first has one answer, which is what is being traded now. Newest was
 * a list of launches most of which never traded at all, and biggest mover put
 * a token up four hundred percent on nine dollars of volume at the top.
 */
function order(pairs: Pair[]): Pair[] {
  return [...pairs].sort((a, b) => b.volume - a.volume);
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
  if (!pair) return null;

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
          <p className="num text-[26px] leading-none">{usd(pair.marketCap)}</p>
          <p className="lbl mt-1">{t("memecoin.mcap")}</p>
          <p className={`lbl mt-2 ${pair.change >= 0 ? "long" : "short"}`}>{signed(pair.change)}</p>
        </div>
      </div>

      <div className="px-3 pb-4">
        <div className="mb-3">
          <PairChart pair={pair} />
        </div>

        <Panel>
          <Row k={t("memecoin.fdv")} v={<span className="num">{usd(pair.fdv)}</span>} />
          <Row
            k={t("memecoin.volume")}
            v={<span className="num">{usd(pair.volume)}</span>}
          />
          <Row
            k={t("memecoin.liquidity")}
            v={<span className="num">{usd(pair.liquidity)}</span>}
          />
          <Row k={t("memecoin.trades")} v={<span className="num">{pair.swaps}</span>} />
          <Row k={t("memecoin.age")} v={<span className="num">{age(pair.age)}</span>} />
          <Row
            k={t("memecoin.pool")}
            v={<span className="num">{`${pair.fee / 10_000}%`}</span>}
          />
          <Row
            k={t("memecoin.token")}
            v={<span className="num">{truncateAddress(pair.token, 8, 6)}</span>}
          />
        </Panel>

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
  const [view, setView] = useState<"trading" | "new">("trading");
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
  const { launches, loading: pricing } = useLaunches(births, head, view === "new");

  const listed = useMemo(
    () =>
      view === "new"
        ? launches.filter((pair) => keepNew(pair, grade))
        : order(pairs.filter((pair) => keep(pair, band, grade))),
    [view, launches, pairs, band, grade],
  );

  const body = () => {
    if (!mounted || loading || (view === "new" && pricing && launches.length === 0))
      return <Loading />;

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
      const nothing = view === "new" ? launches.length === 0 : pairs.length === 0;
      return nothing ? (
        <Empty
          title={t(view === "new" ? "memecoin.noNew" : "memecoin.empty")}
          hint={t(view === "new" ? "memecoin.noNewHint" : "memecoin.emptyHint")}
        />
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
                setGrade("all");
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
                {impersonates(pair.token, pair.symbol) && (
                  <span className="chip chip-xs chip-warn ml-1.5">{t("memecoin.fake")}</span>
                )}
              </span>
              {/*
               * A launch has no volume and has not moved, so the line says what
               * it does have — how deep it is and how long it has existed —
               * rather than printing two zeroes that look like a failed read.
               */}
              <span className="block truncate text-[11px] font-normal text-faint">
                {view === "trading" && (
                  <>
                    <span className="lbl">{t("memecoin.volShort")}</span>{" "}
                    <span className="num">{usd(pair.volume)}</span>
                    {" · "}
                  </>
                )}
                <span className={`lbl ${thin(pair) ? "warn" : ""}`}>
                  {t("memecoin.liqShort")}
                </span>{" "}
                <span className={`num ${thin(pair) ? "warn" : ""}`}>{usd(pair.liquidity)}</span>
                {" · "}
                <span className="num">{age(pair.age)}</span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="num block text-[12px]">{usd(pair.marketCap)}</span>
              {view === "trading" ? (
                <span
                  className={`num block text-[11px] font-normal ${pair.change >= 0 ? "long" : "short"}`}
                >
                  {signed(pair.change)}
                </span>
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
          <Segmented
            options={[
              { value: "trading", label: t("memecoin.viewTrading") },
              { value: "new", label: t("memecoin.viewNew") },
            ]}
            value={view}
            onChange={setView}
          />
          {/*
           * The movement filter belongs to the traded list alone. A launch that
           * nobody has bought has not pumped, gone flat or dumped — it has done
           * nothing, and offering to sort it by which would be offering a
           * control that cannot do anything.
           */}
          {view === "trading" && (
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
          )}
          <Segmented
            options={[
              { value: "all", label: t("memecoin.gradeAll") },
              { value: "floor", label: `$${formatCompact(FLOOR)}+` },
              { value: "healthy", label: t("memecoin.gradeHealthy") },
            ]}
            value={grade}
            onChange={setGrade}
          />
        </div>
      )}

      <Panel
        label={
          view === "new"
            ? t("memecoin.born", {
                floor: grade === "all" ? "" : ` · $${formatCompact(FLOOR)}+`,
              })
            : grade === "all"
              ? t("memecoin.liveAny")
              : t("memecoin.live", { floor: `$${formatCompact(FLOOR)}` })
        }
        meta={
          mounted && pairs.length > 0 ? (
            <span className="lbl">
              {t("memecoin.showing", { shown: listed.length, total: pairs.length })}
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
