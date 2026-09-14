"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { SwapPanel } from "@/components/terminal/SwapPanel";
import { Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Spark } from "@/components/ui/Spark";
import { Icon } from "@/components/ui/Icon";
import { usePairPrice, usePairSeries } from "@/hooks/usePairPrice";
import { useTokenList } from "@/hooks/useTokenList";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";
import { useFxRate } from "@/hooks/useFxRate";
import { formatMoney } from "@/lib/currency";
import { useAppStore } from "@/store/useAppStore";
import { chainMeta, dexMeta, hasRouting } from "@/lib/chains";
import { feeLabel, formatPrice, formatSigned, timeAgo } from "@/lib/format";
import { baseTokens, nativeToken, sameToken, type Token } from "@/lib/tokens";

export default function TerminalPage() {
  const mounted = useMounted();
  const { t, locale } = useI18n();
  const currency = useAppStore((state) => state.settings.currency);
  const { fx } = useFxRate();
  const activeChainId = useChainId();
  const { chainId: accountChainId } = useAccount();
  const chainId = accountChainId ?? activeChainId;
  const meta = chainMeta(chainId);

  const { tokens, listed } = useTokenList(chainId);
  const [tokenIn, setTokenIn] = useState<Token>();
  const [tokenOut, setTokenOut] = useState<Token>();

  // Default pair follows the active chain: native against its USD unit.
  useEffect(() => {
    if (!chainId || !meta) return;
    const defaults = baseTokens(chainId);
    const native = nativeToken(chainId);
    const stableAddress = dexMeta(chainId)?.stable;
    const stable = defaults.find((token) => token.address === stableAddress);
    setTokenIn((current) => (current?.chainId === chainId ? current : native));
    setTokenOut((current) => (current?.chainId === chainId ? current : stable));
  }, [chainId, meta]);

  const base = tokenIn;
  const quote = tokenOut;
  const { price, pool, isFetching, error } = usePairPrice(base, quote);
  const series = usePairSeries(base, quote);

  const stats = useMemo(() => {
    if (series.length < 2) return undefined;
    const first = series[0];
    const last = series[series.length - 1];
    const values = series.map((point) => point.p);
    return {
      change: first.p > 0 ? last.p / first.p - 1 : 0,
      high: Math.max(...values),
      low: Math.min(...values),
      ticks: series.length,
      since: first.t,
      last: last.t,
    };
  }, [series]);

  /** The quote side is the chain's USD unit, so a rupiah conversion is meaningful. */
  const stableAddress = meta?.dex?.stable.toLowerCase();
  const quotedInUsd = Boolean(
    quote && stableAddress && quote.address.toLowerCase() === stableAddress,
  );

  const swapTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1 lg:col-span-7">
        <Panel
          label={base && quote ? `${base.symbol} / ${quote.symbol}` : t("terminal.pair")}
          meta={
            <span className={`chip ${isFetching ? "chip-live" : ""}`}>
              <span className={`dot ${isFetching ? "dot-live" : ""}`} />
              {meta?.label ?? t("common.network")}
            </span>
          }
          bodyClassName="p-0"
          ticked
        >
          <div className="flex flex-wrap items-end justify-between gap-4 p-3">
            <div>
              <p className="lbl mb-1.5">{t("terminal.poolMid")}</p>
              {mounted ? (
                <p className="num text-[30px] leading-none">
                  {price !== undefined ? formatPrice(price) : "—"}
                  {quote && (
                    <span className="ml-2 text-[13px] text-faint">{quote.symbol}</span>
                  )}
                </p>
              ) : (
                <Skeleton className="h-8 w-40" />
              )}
              {mounted && quotedInUsd && price !== undefined && currency === "IDR" && fx && (
                <p className="num mt-1.5 text-[12px] text-faint">
                  {t("terminal.approxFx", {
                    value: formatMoney(price, { currency, fx, locale }),
                  })}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="lbl mb-1.5">{t("terminal.sessionChange")}</p>
              <p
                className={`num text-[18px] leading-none ${
                  stats && stats.change >= 0 ? "long" : stats ? "short" : "text-faint"
                }`}
              >
                {stats ? formatSigned(stats.change) : "—"}
              </p>
            </div>
          </div>

          <div className="px-3 pb-3">
            <Spark points={series} height={132} />
          </div>

          <div className="grid grid-cols-2 gap-x-4 border-t border-line p-3 sm:grid-cols-4">
            <Stat label={t("terminal.ticks")} value={stats ? String(stats.ticks) : "0"} />
            <Stat label={t("terminal.high")} value={stats ? formatPrice(stats.high) : "—"} />
            <Stat label={t("terminal.low")} value={stats ? formatPrice(stats.low) : "—"} />
            <Stat
              label={t("terminal.lastRead")}
              value={stats ? t("common.ago", { value: timeAgo(stats.last) }) : "—"}
            />
          </div>
        </Panel>

        <Panel label={t("terminal.routeDetail")} bodyClassName="p-3">
          {error ? (
            <p className="wrap-any flex items-start gap-2 text-[11px] leading-relaxed short">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              {/* RPC failures arrive as multi-paragraph viem reports. */}
              {error.message.split("\n")[0].slice(0, 160)}
            </p>
          ) : (
            <>
              <Row
                k={t("terminal.venue")}
                v={hasRouting(chainId) ? "Uniswap v3" : t("terminal.noVenue")}
                tone={hasRouting(chainId) ? undefined : "warn"}
              />
              <Row k={t("terminal.deepestTier")} v={pool ? feeLabel(pool.fee) : "—"} />
              <Row
                k={t("terminal.pool")}
                v={
                  pool ? (
                    <a
                      href={meta ? `${meta.explorer}/address/${pool.address}` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-accent-text"
                    >
                      {pool.address.slice(0, 10)}…
                      <Icon name="external" size={11} />
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Row
                k={t("terminal.ticksRecorded")}
                v={
                  stats
                    ? t("terminal.ticksSince", {
                        count: stats.ticks,
                        time: timeAgo(stats.since),
                      })
                    : "0"
                }
              />
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                {t("terminal.sourceNote")}
              </p>
            </>
          )}
        </Panel>
      </div>

      <div className="order-1 min-w-0 lg:order-2 lg:col-span-5">
        <SwapPanel
          tokens={tokens}
          listed={listed}
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          onTokenIn={(token) => {
            if (sameToken(token, tokenOut)) setTokenOut(tokenIn);
            setTokenIn(token);
          }}
          onTokenOut={(token) => {
            if (sameToken(token, tokenIn)) setTokenIn(tokenOut);
            setTokenOut(token);
          }}
          onSwitch={swapTokens}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1">
      <p className="lbl mb-1">{label}</p>
      <p className="num text-[13px]">{value}</p>
    </div>
  );
}
