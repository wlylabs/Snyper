"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, isAddress } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { Field } from "@/components/bots/fields";
import { TokenBadge, TokenTags } from "@/components/terminal/TokenPicker";
import { Flash } from "@/components/ui/Flash";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { readableError, useExecutor } from "@/hooks/useExecutor";
import { useI18n } from "@/hooks/useI18n";
import { usePairPrice } from "@/hooks/usePairPrice";
import { useQuote } from "@/hooks/useQuote";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useTokenList } from "@/hooks/useTokenList";
import { chainMeta, dexMeta, explorerAddress, hasRouting } from "@/lib/chains";
import {
  feeLabel,
  formatAmount,
  formatPercent,
  formatPrice,
  formatUnitsFixed,
  safeParseUnits,
  truncateAddress,
} from "@/lib/format";
import { memeSignal } from "@/lib/memecoin";
import { readPoolState, SNIPE_DEFAULTS } from "@/lib/snipe";
import { applySlippage } from "@/lib/swap";
import { SNIPE_TTL_MS } from "@/lib/strategies";
import { baseTokens, nativeToken, readToken, type Token } from "@/lib/tokens";
import type { Bot, Strategy } from "@/lib/types";
import { emptyRuntime, useAppStore } from "@/store/useAppStore";

type Mode = "buy" | "snipe";
type Funding = "native" | "stable";

type SnipeDraft = {
  takeProfitPct: string;
  cutLossPct: string;
  minLiquidityQuote: string;
  maxImpactPct: string;
  slippageBps: string;
};

const EMPTY_SNIPE: SnipeDraft = {
  takeProfitPct: String(SNIPE_DEFAULTS.takeProfitPct),
  cutLossPct: String(SNIPE_DEFAULTS.cutLossPct),
  minLiquidityQuote: String(SNIPE_DEFAULTS.minLiquidityQuote),
  maxImpactPct: String(SNIPE_DEFAULTS.maxImpactBps / 100),
  slippageBps: String(SNIPE_DEFAULTS.slippageBps),
};

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The paste-a-contract desk. One address is enough to read the token off the
 * chain, price it, and either buy it at the pool's current price or leave a
 * snipe armed for the moment a pool opens. Nothing here is custodial: the buy
 * is a transaction the wallet signs, and the snipe raises a signal that goes
 * through the same queue as every other strategy leg.
 */
