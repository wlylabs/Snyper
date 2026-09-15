"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel } from "@/components/ui/Panel";
import { useDispatchSignal } from "@/hooks/useDispatchSignal";
import { chainMeta, explorerTx } from "@/lib/chains";
import { formatAmount, formatPrice, timeAgo } from "@/lib/format";
import type { Signal } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { useI18n } from "@/hooks/useI18n";
import type { TKey } from "@/lib/i18n";

export function SignalQueue() {
  const { t } = useI18n();
  const signals = useAppStore((state) => state.signals);
  const clearSignals = useAppStore((state) => state.clearSignals);
  const open = signals.filter((s) => s.status === "pending" || s.status === "executing");
  const recent = signals.filter((s) => s.status !== "pending" && s.status !== "executing").slice(0, 6);

  return (
    <Panel
      label={t("signal.queue")}
      meta={<span className="chip">{t("signal.open", { count: open.length })}</span>}
      action={
        signals.length > 0 ? (
          <button
            type="button"
            className="lbl text-faint transition-colors hover:text-ink"
            onClick={() => clearSignals((signal) => signal.status !== "pending")}
          >
            {t("signal.clearLog")}
          </button>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {open.length === 0 && recent.length === 0 ? (
        <Empty
          title={t("signal.emptyTitle")}
          hint={t("signal.emptyHint")}
        />
      ) : (
        <div>
          {open.map((signal) => (
            <SignalRow key={signal.id} signal={signal} actionable />
          ))}
          {recent.map((signal) => (
            <SignalRow key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </Panel>
  );
}

const STATUS_KEY: Record<Signal["status"], TKey> = {
  pending: "status.pending",
  executing: "status.executing",
  submitted: "status.submitted",
  confirmed: "status.confirmed",
  failed: "status.failed",
  cancelled: "status.cancelled",
};

function SignalRow({ signal, actionable }: { signal: Signal; actionable?: boolean }) {
  const { t, r } = useI18n();
  const dispatch = useDispatchSignal();
  const updateSignal = useAppStore((state) => state.updateSignal);
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [busy, setBusy] = useState(false);

  const meta = chainMeta(signal.chainId);
  const amount = formatAmount(
    Number(formatUnits(BigInt(signal.amountIn), signal.tokenIn.decimals)),
    5,
  );
  const wrongChain = Boolean(address) && chainId !== signal.chainId;

  const tone =
    signal.status === "confirmed"
      ? "long"
      : signal.status === "failed"
        ? "short"
        : signal.status === "executing"
          ? "warn"
          : "";

  return (
    <div className="border-b border-line p-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <span className={signal.side === "buy" ? "long" : "short"}>
              {signal.side === "buy" ? t("signal.buy") : t("signal.sell")}
            </span>
            <span className="num">
              {amount} {signal.tokenIn.symbol}
            </span>
            <Icon name="chevron" size={11} className="-rotate-90 text-faint" />
            <span className="num text-dim">{signal.tokenOut.symbol}</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-faint">
            {signal.snypeName} · {r(signal.reason)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-[12px]">{formatPrice(signal.price)}</p>
          <p className="lbl mt-1">{t("common.ago", { value: timeAgo(signal.createdAt) })}</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className={`chip ${tone === "long" ? "chip-live" : tone === "short" ? "chip-short" : ""}`}>
          {t(STATUS_KEY[signal.status])}
        </span>
        <span className="lbl">{meta?.mark ?? signal.chainId}</span>

        {signal.hash && (
          <a
            href={explorerTx(signal.chainId, signal.hash)}
            target="_blank"
            rel="noreferrer"
            className="lbl ml-auto inline-flex items-center gap-1 text-accent-text"
          >
            {t("common.receipt")}
            <Icon name="external" size={11} />
          </a>
        )}

        {actionable && !signal.hash && (
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => updateSignal(signal.id, { status: "cancelled" })}
              disabled={busy}
            >
              {t("signal.dismiss")}
            </button>
            {wrongChain ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => switchChain({ chainId: signal.chainId })}
              >
                {t("signal.switchTo", { chain: meta?.mark ?? "" })}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-accent btn-sm"
                disabled={busy || !address || signal.status === "executing"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await dispatch(signal);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? t("signal.working") : t("signal.execute")}
              </button>
            )}
          </div>
        )}
      </div>

      {signal.error && (
        <p className="wrap-any mt-2 text-[11px] leading-relaxed short">{signal.error}</p>
      )}
    </div>
  );
}
