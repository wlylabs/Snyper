"use client";

import { useAccount, useChainId } from "wagmi";
import { IconButton } from "@/components/ui/IconButton";
import { Empty, Panel } from "@/components/ui/Panel";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { usePositions } from "@/hooks/usePositions";
import { formatAmount, formatPrice, formatSigned } from "@/lib/format";
import type { PricedPosition } from "@/lib/positions";

/**
 * Open and closed positions, rebuilt from the swaps this browser submitted.
 * Entry is the weighted average of what was actually paid, so a bag bought in
 * three legs reads as one line with one break-even price.
 */
export function PositionsPanel() {
  const mounted = useMounted();
  const { t } = useI18n();
  const activeChainId = useChainId();
  const { chainId: accountChainId } = useAccount();
  const chainId = accountChainId ?? activeChainId;

  const { positions, totals, isFetching, refetch } = usePositions(chainId);
  const open = positions.filter((position) => position.size > 0);
  const closed = positions.filter((position) => position.size <= 0 && position.fills > 0);

  return (
    <Panel
      label={t("positions.title")}
      meta={
        <span className={`chip ${isFetching ? "chip-live" : ""}`}>
          <span className={`dot ${isFetching ? "dot-live" : ""}`} />
          {t("positions.count", { count: totals.open })}
        </span>
      }
      action={
        <IconButton
          icon="refresh"
          act="spin"
          busy={isFetching}
          onClick={() => void refetch()}
          aria-label={t("common.refresh")}
        />
      }
      bodyClassName="p-0"
    >
      {!mounted ? (
        <Empty title={t("common.loadingLocal")} />
      ) : positions.length === 0 ? (
        <Empty title={t("positions.emptyTitle")} />
      ) : (
        <>
          {totals.byCash.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line p-3">
              {totals.byCash.map((row) => (
                <div key={row.symbol}>
                  <p className="lbl mb-1">{t("positions.booked", { symbol: row.symbol })}</p>
                  <p
                    className={`num text-[13px] ${
                      row.realised > 0 ? "long" : row.realised < 0 ? "short" : ""
                    }`}
                  >
                    {signed(row.realised)} {row.symbol}
                  </p>
                  <p className="mt-1 text-[10px] text-faint">
                    {t("positions.openResult", {
                      value: `${signed(row.unrealised)} ${row.symbol}`,
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {open.map((position) => (
            <PositionRow key={position.key} position={position} />
          ))}

          {closed.length > 0 && (
            <div className="border-t border-line px-3 py-2">
              <p className="lbl">{t("positions.closed")}</p>
            </div>
          )}
          {closed.map((position) => (
            <PositionRow key={position.key} position={position} closed />
          ))}
        </>
      )}
    </Panel>
  );
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(value), 4)}`;
}

function PositionRow({
  position,
  closed = false,
}: {
  position: PricedPosition;
  closed?: boolean;
}) {
  const { t } = useI18n();
  const result = closed ? position.realised : position.unrealised;
  const tone = result === undefined ? "" : result > 0 ? "long" : result < 0 ? "short" : "";

  return (
    <div className="flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span
            className="ticker ticker-inline"
            data-native={position.base.native ? "true" : undefined}
          >
            {position.base.symbol}
          </span>
          <span className="text-[10px] text-faint">/ {position.cash.symbol}</span>
        </p>
        <p className="num truncate text-[11px] text-faint">
          {closed
            ? t("positions.closedLine", { fills: position.fills })
            : t("positions.entryLine", {
                entry: formatPrice(position.entry),
                size: formatAmount(position.size, 4),
                symbol: position.base.symbol,
              })}
        </p>
      </div>
      <div className="text-right">
        <p className={`num text-[13px] ${tone}`}>
          {result === undefined ? "—" : `${signed(result)} ${position.cash.symbol}`}
        </p>
        <p className="num text-[11px] text-faint">
          {closed
            ? t("positions.realised")
            : position.change !== undefined
              ? formatSigned(position.change)
              : t("positions.unpriced")}
        </p>
      </div>
    </div>
  );
}
