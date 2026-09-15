"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { TokenTags } from "@/components/terminal/TokenPicker";
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
import { formatAmount, formatSigned, truncateAddress } from "@/lib/format";
import {
  formatCompactMoney,
  formatMoney,
  formatMoneyFloor,
  formatPriceMoney,
  type DisplayCurrency,
  type FxRate,
} from "@/lib/currency";
import type { Locale } from "@/lib/i18n";
import { memeSignal } from "@/lib/memecoin";
import { baseTokens, mergeTokens, type Token } from "@/lib/tokens";
import type { Holding } from "@/hooks/usePortfolio";
import { useAppStore } from "@/store/useAppStore";

/**
 * What a holding has to be proven worth to earn a row of its own. A dollar is
 * the line most wallets draw, and it is well clear of the fractions of a cent
 * an airdropped contract arrives with.
 */
const DUST_FLOOR = 1;

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
   * Dust, and what counts as it.
   *
   * A wallet on a memecoin chain collects contracts it never asked for, and
   * most of them are worth a fraction of a cent. Listed at the same weight as a
   * real position they bury it, so only holdings that clear a dollar get a row
   * and the rest fold into one line that opens on a tap. The bar is proof
   * rather than suspicion: something has to have priced a holding at a dollar
   * or more for it to be listed, which takes the unpriced with it — a token no
   * feed and no pool could value is not known to be worth anything.
   *
   * The coin is the exception, at any size. It is not one of the contracts this
   * is filtering, it is the balance the wallet is denominated in and the one
   * gas comes out of, and a reader who cannot see it cannot work out why a
   * trade will not sign.
   */
  const [showDust, setShowDust] = useState(false);

  const { visible, dust } = useMemo(() => {
    const visible: Holding[] = [];
    let dust = 0;
    for (const holding of holdings ?? []) {
      const listable =
        holding.token.native ||
        (holding.value !== undefined && holding.value >= DUST_FLOOR);
      if (!listable) dust += 1;
      if (listable || showDust) visible.push(holding);
    }
    return { visible, dust };
  }, [holdings, showDust]);

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
                <p className="mt-1.5 max-w-[34ch] text-[10px] leading-relaxed text-faint">
                  {t("assets.unpricedNote", { count: unpriced })}
                </p>
              )}
            </div>
            <p className="lbl shrink-0 whitespace-nowrap">
              {isFetching
                ? t("assets.reading")
                : t("assets.count", { count: visible.length })}
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
              {visible.map((holding) => (
                <HoldingRow
                  key={holding.token.address}
                  holding={holding}
                  listed={listed}
                  money={{ currency, fx, locale }}
                />
              ))}
              {dust > 0 && (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-left hover:bg-line/40"
                  onClick={() => setShowDust((open) => !open)}
                >
                  <span className="text-[11px] text-faint">
                    {showDust
                      ? t("assets.dustShown", { count: dust })
                      : t("assets.dustHidden", { count: dust })}
                  </span>
                  <span className="lbl shrink-0">
                    {showDust ? t("assets.dustHide") : t("assets.dustShow")}
                  </span>
                </button>
              )}
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

type Money = { currency: DisplayCurrency; fx: FxRate | undefined; locale: Locale };

/**
 * Dollars in the deepest pair below which a price is a rumour. A quote drawn
 * from a pool holding a few hundred dollars moves on a trade any reader could
 * make, so it describes that pool rather than the token.
 */
const THIN_LIQUIDITY = 1000;

/**
 * One holding, laid out the way a wallet lays one out.
 *
 * Each side of the row carries one thing per line. On the left the token names
 * itself and then says how much of it there is, with the unit attached — a bare
 * `0.000051` under a dollar figure is two magnitudes in two units with nothing
 * saying which is which, and a reader comparing it against their wallet reads
 * the wrong one. On the right the dollar value leads, because that is the line
 * they came to check, with what the token is worth per unit underneath it.
 *
 * That last line is where the chain shows through. For the chain's own money it
 * is a price: ether has one supply, everybody knows roughly what it is, and
 * $2,475 means something on its own. For everything else here — which is to say
 * the memecoins — price means nothing without the supply behind it, and the
 * supply is whatever the launch decided that morning. A token at $9 and a token
 * at $0.00007 are not expensive and cheap; they are two launches that picked
 * different numbers of zeros, and the only way to tell which is bigger is the
 * market cap. So that is what sits there instead.
 */
