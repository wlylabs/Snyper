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

export function SignalQueue() {
  const signals = useAppStore((state) => state.signals);
  const clearSignals = useAppStore((state) => state.clearSignals);
  const open = signals.filter((s) => s.status === "pending" || s.status === "executing");
  const recent = signals.filter((s) => s.status !== "pending" && s.status !== "executing").slice(0, 6);

  return (
    <Panel
      label="Signal queue"
      meta={<span className="chip">{open.length} open</span>}
      action={
        signals.length > 0 ? (
          <button
            type="button"
            className="lbl text-faint transition-colors hover:text-ink"
            onClick={() => clearSignals((signal) => signal.status !== "pending")}
          >
            Clear log
          </button>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {open.length === 0 && recent.length === 0 ? (
        <Empty
          title="No signals yet"
          hint="Armed strategies publish a signal here the moment their condition is met."
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

function SignalRow({ signal, actionable }: { signal: Signal; actionable?: boolean }) {
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
              {signal.side === "buy" ? "BUY" : "SELL"}
            </span>
            <span className="num">
              {amount} {signal.tokenIn.symbol}
            </span>
            <Icon name="chevron" size={11} className="-rotate-90 text-faint" />
            <span className="num text-dim">{signal.tokenOut.symbol}</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-faint">
            {signal.botName} · {signal.reason}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-[12px]">{formatPrice(signal.price)}</p>
          <p className="lbl mt-1">{timeAgo(signal.createdAt)} ago</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className={`chip ${tone === "long" ? "chip-live" : tone === "short" ? "chip-short" : ""}`}>
          {signal.status}
        </span>
        <span className="lbl">{meta?.mark ?? signal.chainId}</span>

        {signal.hash && (
          <a
            href={explorerTx(signal.chainId, signal.hash)}
            target="_blank"
            rel="noreferrer"
            className="lbl ml-auto inline-flex items-center gap-1 text-accent-text"
          >
            Receipt
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
              Dismiss
            </button>
            {wrongChain ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => switchChain({ chainId: signal.chainId })}
              >
                Switch to {meta?.mark}
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
                {busy ? "Working…" : "Execute"}
              </button>
            )}
          </div>
        )}
      </div>

      {signal.error && <p className="mt-2 text-[11px] leading-relaxed short">{signal.error}</p>}
    </div>
  );
}
