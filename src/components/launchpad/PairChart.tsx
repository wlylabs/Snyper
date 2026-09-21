"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Empty, Skeleton } from "@/components/ui/Panel";
import { formatSignificant } from "@/lib/format";
import { usePairChart } from "@/hooks/usePairChart";
import type { Pair } from "@/hooks/useScreener";
import { useI18n } from "@/hooks/useI18n";
import { useAppStore } from "@/store/useAppStore";

/** The height a chart gets in a sheet on a phone. */
const TALL = 190;

/**
 * The app's own palette, as values rather than as variables.
 *
 * The chart draws to a canvas, and a canvas cannot read `var(--color-ink)` — it
 * needs the colour itself. So the tokens are resolved off the document at the
 * moment the chart is built and again whenever the theme changes, which keeps
 * one palette for the whole app rather than a second one living in here.
 */
function token(name: string): string {
  if (typeof document === "undefined") return "#888888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
}

export function PairChart({ pair }: { pair: Pair }) {
  const { t } = useI18n();
  const theme = useAppStore((state) => state.settings.theme);
  const { candles, loading, error } = usePairChart(pair);
  const frame = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>(null);

  useEffect(() => {
    const host = frame.current;
    if (!host || candles.length === 0) return;

    const up = token("--color-accent-text");
    const down = token("--color-short");

    const built = createChart(host, {
      height: TALL,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: token("--color-faint"),
        fontFamily: token("--font-mono"),
        fontSize: 10,
        /*
         * Left on deliberately. Lightweight Charts is Apache-2.0 and its notice
         * asks for a link to tradingview.com on the page it is used; this mark
         * in the corner of the chart is what the library offers to satisfy it.
         */
        attributionLogo: true,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: token("--color-line") },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      /*
       * No floating labels on the axes. The crosshair still tracks, and the
       * scales still carry their own figures — what goes is the box that rode
       * on top of them, which on a chart this size covered as much as it named.
       */
      crosshair: {
        horzLine: { labelVisible: false },
        vertLine: { labelVisible: false },
      },
      handleScale: false,
      handleScroll: false,
      /*
       * The library's own formatter rounds to two decimals, which writes every
       * price on this screen as 0.00 — a memecoin trades seven zeros below a
       * cent. This is the app's formatter, the one that counts a run of zeros
       * rather than printing it, so the axis says 0.0₇334 and means it.
       */
      localization: { priceFormatter: (price: number) => formatSignificant(price, 3) },
    });

    const series = built.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      /* The last price had a label of its own, in the same place and the same
       * colour, so it goes with them. The dashed line marking it goes too. */
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: {
        type: "custom",
        minMove: 0,
        formatter: (price: number) => formatSignificant(price, 3),
      },
    });
    // The library brands its timestamps; ours are already the seconds it wants.
    series.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    built.timeScale().fitContent();
    chart.current = built;

    return () => {
      built.remove();
      chart.current = null;
    };
    // `theme` rebuilds the chart, which is how the canvas picks up new tokens.
  }, [candles, theme]);

  if (loading) return <Skeleton className={`w-full rounded-[var(--radius-xs)]`} />;

  if (error || candles.length === 0) {
    return (
      <div className="panel" style={{ height: TALL }}>
        <Empty title={t("launchpad.noChart")} />
      </div>
    );
  }

  return <div ref={frame} className="panel overflow-hidden" style={{ height: TALL }} />;
}
