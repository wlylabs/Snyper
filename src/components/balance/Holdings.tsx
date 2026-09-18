"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Skeleton } from "@/components/ui/Panel";
import { CHAIN_ID, chainMeta } from "@/lib/chains";
import { formatAmount, formatSignificant, truncateAddress } from "@/lib/format";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useHoldings, type Holding } from "@/hooks/useHoldings";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";

/**
 * How many rows stand before the list folds.
 *
 * An address on this chain routinely holds two hundred tokens, nearly all of
 * them airdropped and unpriced. They are the reader's, so none of them is
 * hidden — but they are not what the reader opened this screen to see, and a
 * list that opens at two hundred rows buries the four that matter.
 */
const VISIBLE = 12;

function usd(value: number | undefined): string {
  return value === undefined ? "—" : `$${formatSignificant(value, 2)}`;
}

function HoldingRow({
  title,
  subtitle,
  amount,
  value,
  unconfirmed,
}: {
  title: string;
  subtitle: string;
  amount: string;
  value: string;
  unconfirmed?: string;
}) {
  return (
    <span className="tile cursor-default">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span className="block truncate text-[11px] font-normal text-faint">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="num block text-[12px]">{amount}</span>
        <span className="num block text-[11px] font-normal text-faint">{value}</span>
      </span>
      {/*
       * A figure the chain would not confirm is marked rather than dropped. The
       * reader is looking at the index's number, which is almost always the same
       * number — but "almost always" is not something a balance gets to assume.
       */}
      {unconfirmed && (
        <span className="dot dot-short shrink-0" title={unconfirmed} aria-label={unconfirmed} />
      )}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
      ))}
    </div>
  );
}

export function Holdings() {
  const mounted = useMounted();
  const { t } = useI18n();
  const prompt = useConnectPrompt();
  const [expanded, setExpanded] = useState(false);
  const { address, holdings, native, nativeValue, total, loading, verifying, error, refetch } =
    useHoldings();

  const meta = chainMeta(CHAIN_ID);

  const heading = (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-[15px] font-bold tracking-[0.12em] uppercase">
          {t("page.balance.title")}
        </h1>
        <p className="mt-0.5 text-[11px] text-faint">{t("page.balance.subtitle")}</p>
      </div>
      {mounted && address && (
        <button
          type="button"
          className="btn btn-sm btn-short"
          onClick={refetch}
          aria-label={t("balance.refresh")}
        >
          <Icon name="refresh" size={13} className={verifying ? "animate-spin" : undefined} />
          <span className="hidden sm:inline">{t("balance.refresh")}</span>
        </button>
      )}
    </div>
  );

  const body = () => {
    if (!mounted) return <Loading />;

    if (!address) {
      return (
        <Empty
          title={t("balance.connect")}
          hint={t("balance.connectHint")}
          action={
            prompt && (
              <button type="button" className="btn btn-accent btn-sm" onClick={prompt}>
                <Icon name="wallet" size={13} />
                {t("wallet.connect")}
              </button>
            )
          }
        />
      );
    }

    if (loading) return <Loading />;

    if (error) {
      return (
        <Empty
          title={t("balance.failed")}
          hint={t("balance.failedHint")}
          action={
            <button type="button" className="btn btn-sm btn-short" onClick={refetch}>
              <Icon name="refresh" size={13} />
              {t("balance.retry")}
            </button>
          }
        />
      );
    }

    const hasCoin = native !== undefined && Number(native.formatted) > 0;
    if (!hasCoin && holdings.length === 0) {
      return <Empty title={t("balance.empty")} hint={t("balance.emptyHint")} />;
    }

    const shown = expanded ? holdings : holdings.slice(0, VISIBLE);
    const hidden = holdings.length - shown.length;

    return (
      <div className="flex flex-col gap-1.5">
        {hasCoin && native && (
          <HoldingRow
            title={native.symbol}
            subtitle={meta?.nativeName ?? t("common.network")}
            amount={formatAmount(Number(native.formatted), 5)}
            value={usd(nativeValue)}
          />
        )}

        {shown.map((row: Holding) => (
          <HoldingRow
            key={row.address}
            title={row.symbol}
            subtitle={row.name}
            amount={formatAmount(row.amount)}
            value={usd(row.value)}
            unconfirmed={row.confirmed ? undefined : t("balance.unconfirmed")}
          />
        ))}

        {(hidden > 0 || expanded) && (
          <button
            type="button"
            className="tile justify-center text-dim"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? t("balance.less") : t("balance.more", { count: hidden })}
            <Icon
              name="chevron"
              size={13}
              className={expanded ? "rotate-180 text-faint" : "text-faint"}
            />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {heading}

      {mounted && address && (
        <Panel
          className="mb-3"
          label={t("balance.total")}
          meta={<span className="lbl">{truncateAddress(address, 6, 4)}</span>}
        >
          <p className="num text-[30px] leading-none">{usd(total)}</p>
          <p className="lbl mt-2">{t("balance.indicative")}</p>
        </Panel>
      )}

      <Panel label={t("balance.holdings")}>
        {body()}
      </Panel>

      <p className="mt-3 text-center text-[10px] tracking-[0.1em] text-faint uppercase">
        {t("balance.source")}
      </p>
    </div>
  );
}
