"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { chainMeta } from "@/lib/chains";
import { formatAmount, formatDuration, formatPrice, formatSigned, timeAgo } from "@/lib/format";
import {
  describeStrategy,
  gridLevels,
  heldPosition,
  protectReference,
  protectTargets,
} from "@/lib/strategies";
import type { Bot } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { useI18n } from "@/hooks/useI18n";

export function BotCard({ bot }: { bot: Bot }) {
  const { t, r } = useI18n();
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

        <p className="mt-1 text-[11px] text-dim">{r(describeStrategy(bot))}</p>

        {bot.strategy.kind === "grid" && (
          <GridLadder bot={bot} price={price} />
        )}

        {bot.strategy.kind === "protect" && <ProtectDetail bot={bot} price={price} />}

        <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
          <Metric label={t("bots.fills")} value={String(runtime.fills)} />
          <Metric
            label={t("bots.deployed")}
            value={`${runtime.deployedQuote.toFixed(2)} ${bot.quote.symbol}`}
          />
          <Metric
            label={bot.strategy.kind === "trail" ? t("bots.peak") : t("bots.lastTick")}
            value={
              bot.strategy.kind === "trail"
                ? runtime.peak
                  ? formatPrice(runtime.peak)
                  : "—"
                : runtime.lastTickAt
                  ? t("common.ago", { value: timeAgo(runtime.lastTickAt) })
                  : "—"
            }
          />
          {nextLeg !== undefined && (
            <Metric label={t("bots.nextLeg")} value={formatDuration(nextLeg)} />
          )}
          {drawdown !== undefined && (
            <Metric
              label={t("bots.fromPeak")}
              value={formatSigned(drawdown)}
              tone={drawdown < 0 ? "short" : "long"}
            />
          )}
          {bot.dailyCapQuote > 0 && (
            <Metric
              label={t("bots.daySpend")}
              value={`${runtime.spentQuote.toFixed(0)}/${bot.dailyCapQuote} ${bot.quote.symbol}`}
            />
          )}
        </dl>

        {runtime.error && (
          <p className="wrap-any mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed warn">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            {runtime.error}
          </p>
        )}

        {!runtime.error && runtime.note && (
          <p className="wrap-any mt-3 text-[11px] leading-relaxed text-faint">{runtime.note}</p>
        )}

        {runtime.completed && (
          <p className="mt-3 text-[11px] text-faint">{t("bots.completed")}</p>
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
          {armed ? t("bots.disarm") : t("bots.arm")}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => resetBot(bot.id)}
          aria-label={t("bots.resetRuntime")}
          title={t("bots.resetRuntime")}
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
          aria-label={confirmDelete ? t("bots.deleteConfirm") : t("bots.delete")}
          title={confirmDelete ? t("bots.deleteConfirm") : t("bots.delete")}
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

/**
 * What a protect watch is guarding: the balance it read last tick, the price its
 * targets hang off, and where those targets sit.
 */
function ProtectDetail({ bot, price }: { bot: Bot; price?: number }) {
  const { t } = useI18n();
  if (bot.strategy.kind !== "protect") return null;

  const reference = protectReference(bot);
  const { takeProfit, cutLoss } = protectTargets(bot.strategy, reference);
  const held = Number(heldPosition(bot)) / 10 ** bot.base.decimals;
  const change = reference && price ? price / reference - 1 : undefined;

  return (
    <div className="mt-3">
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Metric
          label={t("protect.held")}
          value={bot.runtime.heldBase ? `${formatAmount(held, 4)}` : "—"}
        />
        <Metric
          label={t("protect.reference")}
          value={reference ? formatPrice(reference) : t("protect.onArm")}
        />
        <Metric
          label={t("protect.change")}
          value={change !== undefined ? formatSigned(change) : "—"}
          tone={change !== undefined && change < 0 ? "short" : "long"}
        />
      </dl>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="border border-line bg-base px-2 py-1.5">
          <span className="lbl block">{t("order.exit.tp")}</span>
          <span className={`num text-[12.5px] ${takeProfit !== undefined ? "long" : "text-faint"}`}>
            {takeProfit !== undefined ? formatPrice(takeProfit) : t("snipe.targetOff")}
          </span>
        </div>
        <div className="border border-line bg-base px-2 py-1.5">
          <span className="lbl block">{t("order.exit.cl")}</span>
          <span className={`num text-[12.5px] ${cutLoss !== undefined ? "short" : "text-faint"}`}>
            {cutLoss !== undefined ? formatPrice(cutLoss) : t("snipe.targetOff")}
          </span>
        </div>
      </div>
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
                // An empty level still has to read as a level on a white panel.
                background: filled.has(index)
                  ? "var(--color-accent-line)"
                  : "var(--color-edge)",
                borderRadius: 999,
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
