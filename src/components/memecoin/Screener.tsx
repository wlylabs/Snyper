"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, explorerAddress } from "@/lib/chains";
import { formatSignificant, truncateAddress } from "@/lib/format";
import type { Sort } from "@/lib/screener";
import { useScreener, type Pair } from "@/hooks/useScreener";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";

/** Under this many minutes old, a pair is still announcing itself. */
const FRESH = 180;

function age(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/** Everything on this screen is dollars — see the fold in `useScreener`. */
function usd(value: number): string {
  return `$${formatSignificant(value, 2)}`;
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
function order(pairs: Pair[], sort: Sort): Pair[] {
  const sorted = [...pairs];
  if (sort === "new") {
    return sorted.sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity));
  }
  if (sort === "movers") return sorted.sort((a, b) => b.change - a.change);
  return sorted.sort((a, b) => b.volume - a.volume);
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
          <p className="num text-[26px] leading-none">{usd(pair.price)}</p>
          <p className={`lbl mt-2 ${pair.change >= 0 ? "long" : "short"}`}>{signed(pair.change)}</p>
        </div>
      </div>

      <div className="px-3 pb-4">
        <Panel>
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

        <a
          href={explorerAddress(CHAIN_ID, pair.token)}
          target="_blank"
          rel="noreferrer"
          className="tile mt-3 justify-center"
        >
          <Icon name="external" size={14} className="text-dim" />
          {t("common.explorer")}
        </a>
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
  const [sort, setSort] = useState<Sort>("volume");
  const [opened, setOpened] = useState<string>();
  const { pairs, loading, error, refetch } = useScreener();

  const listed = useMemo(() => order(pairs, sort), [pairs, sort]);

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
      return <Empty title={t("memecoin.empty")} hint={t("memecoin.emptyHint")} />;
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
              <span className="num block truncate text-[11px] font-normal text-faint">
                {usd(pair.volume)} · {pair.swaps} · {age(pair.age)}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="num block text-[12px]">{usd(pair.price)}</span>
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
        <Segmented
          className="mb-3"
          options={[
            { value: "volume", label: t("memecoin.sortHot") },
            { value: "new", label: t("memecoin.sortNew") },
            { value: "movers", label: t("memecoin.sortMovers") },
          ]}
          value={sort}
          onChange={setSort}
        />
      )}

      <Panel label={t("memecoin.live")}>{body()}</Panel>

      <PairSheet
        pair={listed.find((pair) => pair.pool === opened)}
        onClose={() => setOpened(undefined)}
      />
    </div>
  );
}
