"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { readableError, useExecutor } from "@/hooks/useExecutor";
import { useQuote } from "@/hooks/useQuote";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { chainMeta } from "@/lib/chains";
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
import { TokenBadge, TokenPicker } from "./TokenPicker";

const SLIPPAGE_PRESETS = [10, 50, 100];

/** Digits plus at most one decimal separator. */
function sanitiseAmount(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

export function SwapPanel({
  tokens,
  tokenIn,
  tokenOut,
  onTokenIn,
  onTokenOut,
  onSwitch,
}: {
  tokens: Token[];
  tokenIn?: Token;
  tokenOut?: Token;
  onTokenIn: (token: Token) => void;
  onTokenOut: (token: Token) => void;
  onSwitch: () => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { execute, phase } = useExecutor();
  const toast = useToast();
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);

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
      const message = readableError(cause);
      setError(message);
      toast.push({ tone: "error", message: "Execution stopped", detail: message });
    }
  };

  const cta = (() => {
    if (!isConnected) return { label: "Connect a wallet first", disabled: true };
    if (wrongNetwork) {
      const meta = chainMeta(tokenIn?.chainId);
      return {
        label: `Switch to ${meta?.label ?? "network"}`,
        disabled: false,
        action: () => tokenIn && switchChain({ chainId: tokenIn.chainId }),
      };
    }
    if (!amountIn || amountIn === 0n) return { label: "Enter an amount", disabled: true };
    if (insufficient) return { label: `Insufficient ${tokenIn?.symbol ?? ""}`, disabled: true };
    if (quoteQuery.isFetching && !quote) return { label: "Pricing route…", disabled: true };
    if (!quote) return { label: "No route found", disabled: true };
    if (phase === "approving") return { label: "Approving…", disabled: true };
    if (phase === "signing") return { label: "Confirm in wallet…", disabled: true };
    if (phase === "pending") return { label: "Settling…", disabled: true };
    return { label: `Swap ${tokenIn?.symbol} for ${tokenOut?.symbol}`, disabled: false, action: submit };
  })();

  return (
    <Panel
      label="Execute"
      ticked
      meta={
        quote ? (
          <span className="chip chip-live">
            <span className="dot dot-live" />
            {feeLabel(quote.fee)} pool
          </span>
        ) : (
          <span className="chip">Idle</span>
        )
      }
      bodyClassName="p-3"
    >
      <div className="panel bg-base p-3">
        <div className="flex items-center justify-between">
          <span className="lbl">Pay</span>
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
            aria-label="Amount to pay"
          />
          <TokenButton token={tokenIn} onClick={() => setPicker("in")} />
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
              {fraction === 1 ? "Max" : `${fraction * 100}%`}
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
          aria-label="Invert pair"
        >
          <Icon name="swap" size={15} />
        </button>
      </div>

      <div className="panel bg-base p-3">
        <div className="flex items-center justify-between">
          <span className="lbl">Receive</span>
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
          <TokenButton token={tokenOut} onClick={() => setPicker("out")} />
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="lbl">Max slippage</span>
          <div className="flex gap-1.5">
            {SLIPPAGE_PRESETS.map((bps) => (
              <button
                key={bps}
                type="button"
                className="btn btn-sm"
                data-active={settings.slippageBps === bps}
                style={
                  settings.slippageBps === bps
                    ? { borderColor: "var(--color-accent)", color: "var(--color-accent-text)" }
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
          k="Rate"
          v={
            quote && tokenIn && tokenOut
              ? `1 ${tokenIn.symbol} = ${formatPrice(quote.executionPrice)} ${tokenOut.symbol}`
              : "—"
          }
        />
        <Row
          k="Price impact"
          v={quote ? formatPercent(quote.priceImpact) : "—"}
          tone={quote && quote.priceImpact > 0.02 ? "short" : undefined}
        />
        <Row k="Minimum received" v={tokenOut ? `${minReceived} ${tokenOut.symbol}` : "—"} />
        <Row
          k="Route"
          v={quote && tokenIn && tokenOut ? `${tokenIn.symbol} → ${tokenOut.symbol} · v3 ${feeLabel(quote.fee)}` : "—"}
        />
        <Row k="Deadline" v={`${settings.deadlineMinutes} min`} />
      </div>

      {quote && quote.priceImpact > 0.05 && (
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed short">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          This size moves the pool more than 5%. Consider splitting it across legs.
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
        Routed through Uniswap v3 · signed in your wallet · {address ? "keys stay local" : "no keys held"}
      </p>

      <TokenPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        tokens={tokens}
        chainId={tokenIn?.chainId ?? chainId}
        excludeAddress={picker === "in" ? tokenOut?.address : tokenIn?.address}
        title={picker === "in" ? "Pay with" : "Receive"}
        onSelect={(token) => (picker === "in" ? onTokenIn(token) : onTokenOut(token))}
      />
    </Panel>
  );
}

function TokenButton({ token, onClick }: { token?: Token; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-sm shrink-0 gap-2" onClick={onClick}>
      {token ? (
        <>
          <TokenBadge token={token} size={20} />
          <span className="normal-case tracking-normal">{token.symbol}</span>
        </>
      ) : (
        <span>Select</span>
      )}
      <Icon name="chevron" size={12} />
    </button>
  );
}
