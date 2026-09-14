"use client";

import { useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { TokenBadge } from "@/components/terminal/TokenPicker";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Skeleton } from "@/components/ui/Panel";
import { useMounted } from "@/hooks/useMounted";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTokenList } from "@/hooks/useTokenList";
import { chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, formatPrice, formatUsd, truncateAddress } from "@/lib/format";
import { baseTokens, mergeTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

export default function AssetsPage() {
  const mounted = useMounted();
  const activeChainId = useChainId();
  const { address, chainId: accountChainId } = useAccount();
  const chainId = accountChainId ?? activeChainId;
  const meta = chainMeta(chainId);

  const { tokens: listTokens } = useTokenList(chainId);
  const customTokens = useAppStore((state) => state.customTokens);
  const bots = useAppStore((state) => state.bots);
  const trades = useAppStore((state) => state.trades);
  const [deepScan, setDeepScan] = useState(false);

  /** Default scope stays small: held defaults, imports and anything traded. */
  const scope = useMemo<Token[]>(() => {
    if (!chainId) return [];
    const touched: Token[] = [];
    for (const bot of bots) {
      if (bot.chainId === chainId) touched.push(bot.base, bot.quote);
    }
    for (const trade of trades) {
      if (trade.chainId !== chainId) continue;
      if (trade.tokenIn) touched.push(trade.tokenIn);
      if (trade.tokenOut) touched.push(trade.tokenOut);
    }
    const core = mergeTokens(chainId, baseTokens(chainId), customTokens, touched);
    return deepScan ? mergeTokens(chainId, core, listTokens) : core;
  }, [chainId, bots, trades, customTokens, deepScan, listTokens]);

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
      <div className="lg:col-span-8">
        <Panel
          label="Holdings"
          ticked
          meta={<span className="chip">{meta?.label ?? "Network"}</span>}
          action={
            <button
              type="button"
              className="icon-btn"
              onClick={() => void refetch()}
              aria-label="Refresh balances"
            >
              <Icon name="refresh" size={14} />
            </button>
          }
          bodyClassName="p-0"
        >
          <div className="flex items-end justify-between gap-4 p-3">
            <div>
              <p className="lbl mb-1.5">Priced value</p>
              <p className="num text-[30px] leading-none">
                {address ? formatUsd(total) : "—"}
              </p>
            </div>
            <p className="lbl">
              {isFetching ? "Reading chain…" : `${holdings?.length ?? 0} assets`}
            </p>
          </div>

          {!address ? (
            <Empty
              title="Wallet not connected"
              hint="Balances are read from the chain for the connected address only."
            />
          ) : (holdings?.length ?? 0) === 0 ? (
            <Empty
              title={isFetching ? "Scanning balances…" : "No balances in scope"}
              hint="Scope covers your defaults, imported tokens and anything you have traded here. Run a deep scan to sweep the full Uniswap list."
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
                    <p className="text-[13px] font-semibold">{holding.token.symbol}</p>
                    <p className="truncate text-[11px] text-faint">
                      {holding.price !== undefined
                        ? `${formatPrice(holding.price)} ${meta?.stableSymbol ?? ""}`
                        : holding.token.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-[13px]">{formatAmount(holding.amount, 5)}</p>
                    <p className="num text-[11px] text-faint">
                      {holding.value !== undefined ? formatUsd(holding.value) : "unpriced"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-line p-3">
            <button
              type="button"
              className="btn btn-sm w-full"
              onClick={() => setDeepScan((value) => !value)}
              disabled={!address}
            >
              <Icon name="search" size={13} />
              {deepScan ? "Deep scan on — tap to narrow" : "Deep scan full token list"}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-faint">
              A deep scan multicalls every listed token on this chain. It is heavier on your
              RPC endpoint and off by default.
            </p>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-3 lg:col-span-4">
        <Panel label="Address" bodyClassName="p-3">
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
                Open in explorer
              </a>
            </>
          ) : (
            <p className="text-[11px] text-faint">Connect a wallet to read balances.</p>
          )}
        </Panel>

        <Panel label="Imported tokens" bodyClassName="p-0">
          {customTokens.filter((token) => token.chainId === chainId).length === 0 ? (
            <Empty title="None imported" hint="Paste a contract address in any asset picker to add one." />
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
