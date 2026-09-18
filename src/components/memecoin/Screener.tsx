"use client";

import { useMemo, useState } from "react";
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
  inBand,
  type Band,
  type Grade,
} from "@/lib/screener";
import { useScreener, type Pair } from "@/hooks/useScreener";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";

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
 */
function keep(pair: Pair, band: Band, grade: Grade): boolean {
  if (pair.marketCap !== undefined && pair.marketCap > CEILING) return false;
  if (!inBand(pair.change, band)) return false;
  if (grade === "all") return true;

  const { marketCap, fdv, volume, liquidity } = pair;
  if (marketCap === undefined || fdv === undefined) return false;
  if (marketCap < FLOOR || fdv < FLOOR || volume < FLOOR) return false;
  if (grade === "floor") return true;

  return liquidity >= marketCap * HEALTHY_LIQUIDITY && fdv <= marketCap * HEALTHY_DILUTION;
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

function PairSheet({ pair, onClose }: { pair: Pair | undefined; onClose: () => void }) {
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

        <div className="mt-3 grid grid-cols-2 gap-2">
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
  const [grade, setGrade] = useState<Grade>("all");
  const [opened, setOpened] = useState<string>();
  const { pairs, loading, error, refetch } = useScreener();

  const listed = useMemo(
    () => order(pairs.filter((pair) => keep(pair, band, grade))),
    [pairs, band, grade],
  );

  const body = () => {
    if (!mounted || loading) return <Loading />;

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
      return pairs.length === 0 ? (
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
          <button
            key={pair.pool}
            type="button"
            className="tile"
            onClick={() => setOpened(pair.pool)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {pair.symbol}
                <span className="font-normal text-faint">/{pair.quote}</span>
                {pair.age !== undefined && pair.age < FRESH && (
                  <span className="chip chip-xs chip-live ml-1.5">{t("memecoin.fresh")}</span>
                )}
              </span>
              <span className="block truncate text-[11px] font-normal text-faint">
                <span className="lbl">{t("memecoin.volShort")}</span>{" "}
                <span className="num">{usd(pair.volume)}</span>
                {" · "}
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
              <span
                className={`num block text-[11px] font-normal ${pair.change >= 0 ? "long" : "short"}`}
              >
                {signed(pair.change)}
              </span>
            </span>
          </button>
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
        label={t("memecoin.live")}
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
        onClose={() => setOpened(undefined)}
      />
    </div>
  );
}
