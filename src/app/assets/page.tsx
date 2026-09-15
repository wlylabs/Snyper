"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { TokenTags } from "@/components/terminal/TokenPicker";
import { TokenBadge } from "@/components/ui/TokenBadge";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Skeleton } from "@/components/ui/Panel";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useMounted } from "@/hooks/useMounted";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTokenList } from "@/hooks/useTokenList";
import { useTokenDiscovery } from "@/hooks/useTokenDiscovery";
import { useI18n } from "@/hooks/useI18n";
import { useFxRate } from "@/hooks/useFxRate";
import { CHAIN_ID, chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { formatMoney } from "@/lib/currency";
import { baseTokens, mergeTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

export default function AssetsPage() {
  const mounted = useMounted();
  const { t, locale } = useI18n();
  const currency = useAppStore((state) => state.settings.currency);
  const { fx } = useFxRate();
  const { address } = useAccount();
  const connectPrompt = useConnectPrompt();
  /*
   * Holdings are read over the app's own RPC, so they do not depend on which
   * network the wallet happens to have selected. Following the wallet's chain
   * instead would empty this page the moment a reader left it on another
   * network — the tokens are still there, and this is the page that says so.
   * Switching networks is the header's job, and only signing needs it.
   */
  const chainId = CHAIN_ID;
  const meta = chainMeta(chainId);

  const { listed } = useTokenList(chainId);
  const customTokens = useAppStore((state) => state.customTokens);
  const discoveredTokens = useAppStore((state) => state.discoveredTokens);
  const snypes = useAppStore((state) => state.snypes);
  const trades = useAppStore((state) => state.trades);
  const venueKey = useAppStore((state) => state.venueKey);
  const discovery = useTokenDiscovery(chainId);

  /** Everything worth reading a balance for: money, imports, anything traded. */
  const scope = useMemo<Token[]>(() => {
    if (!chainId) return [];
    const touched: Token[] = [];
    for (const snype of snypes) {
      if (snype.chainId === chainId) touched.push(snype.base, snype.quote);
    }
    for (const trade of trades) {
      if (trade.chainId !== chainId) continue;
      if (trade.tokenIn) touched.push(trade.tokenIn);
      if (trade.tokenOut) touched.push(trade.tokenOut);
    }
    return mergeTokens(chainId, baseTokens(chainId), customTokens, discoveredTokens, touched);
  }, [chainId, snypes, trades, customTokens, discoveredTokens, venueKey]);

  const { data: portfolio, isFetching, refetch } = usePortfolio(chainId, scope);
  const holdings = portfolio?.holdings;
  /*
   * The indexer answers with everything the address holds; the chain can only
   * answer for tokens the app already knew to name. When the second one is what
   * happened, the list is a subset and says so rather than passing itself off
   * as the wallet.
   */
  const scopeOnly = Boolean(portfolio && portfolio.source === "chain");

  const total = useMemo(
    () => (holdings ?? []).reduce((sum, holding) => sum + (holding.value ?? 0), 0),
    [holdings],
  );

  /*
   * What the total leaves out. A token with no route to the chain's USD unit
   * has no price to add, so it counts as nothing here — which is the honest
   * arithmetic and a poor thing to leave unsaid, because the figure then reads
   * as the whole wallet to anyone comparing it against one.
   */
  const unpriced = useMemo(
    () => (holdings ?? []).filter((holding) => holding.value === undefined).length,
    [holdings],
  );

  if (!mounted) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
        <Panel
          label={t("assets.holdings")}
          ticked
          meta={
            <>
              {scopeOnly && (
                <span className="chip" title={t("assets.scopeOnlyHint")}>
                  {t("assets.scopeOnly")}
                </span>
              )}
              <span className="chip">{meta?.label ?? t("common.network")}</span>
            </>
          }
          action={
            <button
              type="button"
              className="icon-btn"
              onClick={() => void refetch()}
              aria-label={t("assets.refresh")}
            >
              <Icon name="refresh" size={14} />
            </button>
          }
          bodyClassName="p-0"
        >
          <div className="flex items-end justify-between gap-4 p-3">
            <div>
              <p className="lbl mb-1.5">{t("assets.pricedValue")}</p>
              <p className="num text-[30px] leading-none">
                {address ? formatMoney(total, { currency, fx, locale }) : "—"}
              </p>
              {address && unpriced > 0 && (
                <p className="mt-1.5 max-w-[42ch] text-[10px] leading-relaxed text-faint">
                  {t("assets.unpricedNote", { count: unpriced })}
                </p>
              )}
            </div>
            <p className="lbl">
              {isFetching
                ? t("assets.reading")
                : t("assets.count", { count: holdings?.length ?? 0 })}
            </p>
          </div>

          {!address ? (
            <Empty
              title={t("assets.noWallet")}
              hint={t("assets.noWalletHint")}
              /* Nothing to list until a wallet is connected, so offer that here
                 rather than sending the reader back up to the header. */
              action={
                connectPrompt && (
                  <button type="button" className="btn btn-accent btn-sm" onClick={connectPrompt}>
                    <Icon name="wallet" size={13} />
                    {t("wallet.connect")}
                  </button>
                )
              }
            />
          ) : (holdings?.length ?? 0) === 0 ? (
            <Empty
              title={isFetching ? t("assets.scanning") : t("assets.emptyTitle")}
              hint={scopeOnly ? t("assets.scopeOnlyHint") : t("assets.emptyHint")}
            />
          ) : (
            <div>
              {holdings?.map((holding) => (
                <div
                  key={holding.token.address}
                  className="flex items-center gap-3 border-t border-line px-3 py-2.5"
                >
                  <TokenBadge token={holding.token} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <span className="truncate">{holding.token.symbol}</span>
                      <TokenTags token={holding.token} listed={listed} />
                    </p>
                    <p className="truncate text-[11px] text-faint">
                      {holding.price !== undefined
                        ? formatMoney(holding.price, { currency, fx, locale })
                        : holding.token.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-[13px]">{formatAmount(holding.amount, 5)}</p>
                    <p className="num text-[11px] text-faint">
                      {holding.value !== undefined
                        ? formatMoney(holding.value, { currency, fx, locale })
                        : t("assets.unpriced")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-line p-3">
            <button
              type="button"
              className="btn btn-accent btn-sm w-full"
              onClick={() => void discovery.scan()}
              disabled={!discovery.canScan || discovery.isScanning}
            >
              <Icon name="crosshair" size={13} />
              {discovery.isScanning ? t("assets.detecting") : t("assets.detect")}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-faint">
              {t("assets.detectNote")}
            </p>
            {discovery.found && (
              <p className="mt-2 text-[10px] leading-relaxed text-dim">
                {t("assets.detectResult", {
                  count: discovery.found.length,
                  blocks: discovery.scannedBlocks ?? 0,
                })}
                {discovery.partial ? ` ${t("assets.detectPartial")}` : ""}
              </p>
            )}
            {discovery.error && (
              <p className="wrap-any mt-2 text-[10px] leading-relaxed short">
                {discovery.error}
              </p>
            )}

          </div>
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
        <Panel label={t("assets.address")} bodyClassName="p-3">
          {address ? (
            <>
              <p className="num text-[12px] break-all">{address}</p>
              <a
                href={explorerAddress(chainId, address)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm mt-3 w-full"
              >
                <Icon name="external" size={13} />
                {t("assets.openExplorer")}
              </a>
            </>
          ) : (
            <p className="text-[11px] text-faint">{t("assets.connectHint")}</p>
          )}
        </Panel>

        <Panel label={t("assets.detected")} bodyClassName="p-0">
          {discoveredTokens.filter((token) => token.chainId === chainId).length === 0 ? (
            <Empty title={t("assets.noneDetected")} hint={t("assets.noneDetectedHint")} />
          ) : (
            discoveredTokens
              .filter((token) => token.chainId === chainId)
              .map((token) => (
                <div
                  key={token.address}
                  className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12px] font-semibold">{token.symbol}</span>
                    <TokenTags token={token} listed={listed} />
                  </span>
                  <a
                    href={explorerAddress(chainId, token.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="num shrink-0 text-[10px] text-faint hover:text-accent-text"
                  >
                    {truncateAddress(token.address, 6, 4)}
                  </a>
                </div>
              ))
          )}
        </Panel>

        <Panel label={t("assets.imported")} bodyClassName="p-0">
          {customTokens.filter((token) => token.chainId === chainId).length === 0 ? (
            <Empty
              title={t("assets.noneImported")}
              hint={t("assets.noneImportedHint")}
            />
          ) : (
            customTokens
              .filter((token) => token.chainId === chainId)
              .map((token) => (
                <div
                  key={token.address}
                  className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-b-0"
                >
                  <span className="text-[12px] font-semibold">{token.symbol}</span>
                  <span className="num text-[10px] text-faint">
                    {truncateAddress(token.address, 6, 4)}
                  </span>
                </div>
              ))
          )}
        </Panel>
      </div>
    </div>
  );
}
