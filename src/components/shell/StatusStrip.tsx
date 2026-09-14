"use client";

import { useAccount, useBlockNumber } from "wagmi";
import { chainMeta } from "@/lib/chains";
import { formatPrice, timeAgo } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

export function StatusStrip() {
  const mounted = useMounted();
  const { t } = useI18n();
  const { chainId, isConnected } = useAccount();
  const meta = chainMeta(chainId);
  const { data: blockNumber } = useBlockNumber({
    watch: mounted && isConnected && Boolean(meta),
    query: { enabled: mounted && isConnected && Boolean(meta) },
  });

  const bots = useAppStore((state) => state.bots);
  const signals = useAppStore((state) => state.signals);
  const series = useAppStore((state) => state.series);

  const armed = bots.filter((bot) => bot.status === "armed").length;
  const open = signals.filter((s) => s.status === "pending" || s.status === "executing").length;

  const feeds = bots.slice(0, 6).map((bot) => {
    const key = `${bot.chainId}:${bot.base.address.toLowerCase()}:${bot.quote.address.toLowerCase()}`;
    const points = series[key] ?? [];
    const last = points[points.length - 1];
    const first = points[0];
    const change = last && first && first.p > 0 ? last.p / first.p - 1 : undefined;
    return {
      id: bot.id,
      pair: `${bot.base.symbol}/${bot.quote.symbol}`,
      price: last?.p,
      at: last?.t,
      change,
    };
  });

  return (
    <div className="sticky top-[var(--shell-top)] z-30 h-7 border-b border-line bg-base/80 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1480px] items-center gap-4 overflow-hidden px-3 md:px-4">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`dot ${armed > 0 ? "dot-live" : ""}`} />
          <span className="lbl">
            {armed > 0 ? t("common.armedCount", { count: armed }) : t("common.idle")}
          </span>
        </span>

        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span className="lbl">{t("common.queue")}</span>
          <span className="num text-[11px]">{open}</span>
        </span>

        <span className="hidden shrink-0 items-center gap-1.5 md:flex">
          <span className="lbl">{meta ? meta.label : t("common.network")}</span>
          <span className="num text-[11px] text-dim">
            {mounted && blockNumber ? `#${blockNumber.toString()}` : "—"}
          </span>
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-4 overflow-hidden">
          {mounted &&
            feeds
              .filter((feed) => feed.price !== undefined)
              .slice(0, 4)
              .map((feed) => (
                <span key={feed.id} className="flex shrink-0 items-center gap-1.5">
                  <span className="lbl">{feed.pair}</span>
                  <span className="num text-[11px]">{formatPrice(feed.price)}</span>
                  {feed.change !== undefined && (
                    <span
                      className={`num text-[10px] ${feed.change >= 0 ? "long" : "short"}`}
                    >
                      {feed.change >= 0 ? "+" : ""}
                      {(feed.change * 100).toFixed(2)}%
                    </span>
                  )}
                  {feed.at && (
                    <span className="lbl hidden lg:inline">{timeAgo(feed.at)}</span>
                  )}
                </span>
              ))}
        </div>
      </div>
    </div>
  );
}
