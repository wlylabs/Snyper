"use client";

import { useState } from "react";
import { Figure } from "@/components/ui/Figure";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useHoldings, type Holding } from "@/hooks/useHoldings";
import { BalanceCard, COVERED } from "./BalanceCard";
import { SwapPanel } from "./SwapPanel";
import { useI18n } from "@/hooks/useI18n";
import { useMoney } from "@/hooks/useMoney";
import { useMounted } from "@/hooks/useMounted";
import { useAppStore } from "@/store/useAppStore";

/**
 * What a holding has to be worth to earn a row.
 *
 * A wallet on this chain collects contracts it never asked for — two hundred of
 * them is ordinary — and listed at the same weight as a real position they bury
 * it. So the bar is proof: something priced this at a dollar or more. Everything
 * else folds into one line saying how many, and opens again on a tap. Folded,
 * never dropped: a holding the reader cannot see is a holding they cannot sell,
 * and the total still counts every one of them.
 *
 * The unpriced fold too. That is a real cost on a chain where two thirds of
 * what a wallet holds has no price at all, and it was settled the same way the
 * last time this screen existed: unknown is not worthless, but it is not proof
 * either, and the tap brings it all back.
 */
const DOLLAR = 1;

function HoldingRow({
  title,
  subtitle,
  amount,
  value,
  unconfirmed,
  flagged,
  dimmed,
  onClick,
}: {
  title: string;
  subtitle: string;
  amount: string;
  value: string;
  unconfirmed?: string;
  flagged?: boolean;
  /** Hidden, and being looked at anyway. */
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span
          className={`block truncate text-[11px] font-normal ${flagged ? "warn" : "text-faint"}`}
        >
          {subtitle}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <Figure className="num block text-[12px]" value={amount} />
        <Figure className="num block text-[11px] font-normal text-faint" value={value} />
      </span>
      {/*
       * A figure the chain would not confirm is marked rather than dropped. The
       * reader is looking at the index's number, which is almost always the same
       * number — but "almost always" is not something a balance gets to assume.
       */}
      {unconfirmed && (
        <span className="dot dot-short shrink-0" title={unconfirmed} aria-label={unconfirmed} />
      )}
    </>
  );

  if (!onClick) return <span className="tile cursor-default">{inner}</span>;

  return (
    <button type="button" className={`tile ${dimmed ? "opacity-55" : ""}`} onClick={onClick}>
      {inner}
      <Icon name="chevron" size={13} className="-rotate-90 shrink-0 text-faint" />
    </button>
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

/**
 * One holding, opened.
 *
 * The row can only afford a line, and for a token wearing someone else's ticker
 * a line is not enough — the contract address is the only thing that settles
 * which token this is, and it belongs where the reader can read all of it and
 * copy it. This is also where a lure's name is allowed to appear in full, under
 * a label saying whose words they are, rather than in the place a name goes.
 */
function TokenSheet({
  row,
  onClose,
  onSold,
}: {
  row: Holding | undefined;
  onClose: () => void;
  onSold: () => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const setHidden = useAppStore((state) => state.setHidden);
  const covered = useAppStore((state) => Boolean(state.settings.masked));
  const [copied, setCopied] = useState(false);

  if (!row) return null;

  /*
   * The cover follows the money and not the token. What it is for is a reader
   * who does not want the room reading their worth, and a quantity of some
   * memecoin is not that — a sheet that covered the amount as well would leave
   * them unable to check the figure they came here to sell against.
   */
  const worth = covered && row.value !== undefined ? COVERED : money.full(row.value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Sheet open title={t("balance.token")} onClose={onClose}>
      <div className="identity">
        <div>
          <p className="text-[19px] leading-tight font-bold">{row.symbol}</p>
          <p className="num mt-1 text-[11px] text-faint">{truncateAddress(row.address, 6, 4)}</p>
        </div>
        <div className="mt-1">
          <p className="num text-[26px] leading-none">
            <Figure value={formatAmount(row.amount)} />
          </p>
          <p className="lbl mt-2">
            <Figure value={worth} />
          </p>
        </div>
      </div>

      <div className="px-3 pb-4">
        {row.suspicion && (
          <div className="panel mb-3 flex items-start gap-3 p-3">
            <Icon name="alert" size={16} className="mt-0.5 warn shrink-0" />
            <div className="min-w-0">
              <p className="warn text-[12px] font-semibold">
                {row.suspicion === "lure" ? t("balance.flagLure") : t("balance.flagTicker")}
              </p>
              <p className="mt-1 wrap-any text-[11px] leading-relaxed text-dim">
                {row.suspicion === "lure"
                  ? t("balance.flagLureDetail")
                  : t("balance.flagTickerDetail", { symbol: row.symbol })}
              </p>
            </div>
          </div>
        )}

        {/* `Panel` rather than a bare `.panel`: the rows carry no horizontal
            padding of their own, so without its body they sit flush to the
            border and long values run into it. */}
        <Panel>
          <Row
            k={t("balance.amount")}
            v={<Figure className="num" value={formatAmount(row.amount)} />}
          />
          <Row k={t("balance.worth")} v={<Figure className="num" value={worth} />} />
          <Row
            k={row.suspicion ? t("balance.nameAsWritten") : t("balance.name")}
            v={row.name || "—"}
          />
          <Row
            k={t("balance.contract")}
            v={<span className="num">{truncateAddress(row.address, 10, 8)}</span>}
          />
        </Panel>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="tile justify-center"
            data-done={copied ? "true" : undefined}
            onClick={copy}
          >
            <Icon
              key={copied ? "check" : "copy"}
              name={copied ? "check" : "copy"}
              size={14}
              className={`pop ${copied ? "text-accent-text" : "text-dim"}`}
            />
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <a
            href={explorerAddress(CHAIN_ID, row.address)}
            target="_blank"
            rel="noreferrer"
            className="tile justify-center"
          >
            <Icon name="external" size={14} className="text-dim" />
            {t("common.explorer")}
          </a>
        </div>

        <SwapPanel row={row} onSold={onSold} />

        {/*
         * At the bottom, under everything this token can be made to do, because
         * it is the one control here that takes the token off the screen — and
         * it is worth reading what it does not do before pressing it.
         */}
        <button
          type="button"
          className="tile mt-4"
          onClick={() => setHidden(row.address, !row.hidden)}
        >
          <Icon name="hide" size={14} className="text-dim" />
          <span className="flex-1">{row.hidden ? t("balance.unhide") : t("balance.hide")}</span>
        </button>
      </div>
    </Sheet>
  );
}

export function Holdings() {
  const mounted = useMounted();
  const { t } = useI18n();
  const money = useMoney();
  const prompt = useConnectPrompt();
  const [expanded, setExpanded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  /*
   * The address rather than the row, so the sheet reads the live holding. Held
   * as a copy, it froze: hiding a token from inside its own sheet left the
   * button still offering to hide it, because the row it was reading had been
   * taken at the moment of the tap and nothing after that reached it — and a
   * sale would have left the amount above it stale in the same way.
   */
  const [openedToken, setOpenedToken] = useState<string>();
  const covered = useAppStore((state) => Boolean(state.settings.masked));
  const { address, holdings, native, nativeValue, total, loading, verifying, error, refetch } =
    useHoldings();

  const meta = chainMeta(CHAIN_ID);

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

    /*
     * The coin is listed at any size, alone among everything here. Gas comes out
     * of it, and a reader who cannot see their gas balance has no way to work
     * out why a transaction will not sign.
     */
    const hasCoin = native !== undefined && Number(native.formatted) > 0;
    const put = holdings.filter((row) => !row.hidden);
    const away = holdings.filter((row) => row.hidden);
    const listed = put.filter((row) => (row.value ?? 0) >= DOLLAR);
    const folded = put.filter((row) => (row.value ?? 0) < DOLLAR);

    if (!hasCoin && holdings.length === 0) {
      return <Empty title={t("balance.empty")} hint={t("balance.emptyHint")} />;
    }

    const shown = [
      ...(expanded ? [...listed, ...folded] : listed),
      ...(showHidden ? away : []),
    ];

    return (
      <div className="flex flex-col gap-1.5">
        {hasCoin && native && (
          <HoldingRow
            title={native.symbol}
            subtitle={meta?.nativeName ?? t("common.network")}
            amount={formatAmount(Number(native.formatted), 5)}
            value={covered && nativeValue !== undefined ? COVERED : money.full(nativeValue)}
          />
        )}

        {shown.map((row) => (
          <HoldingRow
            key={row.address}
            title={row.symbol}
            subtitle={
              row.suspicion === "lure"
                ? t("balance.flagLure")
                : row.suspicion === "ticker"
                  ? t("balance.flagTicker")
                  : row.name
            }
            flagged={Boolean(row.suspicion)}
            dimmed={row.hidden}
            amount={formatAmount(row.amount)}
            value={covered && row.value !== undefined ? COVERED : money.full(row.value)}
            unconfirmed={row.confirmed ? undefined : t("balance.unconfirmed")}
            onClick={() => setOpenedToken(row.address)}
          />
        ))}

        {folded.length > 0 && (
          <button
            type="button"
            className="tile justify-center text-dim"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? t("balance.less") : t("balance.more", { count: folded.length })}
            <Icon
              name="chevron"
              size={13}
              className={expanded ? "rotate-180 text-faint" : "text-faint"}
            />
          </button>
        )}

        {/*
         * Its own line rather than folded in with the small holdings: those are
         * out of the way because they are not worth a row, and these are out of
         * the way because the reader said so. Two different sentences.
         */}
        {away.length > 0 && (
          <button
            type="button"
            className="tile justify-center text-dim"
            onClick={() => setShowHidden((open) => !open)}
          >
            {showHidden ? t("balance.hiddenLess") : t("balance.hidden", { count: away.length })}
            <Icon name="hide" size={13} className="text-faint" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Named by the nav it was reached from, so the heading is left for the
          readers who cannot see that. */}
      <h1 className="sr-only">{t("page.balance.title")}</h1>

      {mounted && address && (
        <BalanceCard
          address={address}
          total={total}
          native={native}
          nativeValue={nativeValue}
          holdings={holdings}
          verifying={verifying}
        />
      )}

      <Panel label={t("balance.holdings")}>{body()}</Panel>

      <TokenSheet
        row={holdings.find((row) => row.address === openedToken)}
        onClose={() => setOpenedToken(undefined)}
        onSold={refetch}
      />
    </div>
  );
}
