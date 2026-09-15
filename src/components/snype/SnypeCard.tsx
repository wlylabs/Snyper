"use client";

import { useState } from "react";
import { Flash } from "@/components/ui/Flash";
import { Icon } from "@/components/ui/Icon";
import { useI18n } from "@/hooks/useI18n";
import { chainMeta } from "@/lib/chains";
import { formatAmount, formatDuration, formatPrice, formatSigned } from "@/lib/format";
import { describeSnype, exitTargets, position } from "@/lib/snype";
import type { Snype, SnypeStage } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import type { TKey } from "@/lib/i18n";

const STAGE_LABEL: Record<SnypeStage, TKey> = {
  waiting: "snype.stage.waiting",
  entering: "snype.stage.entering",
  holding: "snype.stage.holding",
  exiting: "snype.stage.exiting",
  done: "snype.stage.done",
  expired: "snype.stage.expired",
  cancelled: "snype.stage.cancelled",
};

const EXIT_LABEL = {
  tp: "snype.exit.tp",
  cl: "snype.exit.cl",
  manual: "snype.exit.manual",
} satisfies Record<string, TKey>;

export function SnypeCard({ snype }: { snype: Snype }) {
  const { t, r } = useI18n();
  const closeSnype = useAppStore((state) => state.closeSnype);
  const removeSnype = useAppStore((state) => state.removeSnype);
  const pushSignal = useAppStore((state) => state.pushSignal);
  const patchRuntime = useAppStore((state) => state.patchRuntime);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const plan = snype.plan;
  const runtime = snype.runtime;
  const stage: SnypeStage = runtime.stage ?? "waiting";
  const meta = chainMeta(snype.chainId);
  const price = runtime.lastPrice;

  const waiting = stage === "waiting" || stage === "entering";
  const holding = stage === "holding" || stage === "exiting";
  const finished = stage === "done" || stage === "expired" || stage === "cancelled";

  const { takeProfit, cutLoss } = exitTargets(plan, runtime.fillPrice);
  const held = position(snype);
  const heldSize = Number(held) / 10 ** snype.base.decimals;

  const toEntry = price !== undefined ? plan.entryPrice / price - 1 : undefined;
  const pnl =
    holding && runtime.fillPrice && price !== undefined
      ? price / runtime.fillPrice - 1
      : undefined;
  const msLeft = plan.expiresAt - Date.now();

  /** Manual full exit. It joins the same queue every other leg goes through. */
  const sellNow = () => {
    if (held <= 0n || price === undefined) return;
    pushSignal({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      snypeId: snype.id,
      snypeName: snype.name,
      chainId: snype.chainId,
      createdAt: Date.now(),
      side: "sell",
      reason: { key: "snype.exit.manual" },
      tokenIn: snype.base,
      tokenOut: snype.quote,
      amountIn: held.toString(),
      price,
      status: "pending",
      leg: "manual",
    });
    patchRuntime(snype.id, { error: undefined });
  };

  return (
    <article className={`panel ${stage === "holding" ? "ticked" : ""}`}>
      <header className="panel-head">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`dot ${holding ? "dot-live" : ""}`} />
          <span className="truncate text-[13px] font-semibold">{snype.name}</span>
        </span>
        <span className="chip shrink-0">{meta?.mark ?? snype.chainId}</span>
      </header>

      <div className="p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="num truncate text-[15px]">
              {snype.base.symbol}
              <span className="text-faint"> / </span>
              {snype.quote.symbol}
            </span>
          </span>
          <span className="num text-[15px]">
            <Flash value={price}>{price !== undefined ? formatPrice(price) : "—"}</Flash>
            <span className="ml-1.5 text-[10px] text-faint">{snype.quote.symbol}</span>
          </span>
        </div>

        <p
          className={`mt-2 inline-block border px-1.5 py-0.5 text-[10px] tracking-[0.1em] uppercase ${
            stage === "expired" || stage === "cancelled"
              ? "border-line text-faint"
              : holding || stage === "done"
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
                label={t("snype.entryAt")}
                value={`${formatPrice(plan.entryPrice)}${
                  toEntry !== undefined
                    ? ` · ${t("snype.away", { percent: formatSigned(toEntry) })}`
                    : ""
                }`}
              />
              <Metric
                label={t("snype.expiresIn")}
                value={msLeft > 0 ? formatDuration(msLeft / 1000) : "—"}
                tone="warn"
              />
              <p className="text-[11px] leading-relaxed text-faint">{t("snype.noSpendYet")}</p>
            </>
          )}

          {holding && (
            <>
              <Metric label={t("snype.fillPrice")} value={formatPrice(runtime.fillPrice)} />
              <Metric
                label={t("snype.received")}
                value={`${formatAmount(heldSize)} ${snype.base.symbol}`}
              />
              <Metric
                label={t("snype.result")}
                value={formatSigned(pnl)}
                tone={pnl !== undefined && pnl < 0 ? "short" : "long"}
              />
              <Targets takeProfit={takeProfit} cutLoss={cutLoss} />
            </>
          )}

          {finished && (
            <>
              {runtime.exitReason && (
                <Metric label={t("snype.result")} value={t(EXIT_LABEL[runtime.exitReason])} />
              )}
              {stage === "expired" && (
                <p className="text-[11px] leading-relaxed text-faint">
                  {t("snype.expiredAfter")}
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

        <p className="mt-2 text-[11px] text-faint">{r(describeSnype(snype))}</p>

        <div className="mt-3 flex gap-2">
          {holding && (
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={sellNow}
              disabled={stage === "exiting" || held <= 0n}
            >
              {t("snype.sellNow")}
            </button>
          )}
          {waiting && (
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={() => closeSnype(snype.id, "cancelled")}
            >
              {t("snype.cancel")}
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
                  onClick={() => removeSnype(snype.id)}
                >
                  {t("snype.delete")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-sm flex-1"
                onClick={() => setConfirmDelete(true)}
              >
                {t("snype.delete")}
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
    /* Both are measured from the fill, not from the price the reader typed —
       a surprise worth answering on hover rather than in a line of prose under
       every card that ever ran. */
    <div className="grid grid-cols-2 gap-2" title={t("snype.recalcNote")}>
      <div className="border border-line bg-base px-2 py-1.5">
        <span className="lbl block">{t("snype.exit.tp")}</span>
        <span className="num text-[12.5px] long">{formatPrice(takeProfit)}</span>
      </div>
      <div className="border border-line bg-base px-2 py-1.5">
        <span className="lbl block">{t("snype.exit.cl")}</span>
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