function HoldingRow({
  holding,
  listed,
  money,
}: {
  holding: Holding;
  listed: Set<string>;
  money: Money;
}) {
  const { t } = useI18n();

  /* The supply the pricing pass already read, which is also what the meme
     heuristic wants: a trillion whole units is the genre's own signature. */
  const token = { ...holding.token, totalSupply: holding.totalSupply };
  const signal = holding.token.native ? undefined : memeSignal(token, listed);
  const ownMoney = !signal || (!signal.unlisted && !signal.launchpad);

  /* A cap is worth naming for anything that is not the chain's own money —
     which on this chain is the memecoins, and they are what a cap is read
     for. It is a tooltip line now rather than a column. */
  const hasCap = !ownMoney && holding.marketCap !== undefined;

  /*
   * A price nothing corroborates. The feed aggregates every pair a token
   * trades in, so a figure from there stands on its own; an explorer's quote
   * and a lone pool's mid price do not, and neither does a feed price sitting
   * on a few hundred dollars of depth. The page still shows them — an
   * uncertain figure beats no figure on a wallet screen — and says out loud
   * that it is one, because the alternative is printing a ticker collision in
   * the same typeface as ether.
   */
  const unverified =
    holding.price !== undefined &&
    holding.priceSource !== "stable" &&
    (holding.priceSource !== "feed" ||
      holding.liquidity === undefined ||
      holding.liquidity < THIN_LIQUIDITY);

  /*
   * Everything the figure is standing on, said once where it can be checked. A
   * price with no depth behind it and no pool this app read is exactly the kind
   * that arrives from a ticker collision, and the reader deserves to know that
   * before they believe it.
   */
  const provenance = [
    holding.price !== undefined &&
      t("assets.priceHint", { price: formatPriceMoney(holding.price, money) }),
    hasCap &&
      t(holding.diluted ? "assets.fdvLine" : "assets.capLine", {
        value: formatCompactMoney(holding.marketCap, money),
      }),
    holding.priceSource === "feed"
      ? t("assets.sourceFeed")
      : holding.priceSource === "indexer"
        ? t("assets.sourceIndexer")
        : holding.priceSource === "pool"
          ? t("assets.sourcePool")
          : holding.priceSource === "stable"
            ? t("assets.sourceStable")
            : undefined,
    holding.liquidity !== undefined
      ? t("assets.depthHint", { value: formatCompactMoney(holding.liquidity, money) })
      : holding.price !== undefined && holding.priceSource !== "stable"
        ? t("assets.noDepthHint")
        : undefined,
    unverified && t("assets.unverifiedHint"),
    !holding.token.native && holding.token.address,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex items-center gap-3 border-t border-line px-3 py-2.5">
      {/* The ticker is not repeated here. It already appears twice on this row
          — once naming the token and once as the unit on the quantity — and a
          third copy in its own column was three identifiers for one asset. The
          one that stays is the one attached to the number, because that is the
          copy doing work. */}
      <div className="min-w-0 flex-1">
        {/*
         * The name, unadorned. The tags that used to sit here — unlisted, meme,
         * Pons — are 24px bordered pills against a 13px name, and on a chain
         * whose curated list is three addresses long, "unlisted" was true of
         * every row but one. A badge that never varies is not a signal, it is
         * furniture, and it was outweighing the thing it annotated. The picker
         * still carries all of them, which is where they decide something: a
         * reader holding a token has already made that choice.
         *
         * With no ticker column left to mark it, the coin's own row takes the
         * accent instead — it is the balance the wallet is denominated in, and
         * it should be findable among names that otherwise all look alike.
         */}
        <p
          className={`truncate text-[13px] ${
            holding.token.native ? "text-accent-text" : "text-dim"
          }`}
        >
          {holding.token.name}
        </p>
        {/* The quantity, and nothing else. It carries its own unit, because a
            bare number under a dollar figure is two magnitudes in two units
            with nothing saying which is which. What one unit costs, and the cap
            that price implies, are facts about the token rather than about this
            holding — they belong on the token's own screen, not competing with
            the balance on every row of a list. Both are still in the tooltip. */}
        <p className="num truncate text-[11px] text-faint" title={provenance || undefined}>
          {formatAmount(holding.amount, 5)} {holding.token.symbol}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {/* The doubt belongs against the figure it is about, not against the
            token's name, and it is one glyph rather than a pill. */}
        <p className="num flex items-center justify-end gap-1.5 text-[13px]">
          {unverified && (
            <span className="warn flex shrink-0" title={t("assets.unverifiedHint")}>
              <Icon name="alert" size={12} />
            </span>
          )}
          {holding.value !== undefined
            ? formatMoneyFloor(holding.value, money)
            : t("assets.unpriced")}
        </p>
        {/* Where the holding is going, under what it is worth. Only a market
            feed reports this: an explorer's quote and a pool's mid price are
            each a single reading with no yesterday to compare against, so a row
            says nothing here rather than guessing at a direction. */}
        <p
          className={`num text-[11px] ${
            holding.change24h === undefined
              ? "text-faint"
              : holding.change24h >= 0
                ? "long"
                : "short"
          }`}
          title={
            holding.change24h === undefined
              ? t("assets.changeUnknownHint")
              : t("assets.change24hHint")
          }
        >
          {holding.change24h === undefined ? "—" : formatSigned(holding.change24h)}
        </p>
      </div>
    </div>
  );
}
