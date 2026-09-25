"use client";

import { useAccount } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Skeleton } from "@/components/ui/Panel";
import { Figure } from "@/components/ui/Figure";
import { CHAIN_ID, explorerTx } from "@/lib/chains";
import { formatAmount, formatCompact } from "@/lib/format";
import { PER_MINUTE } from "@/lib/screener";
import { useActivity, type Fill } from "@/hooks/useActivity";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";

/**
 * Always dollars — see the same choice in `Terminal`. The currency setting is
 * the balance screen's, and a fill's own worth is a trading figure rather
 * than money the reader is holding.
 */
function usd(value: number): string {
  return `$${formatCompact(value)}`;
}

/** Same shape as the age readouts on the other screens — see `Screener`. */
function age(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function Row({ fill, head }: { fill: Fill; head: bigint | undefined }) {
  const { t } = useI18n();
  const minutes = head === undefined ? undefined : Number(head - fill.block) / PER_MINUTE;
  const bought = fill.side === "buy";

  return (
    <a href={explorerTx(CHAIN_ID, fill.hash)} target="_blank" rel="noreferrer" className="tile">
      <Icon name={bought ? "arrow-up" : "arrow-down"} size={14} className={bought ? "long" : "short"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {bought ? t("activity.buy") : t("activity.sell")}{" "}
          <span className="font-normal text-faint">
            {fill.symbol}/{fill.quote}
          </span>
        </span>
        <span className="block truncate text-[11px] font-normal text-faint">
          <Figure className="num" value={`${formatAmount(fill.tokenAmount)} ${fill.symbol}`} />
        </span>
      </span>
      <span className="shrink-0 text-right">
        <Figure className="num block text-[12px]" value={`${bought ? "-" : "+"}${usd(fill.usd)}`} />
        <span className="block text-[11px] font-normal text-faint">
          {minutes === undefined ? "—" : age(minutes)}
        </span>
      </span>
      <Icon name="external" size={12} className="shrink-0 text-faint" />
    </a>
  );
}

/**
 * What this wallet has bought and sold through this app, live.
 *
 * Nothing here is kept anywhere this app controls — see `useActivity`. That
 * makes the window honest rather than generous: the endpoint answers a
 * `Swap` scan for about fifty minutes of blocks before it refuses, whatever
 * the scan is filtered to, so that is what this screen shows and says.
 */
export function Activity() {
  const mounted = useMounted();
  const { t } = useI18n();
  const { address } = useAccount();
  const prompt = useConnectPrompt();
  const { fills, head, loading, error, refetch } = useActivity();

  const body = () => {
    if (!mounted) {
      return (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
          ))}
        </div>
      );
    }

    if (!address) {
      return (
        <Empty
          title={t("activity.noWallet")}
          hint={t("activity.noWalletHint")}
          action={
            prompt && (
              <button type="button" className="btn btn-accent btn-sm" onClick={prompt}>
                <Icon name="wallet" size={14} />
                {t("wallet.connect")}
              </button>
            )
          }
        />
      );
    }

    if (loading && fills.length === 0) {
      return (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <Empty
          title={t("activity.failed")}
          hint={t("activity.failedHint")}
          action={
            <button type="button" className="btn btn-sm btn-short" onClick={() => void refetch()}>
              <Icon name="refresh" size={13} />
              {t("balance.retry")}
            </button>
          }
        />
      );
    }

    if (fills.length === 0) {
      return <Empty title={t("activity.empty")} hint={t("activity.emptyHint")} />;
    }

    return (
      <div className="flex flex-col gap-1.5">
        {fills.map((fill, index) => (
          <Row key={`${fill.hash}:${fill.pool}:${index}`} fill={fill} head={head} />
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="sr-only">{t("page.activity.title")}</h1>

      <Panel
        label={t("activity.window")}
        meta={
          mounted && fills.length > 0 ? (
            <span className="lbl">{t("activity.count", { shown: fills.length })}</span>
          ) : undefined
        }
      >
        {body()}
      </Panel>
    </div>
  );
}
