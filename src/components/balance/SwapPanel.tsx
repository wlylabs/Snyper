"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Icon } from "@/components/ui/Icon";
import { Row } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { formatAmount } from "@/lib/format";
import { SLIPPAGE_FLOOR, floorFor, slippageFor, tooThin } from "@/lib/venue";
import { useRoutes, useSwapAction } from "@/hooks/useSwap";
import type { Holding } from "@/hooks/useHoldings";
import { useI18n } from "@/hooks/useI18n";

/**
 * The number after the reader has stopped typing.
 *
 * Every quote is a call to the chain, and a quote is wanted for the amount
 * being sold rather than scaled from some other amount — a pool moves with the
 * size of the trade, so a tenth of a holding does not fill at a tenth of the
 * holding's price. Quoting each keystroke would be right and unaffordable; this
 * waits for the number to stand still first.
 */
function useSettled(value: bigint, ms = 350): bigint {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Basis points as a percent, for a label. 50 reads as 0.5. */
function percent(bps: number): string {
  return String(bps / 100);
}

export function SwapPanel({ row, onSold }: { row: Holding; onSold: () => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [exit, setExit] = useState<string>();

  const amountIn = useMemo(() => {
    const clean = typed.replace(",", ".").trim();
    if (!clean) return 0n;
    try {
      return parseUnits(clean, row.decimals);
    } catch {
      return 0n;
    }
  }, [typed, row.decimals]);

  const settled = useSettled(amountIn);

  /*
   * Before anything is typed the whole holding is quoted, which is what finds
   * the exits and their pools; once there is an amount, that amount is quoted.
   */
  const { bestFor, tradable, asked, loading } = useRoutes(
    row.address,
    settled > 0n ? settled : row.raw,
  );

  useEffect(() => {
    if (tradable.length === 0) return;
    if (exit && tradable.some((option) => option.address === exit)) return;
    setExit(tradable[0].address);
  }, [tradable, exit]);

  const chosen = tradable.find((option) => option.address === exit) ?? tradable[0];
  const route = settled > 0n && chosen ? bestFor(chosen) : undefined;
  /* Worked out from the pool rather than asked for — see `slippageFor`. */
  const slippage = route ? slippageFor(route.impactBps) : SLIPPAGE_FLOOR;
  const thin = route !== undefined && tooThin(route.impactBps);
  const floor = route ? floorFor(route.amountOut, slippage) : 0n;

  const tooMuch = settled > row.raw;
  /** The quote on screen is for `settled`; nothing is sold until it catches up. */
  const steady = settled === amountIn;

  const { approved, approve, approving, send, sending, done, blocked, checking, failure } =
    useSwapAction({
      token: row.address,
      route: tooMuch || thin ? undefined : route,
      amountIn: settled,
      slippageBps: slippage,
      onDone: onSold,
    });

  if (asked && !loading && tradable.length === 0) {
    return (
      <div className="panel mt-3 flex items-start gap-3 p-3">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-faint" />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold">{t("swap.noMarket")}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-dim">{t("swap.noMarketHint")}</p>
        </div>
      </div>
    );
  }

  const ready = settled > 0n && steady && !tooMuch && !thin && route !== undefined;

  return (
    <div className="mt-4">
      <p className="lbl mb-2">{t("swap.title")}</p>

      {row.suspicion && <p className="warn mb-2 text-[11px] leading-relaxed">{t("swap.risky")}</p>}

      <div className="panel p-3">
        <div className="flex items-center gap-2">
          <input
            className="field num min-w-0 flex-1"
            inputMode="decimal"
            placeholder="0"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label={t("swap.amount")}
          />
          <button
            type="button"
            className="btn btn-sm btn-short"
            onClick={() => setTyped(formatUnits(row.raw, row.decimals))}
          >
            {t("swap.max")}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          {formatAmount(row.amount)} {row.symbol}
        </p>

        {tradable.length > 1 && (
          <>
            <p className="lbl mt-3 mb-1.5">{t("swap.for")}</p>
            <Segmented
              options={tradable.map((option) => ({
                value: option.address,
                label: option.symbol,
              }))}
              value={chosen?.address ?? ""}
              onChange={setExit}
            />
          </>
        )}

        <div className="mt-3">
          <Row
            k={t("swap.receive")}
            v={
              <span className="num">
                {route && chosen
                  ? `${formatAmount(Number(formatUnits(route.amountOut, chosen.decimals)))} ${chosen.symbol}`
                  : "—"}
              </span>
            }
          />
          <Row
            k={t("swap.minimum")}
            v={
              <span className="num">
                {route && chosen
                  ? `${formatAmount(Number(formatUnits(floor, chosen.decimals)))} ${chosen.symbol}`
                  : "—"}
              </span>
            }
          />
          <Row
            k={t("swap.impact")}
            v={<span className="num">{route ? `${percent(route.impactBps)}%` : "—"}</span>}
            tone={route && route.impactBps >= 100 ? "warn" : undefined}
          />
          <Row
            k={t("swap.slippage")}
            v={<span className="num">{route ? `${percent(slippage)}%` : "—"}</span>}
          />
          <Row
            k={t("swap.pool")}
            v={route ? t("swap.venue", { fee: percent(route.fee / 100) }) : "—"}
          />
        </div>
      </div>

      {tooMuch && <p className="warn mt-2 text-[11px]">{t("swap.tooMuch")}</p>}

      {thin && !tooMuch && (
        <div className="panel mt-2 flex items-start gap-3 p-3">
          <Icon name="alert" size={16} className="mt-0.5 warn shrink-0" />
          <div className="min-w-0">
            <p className="warn text-[12px] font-semibold">{t("swap.thin")}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">{t("swap.thinHint")}</p>
          </div>
        </div>
      )}

      {blocked && (
        <div className="panel mt-2 flex items-start gap-3 p-3">
          <Icon name="alert" size={16} className="mt-0.5 warn shrink-0" />
          <div className="min-w-0">
            <p className="warn text-[12px] font-semibold">{t("swap.blocked")}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">{t("swap.blockedHint")}</p>
          </div>
        </div>
      )}

      {failure && <p className="warn mt-2 text-[11px]">{t("swap.failed")}</p>}



      <button
        type="button"
        className="btn btn-accent mt-2 w-full"
        disabled={!ready || approving || sending || checking || (approved && !!blocked)}
        onClick={() => (approved ? send() : approve())}
      >
        {done
          ? t("swap.done")
          : sending
            ? t("swap.sending")
            : approving
              ? t("swap.approving")
              : checking
                ? t("swap.checking")
                : approved
                  ? t("swap.send", { symbol: row.symbol })
                  : t("swap.approve", { symbol: row.symbol })}
      </button>
    </div>
  );
}
