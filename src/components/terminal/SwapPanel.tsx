"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { readableError, useExecutor } from "@/hooks/useExecutor";
import { useQuote } from "@/hooks/useQuote";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useVenue, useVenueDiscovery, useVenueFromToken } from "@/hooks/useVenue";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { chainMeta, isSupportedChain } from "@/lib/chains";
import {
  feeLabel,
  formatPercent,
  formatPrice,
  formatUnitsFixed,
  safeParseUnits,
} from "@/lib/format";
import { applySlippage } from "@/lib/swap";
import type { Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";
import { useI18n } from "@/hooks/useI18n";
import { TokenPicker } from "./TokenPicker";
import { TokenBadge } from "@/components/ui/TokenBadge";

const SLIPPAGE_PRESETS = [10, 50, 100];

/** Digits plus at most one decimal separator. */
function sanitiseAmount(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

export function SwapPanel({
  tokens,
  listed,
  tokenIn,
  tokenOut,
  onTokenIn,
  onTokenOut,
  onSwitch,
}: {
  tokens: Token[];
  listed?: Set<string>;
  tokenIn?: Token;
  tokenOut?: Token;
  onTokenIn: (token: Token) => void;
  onTokenOut: (token: Token) => void;
  onSwitch: () => void;
}) {
  const { isConnected, chainId } = useAccount();
  const activeChainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { execute, phase } = useExecutor();
  const toast = useToast();
  const { t } = useI18n();
  // The execute button is where a reader without a wallet actually stands.
  const connectPrompt = useConnectPrompt();
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  // Reading the venue through the hook is what re-renders this panel the moment
  // one resolves; the module mirror alone would leave the no-venue notice up.
  const { hasRouting: venueResolved } = useVenue();
  const { isResolving: venueResolving, retry: retryVenue } = useVenueDiscovery();
  // An imported contract can resolve the venue itself, same as the paste desk.
  // Either leg may be the pasted one, so the first non-native side is probed.
  useVenueFromToken([tokenOut, tokenIn].find((token) => token && !token.native)?.address);

  const [amount, setAmount] = useState("");
  const [picker, setPicker] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string>();

  const amountIn = useMemo(
    () => (tokenIn ? safeParseUnits(amount, tokenIn.decimals) : undefined),
    [amount, tokenIn],
  );

  const { value: balanceIn, refetch: refetchIn } = useTokenBalance(tokenIn);
  const { value: balanceOut, refetch: refetchOut } = useTokenBalance(tokenOut);

  const quoteQuery = useQuote({
    tokenIn,
    tokenOut,
    amountIn,
    refetchInterval: 15_000,
  });
  const quote = quoteQuery.data;

  // Before a wallet is connected the config's active chain is the one on show.
  const pairChainId = tokenIn?.chainId ?? chainId ?? activeChainId;
  /**
   * Without a resolved Uniswap venue nothing prices or executes — except a Pons
   * bonding curve, which settles trades itself with no router in front of it.
   */
  const routable =
    (venueResolved && isSupportedChain(pairChainId)) || quote?.venue === "curve";
  const pairChainLabel = chainMeta(pairChainId)?.label ?? t("common.network");
  const wrongNetwork = isConnected && tokenIn && chainId !== tokenIn.chainId;
  const insufficient = Boolean(amountIn && balanceIn !== undefined && amountIn > balanceIn);
  const busy = phase !== "idle";

  const minReceived =
    quote && tokenOut
      ? formatUnitsFixed(applySlippage(quote.amountOut, settings.slippageBps), tokenOut.decimals)
      : "—";

  useEffect(() => {
    setError(undefined);
  }, [amount, tokenIn, tokenOut]);

  const setFraction = (fraction: number) => {
    if (balanceIn === undefined || !tokenIn) return;
    // Native inputs keep a gas buffer so the swap can still be mined.
    const usable = tokenIn.native ? (balanceIn * 97n) / 100n : balanceIn;
    const value = (usable * BigInt(Math.round(fraction * 1000))) / 1000n;
    setAmount(formatUnits(value, tokenIn.decimals));
  };

  const submit = async () => {
    if (!tokenIn || !tokenOut || !amountIn || !quote) return;
    setError(undefined);
    try {
      await execute({
        tokenIn,
        tokenOut,
        amountIn,
        quote,
        slippageBps: settings.slippageBps,
        deadlineMinutes: settings.deadlineMinutes,
        source: "terminal",
      });
      setAmount("");
      void refetchIn();
      void refetchOut();
      void quoteQuery.refetch();
    } catch (cause) {
      const message = readableError(cause, t);
      setError(message);
      toast.push({ tone: "error", message: t("toast.executionStopped"), detail: message });
    }
  };

  const cta = (() => {
    if (!isConnected) {
      return connectPrompt
        ? { label: t("swap.ctaConnectAction"), disabled: false, action: connectPrompt }
        : { label: t("swap.ctaConnect"), disabled: true };
    }
    if (wrongNetwork) {
      const meta = chainMeta(tokenIn?.chainId);
      return {
        label: t("swap.ctaSwitch", { chain: meta?.label ?? t("common.network") }),
        disabled: false,
        action: () => tokenIn && switchChain({ chainId: tokenIn.chainId }),
      };
    }
    if (!routable) {
      return { label: t("swap.ctaNoVenue", { chain: pairChainLabel }), disabled: true };
    }
    if (!amountIn || amountIn === 0n) return { label: t("swap.ctaAmount"), disabled: true };
    if (insufficient) {
      return { label: t("swap.ctaInsufficient", { symbol: tokenIn?.symbol ?? "" }), disabled: true };
    }
    if (quoteQuery.isFetching && !quote) return { label: t("swap.ctaPricing"), disabled: true };
    if (!quote) return { label: t("swap.ctaNoRoute"), disabled: true };
    if (phase === "approving") return { label: t("swap.ctaApproving"), disabled: true };
    if (phase === "signing") return { label: t("swap.ctaSigning"), disabled: true };
    if (phase === "pending") return { label: t("swap.ctaSettling"), disabled: true };
    return {
      label: t("swap.ctaSwap", { from: tokenIn?.symbol ?? "", to: tokenOut?.symbol ?? "" }),
      disabled: false,
      action: submit,
    };
  })();

  return (
    <Panel
      label={t("swap.execute")}
      ticked
      meta={
        quote ? (
          <span className="chip chip-live">
            <span className="dot dot-live" />
            {t("swap.poolTier", { fee: feeLabel(quote.fee) })}
          </span>
        ) : (
          <span className="chip">{t("common.idle")}</span>
        )
      }
      bodyClassName="p-3"
    >
      <div className="panel bg-base p-3">
        <div className="flex items-center justify-between">
          <span className="lbl">{t("swap.pay")}</span>
          <span className="num text-[11px] text-faint">
            {tokenIn && balanceIn !== undefined
              ? `${formatUnitsFixed(balanceIn, tokenIn.decimals)} ${tokenIn.symbol}`
              : "—"}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            className="field-lg num min-w-0 flex-1"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(event) => setAmount(sanitiseAmount(event.target.value))}
            aria-label={t("swap.amountLabel")}
          />
          <TokenButton
            token={tokenIn}
            onClick={() => setPicker("in")}
            label={t("token.selectShort")}
          />
        </div>
        <div className="mt-2 flex gap-1.5">
          {[0.25, 0.5, 1].map((fraction) => (
            <button
              key={fraction}
              type="button"
              className="btn btn-sm flex-1"
              onClick={() => setFraction(fraction)}
              disabled={balanceIn === undefined || balanceIn === 0n}
            >
              {fraction === 1 ? t("swap.max") : `${fraction * 100}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="relative my-2 flex justify-center">
        <div className="absolute inset-x-0 top-1/2 hair" />
        <button
          type="button"
          className="icon-btn relative bg-panel"
          onClick={() => {
            onSwitch();
            setAmount("");
          }}
          aria-label={t("swap.invert")}
        >
          <Icon name="swap" size={15} />
        </button>
      </div>

      <div className="panel bg-base p-3">
        <div className="flex items-center justify-between">
          <span className="lbl">{t("swap.receive")}</span>
          <span className="num text-[11px] text-faint">
            {tokenOut && balanceOut !== undefined
              ? `${formatUnitsFixed(balanceOut, tokenOut.decimals)} ${tokenOut.symbol}`
              : "—"}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="num min-w-0 flex-1 truncate text-[22px] leading-[52px]">
            {quote && tokenOut ? formatUnitsFixed(quote.amountOut, tokenOut.decimals) : "0.0"}
          </span>
          <TokenButton
            token={tokenOut}
            onClick={() => setPicker("out")}
            label={t("token.selectShort")}
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="lbl">{t("swap.maxSlippage")}</span>
          <div className="flex gap-1.5">
            {SLIPPAGE_PRESETS.map((bps) => (
              <button
                key={bps}
                type="button"
                className="btn btn-sm"
                data-active={settings.slippageBps === bps}
                style={
                  settings.slippageBps === bps
                    ? { borderColor: "var(--color-accent-line)", color: "var(--color-accent-text)" }
                    : undefined
                }
                onClick={() => setSettings({ slippageBps: bps })}
              >
                {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
              </button>
            ))}
          </div>
        </div>

        <Row
          k={t("swap.rate")}
          v={
            quote && tokenIn && tokenOut
              ? `1 ${tokenIn.symbol} = ${formatPrice(quote.executionPrice)} ${tokenOut.symbol}`
              : "—"
          }
        />
        <Row
          k={t("swap.priceImpact")}
          v={quote ? formatPercent(quote.priceImpact) : "—"}
          tone={quote && quote.priceImpact > 0.02 ? "short" : undefined}
        />
        <Row
          k={t("swap.minReceived")}
          v={tokenOut ? `${minReceived} ${tokenOut.symbol}` : "—"}
        />
        <Row
          k={t("swap.route")}
          v={quote && tokenIn && tokenOut ? `${tokenIn.symbol} → ${tokenOut.symbol} · v3 ${feeLabel(quote.fee)}` : "—"}
        />
        <Row
          k={t("swap.deadline")}
          v={t("swap.minutes", { count: settings.deadlineMinutes })}
        />
      </div>

      {!routable && (
        <div className="mt-3">
          <p className="flex items-start gap-2 text-[11px] leading-relaxed warn">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t("swap.noVenueNote", { chain: pairChainLabel })}
          </p>
          <button
            type="button"
            className="btn btn-sm mt-2 w-full"
            disabled={venueResolving}
            onClick={retryVenue}
          >
            <Icon name="refresh" size={13} />
            {venueResolving ? t("settings.venueResolving") : t("swap.noVenueRetry")}
          </button>
        </div>
      )}

      {quote && quote.priceImpact > 0.05 && (
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed short">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          {t("swap.deepImpact")}
        </p>
      )}

      {error && <p className="wrap-any mt-3 text-[11px] leading-relaxed short">{error}</p>}

      <button
        type="button"
        className="btn btn-accent btn-block mt-3"
        disabled={cta.disabled || busy}
        onClick={cta.action}
      >
        {cta.label}
      </button>

      <p className="mt-2 text-center text-[10px] leading-relaxed text-faint">
        {t("swap.footnote")}
      </p>

      <TokenPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        tokens={tokens}
        listed={listed}
        chainId={tokenIn?.chainId ?? chainId}
        excludeAddress={picker === "in" ? tokenOut?.address : tokenIn?.address}
        title={picker === "in" ? t("token.payWith") : t("token.receive")}
        onSelect={(token) => (picker === "in" ? onTokenIn(token) : onTokenOut(token))}
      />
    </Panel>
  );
}

function TokenButton({
  token,
  onClick,
  label,
}: {
  token?: Token;
  onClick: () => void;
  label: string;
}) {
  return (
    <button type="button" className="btn btn-sm shrink-0 gap-2" onClick={onClick}>
      {token ? (
        <>
          <TokenBadge token={token} size={20} />
          <span className="normal-case tracking-normal">{token.symbol}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
      <Icon name="chevron" size={12} />
    </button>
  );
}
