"use client";

import { useMemo, useState } from "react";
import { isAddress } from "viem";
import { usePublicClient } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { formatCompactMoney } from "@/lib/currency";
import { formatSigned, truncateAddress } from "@/lib/format";
import { memeSignal } from "@/lib/memecoin";
import type { PonsLaunch } from "@/lib/pons";
import { readToken, searchTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";
import { useDiscoverTokens, type DiscoverToken } from "@/hooks/useDiscoverTokens";
import { useFxRate } from "@/hooks/useFxRate";
import { useI18n } from "@/hooks/useI18n";

/** Discovered rows shown at once. The search box reaches the rest. */
const MAX_DISCOVER_ROWS = 40;

export function TokenPicker({
  open,
  onClose,
  tokens,
  chainId,
  onSelect,
  excludeAddress,
  title,
  listed,
}: {
  open: boolean;
  onClose: () => void;
  tokens: Token[];
  chainId?: number;
  onSelect: (token: Token) => void;
  excludeAddress?: string;
  title?: string;
  /** Curated-list addresses; anything outside them is tagged in the row. */
  listed?: Set<string>;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const client = usePublicClient({ chainId });
  const addCustomToken = useAppStore((state) => state.addCustomToken);
  const currency = useAppStore((state) => state.settings.currency);
  const { fx } = useFxRate();

  /*
   * Only asked while the sheet is open. This reads a market feed and walks the
   * launchpad's logs, and neither is worth doing for a picker nobody opened.
   */
  const discover = useDiscoverTokens(open ? chainId : undefined);

  const results = useMemo(() => {
    const filtered = tokens.filter(
      (token) => token.address.toLowerCase() !== excludeAddress?.toLowerCase(),
    );
    return searchTokens(filtered, query).slice(0, 120);
  }, [tokens, query, excludeAddress]);

  /*
   * What the chain has that the app does not carry yet. Anything already in the
   * list above is dropped rather than shown twice — a token the reader has
   * imported is theirs, and its row belongs with the others.
   */
  const discovered = useMemo(() => {
    const held = new Set(tokens.map((token) => token.address.toLowerCase()));
    if (excludeAddress) held.add(excludeAddress.toLowerCase());
    const candidates = (discover.data?.tokens ?? []).filter(
      (token) => !held.has(token.address.toLowerCase()),
    );
    return searchTokens(candidates, query).slice(0, MAX_DISCOVER_ROWS) as DiscoverToken[];
  }, [discover.data, tokens, query, excludeAddress]);

  /* A pasted address the chain has never heard of is still importable by hand. */
  const canImport =
    isAddress(query.trim()) &&
    results.length === 0 &&
    discovered.length === 0 &&
    Boolean(client) &&
    Boolean(chainId);

  const empty = results.length === 0 && discovered.length === 0;

  const take = (token: Token) => {
    onSelect(token);
    onClose();
    setQuery("");
  };

  /*
   * Picking a discovered token is an import: it joins the reader's own list and
   * survives the next reload. Only the token's identity is kept — the market
   * reading and the launchpad record around it are a snapshot of one minute,
   * and storing them would age into a lie the picker keeps repeating.
   */
  const takeDiscovered = (token: DiscoverToken) => {
    const plain: Token = {
      chainId: token.chainId,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
    };
    addCustomToken(plain);
    take(plain);
  };

  const importToken = async () => {
    if (!client || !chainId) return;
    setImporting(true);
    setImportError(undefined);
    try {
      const token = await readToken(client, chainId, query.trim() as `0x${string}`);
      addCustomToken(token);
      onSelect(token);
      setQuery("");
      onClose();
    } catch {
      setImportError(t("token.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Sheet open={open} title={title ?? t("token.select")} onClose={onClose}>
      <div className="border-b border-line p-3">
        <label className="relative block">
          <span className="sr-only">{t("token.searchLabel")}</span>
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <input
            className="field pl-9"
            placeholder={t("token.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="max-h-[52vh] overflow-y-auto scroll-thin md:max-h-none">
        {results.map((token) => (
          <button
            key={token.address}
            type="button"
            className="row-link flex w-full items-center gap-3 border-b border-line px-3 py-2.5"
            onClick={() => take(token)}
          >
            <span className="ticker" data-native={token.native ? "true" : undefined}>
              {token.symbol}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span className="truncate text-[12px] text-dim">{token.name}</span>
              <TokenTags token={token} listed={listed} />
            </span>
            <span className="num text-[10px] text-faint">
              {token.native ? t("token.native") : truncateAddress(token.address, 6, 4)}
            </span>
          </button>
        ))}

        {/*
         * Everything below this line is on the chain but not in the app's list.
         * The heading says so plainly: these rows were not vetted by anyone,
         * they were found — by an indexer that knows what trades, and by the
         * launchpad's own record of what it minted.
         */}
        {discovered.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-b border-line bg-line/20 px-3 py-1.5">
            <span className="lbl">{t("token.discovered")}</span>
            <span className="num text-[10px] text-faint">
              {t("token.discoveredCount", { count: discovered.length })}
            </span>
          </div>
        )}

        {discovered.map((token) => (
          <button
            key={token.address}
            type="button"
            className="row-link flex w-full items-center gap-3 border-b border-line px-3 py-2.5"
            onClick={() => takeDiscovered(token)}
          >
            <span className="ticker">{token.symbol}</span>
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
              <span className="flex min-w-0 max-w-full items-center gap-1.5">
                <span className="truncate text-[12px] text-dim">{token.name}</span>
                <TokenTags token={token} listed={listed} launch={token.launch} />
              </span>
              <span className="num text-[10px] text-faint">
                {truncateAddress(token.address, 6, 4)}
              </span>
            </span>
            <DiscoverStat token={token} money={{ currency, fx, locale }} />
          </button>
        ))}

        {empty && (
          <div className="p-4">
            {canImport ? (
              <div className="panel p-3">
                <p className="text-xs text-dim">{t("token.unlisted")}</p>
                <p className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed warn">
                  <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                  {t("token.unlistedRisk")}
                </p>
                <button
                  type="button"
                  className="btn btn-sm mt-3 w-full"
                  data-run={importing ? "true" : undefined}
                  onClick={importToken}
                  disabled={importing}
                >
                  {importing ? t("token.importing") : t("token.import")}
                </button>
                {importError && <p className="mt-2 text-[11px] short">{importError}</p>}
              </div>
            ) : (
              <p className="text-center text-xs text-faint">
                {discover.isFetching
                  ? t("token.discovering")
                  : query
                    ? t("token.noMatch")
                    : t("token.noneAvailable")}
              </p>
            )}
          </div>
        )}
      </div>

      {/*
       * The footer states what the list is and is not. A reader who opens this
       * and sees forty rows where there used to be three is owed the reason:
       * nothing here was curated, the scan reaches back only so far, and a
       * quiet feed means the traded half of the list is missing entirely.
       */}
      {chainId && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
          <p className="text-[10px] leading-relaxed text-faint">
            {discover.isFetching
              ? t("token.discovering")
              : discover.data?.marketEmpty
                ? t("token.discoverChainOnly")
                : t("token.discoverNote")}
            {discover.data?.partial ? ` ${t("token.discoverPartial")}` : ""}
          </p>
          <button
            type="button"
            className="btn btn-sm shrink-0"
            onClick={() => void discover.refetch()}
            disabled={discover.isFetching}
            aria-label={t("common.refresh")}
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * The one number a discovered row is worth carrying.
 *
 * Depth, not price: a price is market cap divided by a supply each launch picks
 * arbitrarily, so it ranks nothing, while the dollars in a token's deepest pair
 * say how much of it can actually be bought. A launch with no pool yet has no
 * depth at all, and says that rather than printing a zero — on this chain being
 * minutes old is the whole attraction, not a defect.
 */
function DiscoverStat({
  token,
  money,
}: {
  token: DiscoverToken;
  money: Parameters<typeof formatCompactMoney>[1];
}) {
  const { t } = useI18n();
  const depth = token.market?.liquidityUsd;
  const change = token.market?.change24h;

  if (depth === undefined) {
    return (
      <span className="lbl shrink-0 text-faint" title={t("token.discoverFreshHint")}>
        {t("token.discoverFresh")}
      </span>
    );
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <span className="num text-[11px]" title={t("token.discoverDepthHint")}>
        {formatCompactMoney(depth, money)}
      </span>
      <span
        className={`num text-[10px] ${
          change === undefined ? "text-faint" : change >= 0 ? "long" : "short"
        }`}
      >
        {change === undefined ? "—" : formatSigned(change)}
      </span>
    </span>
  );
}

/**
 * Flags anything that is not one of the chain's own assets. A memecoin is the
 * usual reason one shows up here, so the label says so — as a reading, never as
 * a safety judgement. A launchpad record turns the reading into a fact.
 */
export function TokenTags({
  token,
  listed,
  launch,
}: {
  token: Token & { totalSupply?: bigint };
  listed?: Set<string>;
  launch?: PonsLaunch;
}) {
  const { t } = useI18n();
  if (!listed || token.native) return null;

  const signal = memeSignal(token, listed, launch);
  if (!signal.unlisted && !signal.launchpad) return null;

  return (
    <span
      className={`chip chip-xs ${signal.meme ? "chip-warn" : ""}`}
      title={signal.reasons.map((reason) => t(reason)).join(" · ")}
    >
      {signal.launchpad
        ? t("meme.tagPons")
        : signal.meme
          ? t("meme.tagMeme")
          : t("meme.tagUnlisted")}
    </span>
  );
}
