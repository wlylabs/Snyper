"use client";

import { useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
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
import { chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { formatMoney } from "@/lib/currency";
import { baseTokens, mergeTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

export default function AssetsPage() {
  const mounted = useMounted();
  const { t, locale } = useI18n();
  const currency = useAppStore((state) => state.settings.currency);
  const { fx } = useFxRate();
  const activeChainId = useChainId();
  const { address, chainId: accountChainId } = useAccount();
  const connectPrompt = useConnectPrompt();
  const chainId = accountChainId ?? activeChainId;
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

  const { data: holdings, isFetching, refetch } = usePortfolio(chainId, scope);

  const total = useMemo(
    () => (holdings ?? []).reduce((sum, holding) => sum + (holding.value ?? 0), 0),
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
          meta={<span className="chip">{meta?.label ?? t("common.network")}</span>}
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
              hint={t("assets.emptyHint")}
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
                href={chainId ? explorerAddress(chainId, address) : undefined}
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
                    href={chainId ? explorerAddress(chainId, token.address) : undefined}
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
