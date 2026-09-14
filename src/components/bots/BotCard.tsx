"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { chainMeta } from "@/lib/chains";
import { formatDuration, formatPrice, formatSigned, timeAgo } from "@/lib/format";
import { describeStrategy, gridLevels } from "@/lib/strategies";
import type { Bot } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

export function BotCard({ bot }: { bot: Bot }) {
  const setBotStatus = useAppStore((state) => state.setBotStatus);
  const resetBot = useAppStore((state) => state.resetBot);
  const removeBot = useAppStore((state) => state.removeBot);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta = chainMeta(bot.chainId);
  const armed = bot.status === "armed";
  const runtime = bot.runtime;
  const price = runtime.lastPrice;

  const nextLeg =
    bot.strategy.kind === "dca" && runtime.lastFireAt
      ? Math.max(0, bot.strategy.intervalMin * 60 - (Date.now() - runtime.lastFireAt) / 1000)
      : undefined;

  const drawdown =
    bot.strategy.kind === "trail" && runtime.peak && price
      ? price / runtime.peak - 1
      : undefined;

  return (
    <article className={`panel ${armed ? "ticked" : ""}`}>
      <header className="panel-head">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`dot ${armed ? "dot-live" : runtime.completed ? "" : ""}`} />
          <span className="truncate text-[13px] font-semibold">{bot.name}</span>
        </span>
        <span className="chip shrink-0">{meta?.mark ?? bot.chainId}</span>
      </header>

      <div className="p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="num text-[15px]">
            {bot.base.symbol}
            <span className="text-faint"> / </span>
            {bot.quote.symbol}
          </span>
          <span className="num text-[15px]">
            {price !== undefined ? formatPrice(price) : "—"}
            <span className="ml-1.5 text-[10px] text-faint">{bot.quote.symbol}</span>
          </span>
        </div>

        <p className="mt-1 text-[11px] text-dim">{describeStrategy(bot)}</p>

        {bot.strategy.kind === "grid" && (
          <GridLadder bot={bot} price={price} />
        )}

        <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
          <Metric label="Fills" value={String(runtime.fills)} />
          <Metric
            label="Deployed"
            value={`${runtime.deployedQuote.toFixed(2)} ${bot.quote.symbol}`}
          />
          <Metric
            label={bot.strategy.kind === "trail" ? "Peak" : "Last tick"}
            value={
              bot.strategy.kind === "trail"
                ? runtime.peak
                  ? formatPrice(runtime.peak)
                  : "—"
                : runtime.lastTickAt
                  ? `${timeAgo(runtime.lastTickAt)} ago`
                  : "—"
            }
          />
          {nextLeg !== undefined && (
            <Metric label="Next leg" value={formatDuration(nextLeg)} />
          )}
          {drawdown !== undefined && (
            <Metric label="From peak" value={formatSigned(drawdown)} tone={drawdown < 0 ? "short" : "long"} />
          )}
          {bot.dailyCapQuote > 0 && (
            <Metric
              label="Day spend"
              value={`${runtime.spentQuote.toFixed(0)}/${bot.dailyCapQuote} ${bot.quote.symbol}`}
            />
          )}
        </dl>

        {runtime.error && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed warn">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            {runtime.error}
          </p>
        )}

        {runtime.completed && (
          <p className="mt-3 text-[11px] text-faint">
            Strategy completed. Reset to run it again.
          </p>
        )}
      </div>

      <footer className="flex gap-1.5 border-t border-line p-2">
        <button
          type="button"
          className={`btn btn-sm flex-1 ${armed ? "" : "btn-accent"}`}
          onClick={() => setBotStatus(bot.id, armed ? "idle" : "armed")}
          disabled={runtime.completed && !armed}
        >
          <Icon name={armed ? "pause" : "play"} size={12} />
          {armed ? "Disarm" : "Arm"}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => resetBot(bot.id)}
          aria-label="Reset runtime"
          title="Reset runtime"
        >
          <Icon name="refresh" size={14} />
        </button>
        <button
          type="button"
          className={`icon-btn ${confirmDelete ? "short" : ""}`}
          onClick={() => {
            if (confirmDelete) removeBot(bot.id);
            else {
              setConfirmDelete(true);
              window.setTimeout(() => setConfirmDelete(false), 3000);
            }
          }}
          aria-label={confirmDelete ? "Confirm delete" : "Delete strategy"}
          title={confirmDelete ? "Tap again to delete" : "Delete"}
        >
          <Icon name={confirmDelete ? "check" : "trash"} size={14} />
        </button>
      </footer>
    </article>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
}) {
  return (
    <div>
      <dt className="lbl mb-1">{label}</dt>
      <dd className={`num text-[12px] ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

/** Ladder of grid levels with fills and the live price marker. */
function GridLadder({ bot, price }: { bot: Bot; price?: number }) {
  if (bot.strategy.kind !== "grid") return null;
  const levels = gridLevels(bot.strategy);
  if (levels.length === 0) return null;
  const filled = new Set(bot.runtime.filledLevels);

  return (
    <div className="mt-3 flex flex-col-reverse gap-[3px]">
      {levels.map((level, index) => {
        const active =
          price !== undefined &&
          Math.abs(price - level) ===
            Math.min(...levels.map((value) => Math.abs((price ?? 0) - value)));
        return (
          <div key={level} className="flex items-center gap-2">
            <span
              className="h-[6px] flex-1"
              style={{
                background: filled.has(index)
                  ? "var(--color-accent)"
                  : "var(--color-raise)",
                opacity: filled.has(index) ? 0.85 : 1,
                outline: active ? "1px solid var(--color-edge)" : undefined,
              }}
            />
            <span className="num w-16 text-right text-[10px] text-faint">
              {formatPrice(level)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
