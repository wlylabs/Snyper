"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useMounted } from "@/hooks/useMounted";
import { chainMeta, explorerTx } from "@/lib/chains";
import { formatAmount, formatClock, timeAgo } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

type Filter = "all" | "swap" | "approval" | "signal";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "swap", label: "Swaps" },
  { value: "approval", label: "Approvals" },
  { value: "signal", label: "Signals" },
];

type Entry = {
  id: string;
  at: number;
  kind: Filter;
  title: string;
  detail: string;
  status: string;
  tone: "long" | "short" | "warn" | "";
  chainId: number;
  hash?: string;
};

export default function ActivityPage() {
  const mounted = useMounted();
  const trades = useAppStore((state) => state.trades);
  const signals = useAppStore((state) => state.signals);
  const [filter, setFilter] = useState<Filter>("all");

  const entries = useMemo<Entry[]>(() => {
    const tradeEntries: Entry[] = trades.map((trade) => {
      const amount =
        trade.amountIn && trade.tokenIn
          ? formatAmount(
              Number(formatUnits(BigInt(trade.amountIn), trade.tokenIn.decimals)),
              5,
            )
          : "";
      return {
        id: trade.id,
        at: trade.createdAt,
        kind: trade.kind === "approval" ? "approval" : "swap",
        title:
          trade.kind === "approval"
            ? `Approve ${trade.tokenIn?.symbol ?? "token"}`
            : `${trade.tokenIn?.symbol ?? "?"} → ${trade.tokenOut?.symbol ?? "?"}`,
        detail: [amount && `${amount} ${trade.tokenIn?.symbol ?? ""}`, trade.botName ?? (trade.source === "terminal" ? "Terminal" : "Strategy")]
          .filter(Boolean)
          .join(" · "),
        status: trade.status,
        tone: trade.status === "confirmed" ? "long" : trade.status === "failed" ? "short" : "warn",
        chainId: trade.chainId,
        hash: trade.hash,
      };
    });

    const signalEntries: Entry[] = signals.map((signal) => ({
      id: signal.id,
      at: signal.createdAt,
      kind: "signal",
      title: `${signal.side === "buy" ? "Buy" : "Sell"} signal · ${signal.tokenIn.symbol} → ${signal.tokenOut.symbol}`,
      detail: `${signal.botName} · ${signal.reason}`,
      status: signal.status,
      tone:
        signal.status === "confirmed"
          ? "long"
          : signal.status === "failed"
            ? "short"
            : signal.status === "cancelled"
              ? ""
              : "warn",
      chainId: signal.chainId,
      hash: signal.hash,
    }));

    return [...tradeEntries, ...signalEntries]
      .filter((entry) => filter === "all" || entry.kind === filter)
      .sort((a, b) => b.at - a.at);
  }, [trades, signals, filter]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-bold tracking-[0.12em] uppercase">Activity</h1>
          <p className="mt-0.5 text-[11px] text-faint">
            Local ledger of everything this device submitted or signalled.
          </p>
        </div>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <Panel bodyClassName="p-0">
        {!mounted || entries.length === 0 ? (
          <Empty
            title="Nothing recorded yet"
            hint="Swaps, approvals and strategy signals land here with their transaction hashes."
          />
        ) : (
          entries.map((entry) => {
            const meta = chainMeta(entry.chainId);
            return (
              <div
                key={`${entry.kind}-${entry.id}`}
                className="flex items-start gap-3 border-b border-line p-3 last:border-b-0"
              >
                <span className={`dot mt-1.5 ${entry.tone === "long" ? "dot-live" : entry.tone === "short" ? "dot-short" : ""}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{entry.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-faint">{entry.detail}</p>
                  <p className="lbl mt-1.5">
                    {formatClock(entry.at)} · {timeAgo(entry.at)} ago · {meta?.mark ?? entry.chainId}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`chip ${entry.tone === "long" ? "chip-live" : entry.tone === "short" ? "chip-short" : ""}`}>
                    {entry.status}
                  </span>
                  {entry.hash && (
                    <a
                      href={explorerTx(entry.chainId, entry.hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="lbl mt-2 flex items-center justify-end gap-1 text-accent-text"
                    >
                      Receipt
                      <Icon name="external" size={11} />
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Panel>
    </div>
  );
}
