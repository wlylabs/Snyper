"use client";

import { useState } from "react";
import { Flash } from "@/components/ui/Flash";
import { Icon } from "@/components/ui/Icon";
import { useI18n } from "@/hooks/useI18n";
import { chainMeta } from "@/lib/chains";
import { formatAmount, formatDuration, formatPrice, formatSigned } from "@/lib/format";
import { orderPosition, orderTargets } from "@/lib/strategies";
import type { Bot, OrderStage } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import type { TKey } from "@/lib/i18n";

const STAGE_LABEL: Record<OrderStage, TKey> = {
  waiting: "order.stage.waiting",
  entering: "order.stage.entering",
  holding: "order.stage.holding",
  exiting: "order.stage.exiting",
  done: "order.stage.done",
  expired: "order.stage.expired",
  cancelled: "order.stage.cancelled",
};

const EXIT_LABEL = {
  tp: "order.exit.tp",
  cl: "order.exit.cl",
  manual: "order.exit.manual",
} satisfies Record<string, TKey>;

export function OrderCard({ bot }: { bot: Bot }) {
  const { t, r } = useI18n();
  const closeOrder = useAppStore((state) => state.closeOrder);
  const removeBot = useAppStore((state) => state.removeBot);
  const pushSignal = useAppStore((state) => state.pushSignal);
  const patchRuntime = useAppStore((state) => state.patchRuntime);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (bot.strategy.kind !== "order") return null;
  const strategy = bot.strategy;
  const runtime = bot.runtime;
  const stage: OrderStage = runtime.stage ?? "waiting";
  const meta = chainMeta(bot.chainId);
  const price = runtime.lastPrice;

  const waiting = stage === "waiting" || stage === "entering";
  const holding = stage === "holding" || stage === "exiting";
  const finished = stage === "done" || stage === "expired" || stage === "cancelled";

  const { takeProfit, cutLoss } = orderTargets(strategy, runtime.fillPrice);
  const position = orderPosition(bot);
  const positionSize = Number(position) / 10 ** bot.base.decimals;

  const toEntry = price !== undefined ? strategy.entryPrice / price - 1 : undefined;
  const pnl =
    holding && runtime.fillPrice && price !== undefined
      ? price / runtime.fillPrice - 1
      : undefined;
  const msLeft = strategy.expiresAt - Date.now();

  /** Manual full exit. It joins the same queue every other leg goes through. */
  const sellNow = () => {
    if (position <= 0n || price === undefined) return;
    pushSignal({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      botId: bot.id,
      botName: bot.name,
      chainId: bot.chainId,
      createdAt: Date.now(),
      side: "sell",
      reason: { key: "order.exit.manual" },
      tokenIn: bot.base,
      tokenOut: bot.quote,
      amountIn: position.toString(),
      price,
      status: "pending",
      leg: "manual",
    });
    patchRuntime(bot.id, { error: undefined });
  };

  return (
    <article className={`panel ${stage === "holding" ? "ticked" : ""}`}>
      <header className="panel-head">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`dot ${holding ? "dot-live" : ""}`} />
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
            <Flash value={price}>{price !== undefined ? formatPrice(price) : "—"}</Flash>
            <span className="ml-1.5 text-[10px] text-faint">{bot.quote.symbol}</span>
          </span>
        </div>

        <p
          className={`mt-2 inline-block border px-1.5 py-0.5 text-[10px] tracking-[0.1em] uppercase ${
            stage === "expired" || stage === "cancelled"
              ? "border-line text-faint"
              : holding
                ? "border-[var(--color-accent-text)] text-accent-text"
                : stage === "done"
                  ? "border-[var(--color-accent-text)] text-accent-text"
                  : "border-[var(--color-warn)] warn"
          }`}
        >
          {t(STAGE_LABEL[stage])}
        </p>

        <dl className="mt-3 flex flex-col gap-2">
          {waiting && (
            <>
              <Metric
                label={t("order.entryAt")}
                value={`${formatPrice(strategy.entryPrice)}${
                  toEntry !== undefined ? ` · ${t("order.away", { percent: formatSigned(toEntry) })}` : ""
                }`}
              />
              <Metric
                label={t("order.expiresIn")}
                value={msLeft > 0 ? formatDuration(msLeft / 1000) : "—"}
                tone="warn"
              />
              <p className="text-[11px] leading-relaxed text-faint">{t("order.noSpendYet")}</p>
            </>
          )}

          {holding && (
            <>
              <Metric label={t("order.fillPrice")} value={formatPrice(runtime.fillPrice)} />
              <Metric
                label={t("order.received")}
                value={`${formatAmount(positionSize)} ${bot.base.symbol}`}
              />
              <Metric
                label={t("order.result")}
                value={formatSigned(pnl)}
                tone={pnl !== undefined && pnl < 0 ? "short" : "long"}
              />
              <Targets takeProfit={takeProfit} cutLoss={cutLoss} />
              <p className="text-[11px] leading-relaxed text-faint">{t("order.recalcNote")}</p>
            </>
          )}

          {finished && (
            <>
              {runtime.exitReason && (
                <Metric label={t("order.result")} value={t(EXIT_LABEL[runtime.exitReason])} />
              )}
              {stage === "expired" && (
                <p className="text-[11px] leading-relaxed text-faint">
                  {t("order.expiredAfter")}
                </p>
              )}
            </>
          )}
        </dl>

        {runtime.error && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed short">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            {runtime.error}
          </p>
        )}

        <p className="mt-2 text-[11px] text-faint">{r({ key: "strategy.orderDesc", vars: {
          amount: strategy.amountQuote,
          quote: bot.quote.symbol,
          entry: formatPrice(strategy.entryPrice),
          tp: strategy.takeProfitPct,
          cl: strategy.cutLossPct,
        } })}</p>

        <div className="mt-3 flex gap-2">
          {holding && (
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={sellNow}
              disabled={stage === "exiting" || position <= 0n}
            >
              {t("order.sellNow")}
            </button>
          )}
          {waiting && (
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={() => closeOrder(bot.id, "cancelled")}
            >
              {t("order.cancelOrder")}
            </button>
          )}
          {finished &&
            (confirmDelete ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm flex-1"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm flex-1 short"
                  onClick={() => removeBot(bot.id)}
                >
                  {t("bots.delete")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-sm flex-1"
                onClick={() => setConfirmDelete(true)}
              >
                {t("bots.delete")}
              </button>
            ))}
        </div>
      </div>
    </article>
  );
}

function Targets({ takeProfit, cutLoss }: { takeProfit: number; cutLoss: number }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="border border-line bg-base px-2 py-1.5">
        <span className="lbl block">{t("order.exit.tp")}</span>
        <span className="num text-[12.5px] long">{formatPrice(takeProfit)}</span>
      </div>
      <div className="border border-line bg-base px-2 py-1.5">
        <span className="lbl block">{t("order.exit.cl")}</span>
        <span className="num text-[12.5px] short">{formatPrice(cutLoss)}</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "long" | "short" | "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-dim">{label}</dt>
      <dd className={`num text-right text-[12.5px] ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