export function ContractDesk() {
  const { t } = useI18n();
  const activeChainId = useChainId();
  const { chainId: accountChainId, isConnected } = useAccount();
  const chainId = accountChainId ?? activeChainId;
  const meta = chainMeta(chainId);
  const client = usePublicClient({ chainId });
  const { execute, phase } = useExecutor();
  const toast = useToast();

  const settings = useAppStore((state) => state.settings);
  const addBot = useAppStore((state) => state.addBot);
  const addCustomToken = useAppStore((state) => state.addCustomToken);
  const { listed } = useTokenList(chainId);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("buy");
  const [funding, setFunding] = useState<Funding>("native");
  const [amount, setAmount] = useState("");
  const [snipe, setSnipe] = useState<SnipeDraft>(EMPTY_SNIPE);
  const [error, setError] = useState<string>();
  const [armed, setArmed] = useState<string>();

  const trimmed = query.trim();
  const valid = isAddress(trimmed);

  /** Funding leg: the chain's own coin, or its USD unit. */
  const quoteToken = useMemo<Token | undefined>(() => {
    if (!chainId) return undefined;
    if (funding === "native") return nativeToken(chainId);
    const stable = dexMeta(chainId)?.stable;
    return baseTokens(chainId).find((token) => token.address === stable);
  }, [chainId, funding]);

  const tokenQuery = useQuery({
    queryKey: ["desk-token", chainId, trimmed.toLowerCase()],
    enabled: Boolean(client && chainId && valid),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      if (!client || !chainId) return null;
      return readToken(client, chainId, trimmed as `0x${string}`);
    },
  });

  const base = tokenQuery.data ?? undefined;
  const sameAsFunding =
    base && quoteToken && base.address.toLowerCase() === quoteToken.address.toLowerCase();

  const poolQuery = useQuery({
    queryKey: ["desk-pool", chainId, base?.address, quoteToken?.address],
    enabled: Boolean(client && base && quoteToken && !sameAsFunding),
    refetchInterval: 20_000,
    staleTime: 10_000,
    queryFn: async () => {
      if (!client || !base || !quoteToken) return null;
      return readPoolState(client, base, quoteToken);
    },
  });

  const poolState = poolQuery.data ?? undefined;
  const { price } = usePairPrice(
    sameAsFunding ? undefined : base,
    sameAsFunding ? undefined : quoteToken,
    20_000,
  );

  const presets =
    (funding === "native" ? settings.presetsNative : settings.presetsStable) ?? [];
  const { value: balance } = useTokenBalance(quoteToken);

  const amountIn = useMemo(
    () => (quoteToken ? safeParseUnits(amount, quoteToken.decimals) : undefined),
    [amount, quoteToken],
  );

  const quoteQuery = useQuote({
    tokenIn: quoteToken,
    tokenOut: base,
    amountIn,
    enabled: mode === "buy" && !sameAsFunding,
    refetchInterval: 15_000,
  });
  const routeQuote = quoteQuery.data ?? undefined;

  useEffect(() => {
    setError(undefined);
    setArmed(undefined);
  }, [trimmed, amount, mode, funding]);

  const signal = useMemo(() => {
    // Before the curated list has loaded, every address reads as unlisted —
    // which would flag a blue chip as an unknown contract.
    if (!base || !listed || listed.size === 0) return undefined;
    return memeSignal({ ...base, totalSupply: poolState?.totalSupply }, listed);
  }, [base, listed, poolState?.totalSupply]);

  const busy = phase !== "idle";
  const routable = hasRouting(chainId);

  const buyNow = async () => {
    if (!base || !quoteToken || !amountIn || !routeQuote) return;
    setError(undefined);
    try {
      await execute({
        tokenIn: quoteToken,
        tokenOut: base,
        amountIn,
        quote: routeQuote,
        slippageBps: settings.slippageBps,
        deadlineMinutes: settings.deadlineMinutes,
        source: "terminal",
      });
      // Anything bought here is worth keeping in the pickers and the portfolio.
      addCustomToken(base);
      setAmount("");
      void quoteQuery.refetch();
    } catch (cause) {
      const message = readableError(cause, t);
      setError(message);
      toast.push({ tone: "error", message: t("toast.executionStopped"), detail: message });
    }
  };

  const armSnipe = () => {
    if (!base || !quoteToken || !chainId) return;
    const size = num(amount);
    if (size <= 0) {
      setError(t("desk.errAmount"));
      return;
    }
    const now = Date.now();
    const strategy: Strategy = {
      kind: "snipe",
      amountQuote: size,
      minLiquidityQuote: Math.max(0, num(snipe.minLiquidityQuote)),
      maxImpactBps: Math.max(0, Math.round(num(snipe.maxImpactPct) * 100)),
      maxEntryPrice: 0,
      takeProfitPct: Math.max(0, num(snipe.takeProfitPct)),
      cutLossPct: Math.min(99, Math.max(0, num(snipe.cutLossPct))),
      expiresAt: now + SNIPE_TTL_MS,
    };

    const bot: Bot = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${base.symbol} ${t("strategy.snipeShort")}`,
      chainId,
      base,
      quote: quoteToken,
      strategy,
      slippageBps: Math.max(1, Math.min(2000, Math.round(num(snipe.slippageBps, 300)))),
      cooldownSec: 0,
      dailyCapQuote: 0,
      execution: "auto",
      // A snipe that had to be armed by hand afterwards would have missed.
      status: "armed",
      createdAt: now,
      runtime: { ...emptyRuntime(), stage: "waiting" },
    };

    addCustomToken(base);
    addBot(bot);
    setArmed(t("desk.armedNote", { symbol: base.symbol }));
    setAmount("");
  };

  const cta = (() => {
    if (!valid) return { label: t("desk.ctaPaste"), disabled: true };
    if (tokenQuery.isFetching) return { label: t("desk.reading"), disabled: true };
    if (!base) return { label: t("desk.notToken"), disabled: true };
    if (sameAsFunding) return { label: t("desk.ctaSameAsFunding"), disabled: true };
    if (!routable) {
      return {
        label: t("swap.ctaNoVenue", { chain: meta?.label ?? t("common.network") }),
        disabled: true,
      };
    }
    if (mode === "snipe") {
      if (!isConnected) return { label: t("swap.ctaConnect"), disabled: true };
      return { label: t("desk.ctaArm"), disabled: false, action: armSnipe };
    }
    if (!isConnected) return { label: t("swap.ctaConnect"), disabled: true };
    if (!amountIn || amountIn === 0n) return { label: t("swap.ctaAmount"), disabled: true };
    if (balance !== undefined && amountIn > balance) {
      return {
        label: t("swap.ctaInsufficient", { symbol: quoteToken?.symbol ?? "" }),
        disabled: true,
      };
    }
    if (quoteQuery.isFetching && !routeQuote) {
      return { label: t("swap.ctaPricing"), disabled: true };
    }
    if (!routeQuote) return { label: t("desk.ctaNoPoolYet"), disabled: true };
    if (phase === "approving") return { label: t("swap.ctaApproving"), disabled: true };
    if (phase === "signing") return { label: t("swap.ctaSigning"), disabled: true };
    if (phase === "pending") return { label: t("swap.ctaSettling"), disabled: true };
    return {
      label: t("desk.ctaBuy", { symbol: base.symbol }),
      disabled: false,
      action: buyNow,
    };
  })();

  const minOut =
    routeQuote && base
      ? formatUnitsFixed(
          applySlippage(routeQuote.amountOut, settings.slippageBps),
          base.decimals,
        )
      : "—";

  return (
    <Panel
      label={t("desk.title")}
      ticked
      meta={<span className="chip">{meta?.label ?? t("common.network")}</span>}
      bodyClassName="p-3"
    >
      <label className="relative block">
        <span className="sr-only">{t("desk.paste")}</span>
        <Icon
          name="crosshair"
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
        />
        <input
          className="field num pl-9"
          placeholder={t("desk.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
        />
      </label>

      {valid && tokenQuery.isError && (
        <p className="mt-2 text-[11px] short">{t("desk.notToken")}</p>
      )}

      {base && (
        <>
          <div className="mt-3 flex items-center gap-3 border border-line bg-base p-2.5">
            <TokenBadge token={base} size={30} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold">{base.symbol}</span>
                <TokenTags
                  token={{ ...base, totalSupply: poolState?.totalSupply }}
                  listed={listed}
                />
              </span>
              <span className="block truncate text-[11px] text-faint">{base.name}</span>
            </span>
            <a
              href={chainId ? explorerAddress(chainId, base.address) : undefined}
              target="_blank"
              rel="noreferrer"
              className="num shrink-0 text-[10px] text-faint hover:text-accent-text"
            >
              {truncateAddress(base.address, 6, 4)}
            </a>
          </div>

          {signal?.unlisted && (
            <p className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed warn">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              {t("token.unlistedRisk")}
            </p>
          )}

          <div className="mt-3">
            <p className="lbl mb-2">{t("desk.fund")}</p>
            <Segmented
              options={[
                { value: "native" as const, label: nativeToken(chainId)?.symbol ?? "NATIVE" },
                {
                  value: "stable" as const,
                  label: dexMeta(chainId)?.stableSymbol ?? "USD",
                },
              ]}
              value={funding}
              onChange={setFunding}
              className="w-full"
            />
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="lbl">{t("desk.amount", { symbol: quoteToken?.symbol ?? "" })}</span>
              <span className="num text-[10px] text-faint">
                {quoteToken && balance !== undefined
                  ? `${formatUnitsFixed(balance, quoteToken.decimals)} ${quoteToken.symbol}`
                  : "—"}
              </span>
            </div>
            <input
              className="field num"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="chip transition-colors hover:text-ink"
                  onClick={() => setAmount(String(preset))}
                >
                  {preset} {quoteToken?.symbol ?? ""}
                </button>
              ))}
              {balance !== undefined && balance > 0n && quoteToken && (
                <button
                  type="button"
                  className="chip transition-colors hover:text-ink"
                  onClick={() => {
                    // Native funding keeps a slice back so gas can still be paid.
                    const usable = quoteToken.native ? (balance * 90n) / 100n : balance;
                    setAmount(formatUnits(usable, quoteToken.decimals));
                  }}
                >
                  {t("swap.max")}
                </button>
              )}
            </div>
          </div>

          <div className="mt-3">
            <Segmented
              options={[
                { value: "buy" as const, label: t("desk.modeBuy") },
                { value: "snipe" as const, label: t("desk.modeSnipe") },
              ]}
              value={mode}
              onChange={setMode}
              className="w-full"
            />
          </div>

          <div className="mt-3">
            <Row
              k={t("desk.pool")}
              v={
                poolQuery.isFetching && !poolState
                  ? t("composer.reading")
                  : poolState?.pool
                    ? `v3 ${feeLabel(poolState.pool.fee)}`
                    : t("desk.noPool")
              }
              tone={poolState?.pool ? undefined : "warn"}
            />
            <Row
              k={t("desk.depth", { symbol: quoteToken?.symbol ?? "" })}
              v={poolState?.depth !== undefined ? formatAmount(poolState.depth, 2) : "—"}
            />
            <Row
              k={t("desk.price")}
              v={
                <Flash value={price}>
                  {price !== undefined
                    ? `${formatPrice(price)} ${quoteToken?.symbol ?? ""}`
                    : "—"}
                </Flash>
              }
            />
            {mode === "buy" && (
              <>
                <Row
                  k={t("desk.receive")}
                  v={
                    routeQuote
                      ? `${formatUnitsFixed(routeQuote.amountOut, base.decimals)} ${base.symbol}`
                      : "—"
                  }
                />
                <Row
                  k={t("swap.priceImpact")}
                  v={routeQuote ? formatPercent(routeQuote.priceImpact) : "—"}
                  tone={routeQuote && routeQuote.priceImpact > 0.02 ? "short" : undefined}
                />
                <Row k={t("swap.minReceived")} v={`${minOut} ${base.symbol}`} />
              </>
            )}
          </div>

          {mode === "snipe" && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={t("desk.takeProfit")}
                  value={snipe.takeProfitPct}
                  onChange={(value) => setSnipe((d) => ({ ...d, takeProfitPct: value }))}
                />
                <Field
                  label={t("desk.cutLoss")}
                  value={snipe.cutLossPct}
                  onChange={(value) => setSnipe((d) => ({ ...d, cutLossPct: value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={t("desk.minLiquidity", { symbol: quoteToken?.symbol ?? "" })}
                  value={snipe.minLiquidityQuote}
                  onChange={(value) =>
                    setSnipe((d) => ({ ...d, minLiquidityQuote: value }))
                  }
                />
                <Field
                  label={t("desk.maxImpact")}
                  value={snipe.maxImpactPct}
                  onChange={(value) => setSnipe((d) => ({ ...d, maxImpactPct: value }))}
                />
              </div>
              <Field
                label={t("desk.slippage")}
                value={snipe.slippageBps}
                onChange={(value) => setSnipe((d) => ({ ...d, slippageBps: value }))}
              />
            </div>
          )}

          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            {mode === "snipe" ? t("desk.snipeNote") : t("desk.buyNote")}
          </p>

          {error && <p className="wrap-any mt-2 text-[11px] leading-relaxed short">{error}</p>}
          {armed && <p className="mt-2 text-[11px] leading-relaxed long">{armed}</p>}

          <button
            type="button"
            className="btn btn-accent btn-block mt-3"
            disabled={cta.disabled || busy}
            onClick={cta.action}
          >
            {cta.label}
          </button>
        </>
      )}

      {!base && !valid && (
        <p className="mt-3 text-[11px] leading-relaxed text-faint">{t("desk.hint")}</p>
      )}
    </Panel>
  );
}
