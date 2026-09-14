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
import { chainMeta } from "@/lib/chains";
import { feeLabel, formatPrice, formatSigned, timeAgo } from "@/lib/format";
import { baseTokens, nativeToken, sameToken, type Token } from "@/lib/tokens";

export default function TerminalPage() {
  const mounted = useMounted();
  const activeChainId = useChainId();
  const { chainId: accountChainId } = useAccount();
  const chainId = accountChainId ?? activeChainId;
  const meta = chainMeta(chainId);

  const { tokens } = useTokenList(chainId);
  const [tokenIn, setTokenIn] = useState<Token>();
  const [tokenOut, setTokenOut] = useState<Token>();

  // Default pair follows the active chain: native against its USD unit.
  useEffect(() => {
    if (!chainId || !meta) return;
    const defaults = baseTokens(chainId);
    const native = nativeToken(chainId);
    const stable = defaults.find((token) => token.address === meta.stable);
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

  const swapTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="order-2 flex flex-col gap-3 lg:order-1 lg:col-span-7">
        <Panel
          label={base && quote ? `${base.symbol} / ${quote.symbol}` : "Pair"}
          meta={
            <span className={`chip ${isFetching ? "chip-live" : ""}`}>
              <span className={`dot ${isFetching ? "dot-live" : ""}`} />
              {meta?.label ?? "Network"}
            </span>
          }
          bodyClassName="p-0"
          ticked
        >
          <div className="flex flex-wrap items-end justify-between gap-4 p-3">
            <div>
              <p className="lbl mb-1.5">Pool mid</p>
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
            </div>
            <div className="text-right">
              <p className="lbl mb-1.5">Session change</p>
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
            <Stat label="Ticks" value={stats ? String(stats.ticks) : "0"} />
            <Stat label="High" value={stats ? formatPrice(stats.high) : "—"} />
            <Stat label="Low" value={stats ? formatPrice(stats.low) : "—"} />
            <Stat
              label="Last read"
              value={stats ? `${timeAgo(stats.last)} ago` : "—"}
            />
          </div>
        </Panel>

        <Panel label="Route detail" bodyClassName="p-3">
          {error ? (
            <p className="flex items-start gap-2 text-[11px] leading-relaxed short">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              {error.message}
            </p>
          ) : (
            <>
              <Row k="Venue" v="Uniswap v3" />
              <Row k="Deepest tier" v={pool ? feeLabel(pool.fee) : "—"} />
              <Row
                k="Pool"
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
                k="Ticks recorded"
                v={stats ? `${stats.ticks} since ${timeAgo(stats.since)} ago` : "0"}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                Prices come from the pool itself — sqrtPrice for the mid, QuoterV2 for
                executable size. Nothing is cached from a third-party feed.
              </p>
            </>
          )}
        </Panel>
      </div>

      <div className="order-1 lg:order-2 lg:col-span-5">
        <SwapPanel
          tokens={tokens}
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
