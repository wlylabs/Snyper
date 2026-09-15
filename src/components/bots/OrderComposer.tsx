"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { Field, PairButton } from "@/components/bots/fields";
import { TokenPicker } from "@/components/terminal/TokenPicker";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { useFxRate } from "@/hooks/useFxRate";
import { useI18n } from "@/hooks/useI18n";
import { usePairPrice } from "@/hooks/usePairPrice";
import { useTokenList } from "@/hooks/useTokenList";
import { chainMeta } from "@/lib/chains";
import { formatMoney } from "@/lib/currency";
import { formatAmount, formatPrice } from "@/lib/format";
import { ORDER_TTL_MS } from "@/lib/strategies";
import { nativeToken, stableToken, type Token } from "@/lib/tokens";
import type { Bot, Strategy } from "@/lib/types";
import { emptyRuntime, useAppStore } from "@/store/useAppStore";

/** Entry shortcuts, as a discount to the price on screen right now. */
const OFFSETS = [3, 5, 8, 15];

type Draft = {
  amountQuote: string;
  entryPrice: string;
  takeProfitPct: string;
  cutLossPct: string;
};

const EMPTY_DRAFT: Draft = {
  amountQuote: "50",
  entryPrice: "",
  takeProfitPct: "60",
  cutLossPct: "25",
};

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function OrderComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const activeChainId = useChainId();
  const { chainId: accountChainId } = useAccount();
  const chainId = accountChainId ?? activeChainId;
  const meta = chainMeta(chainId);
  const { tokens, listed } = useTokenList(chainId);
  const addBot = useAppStore((state) => state.addBot);
  const customTokens = useAppStore((state) => state.customTokens);
  const venueKey = useAppStore((state) => state.venueKey);
  const settings = useAppStore((state) => state.settings);
  const { fx } = useFxRate();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [base, setBase] = useState<Token>();
  const [quote, setQuote] = useState<Token>();
  const [picker, setPicker] = useState<"base" | "quote" | null>(null);
  const [step, setStep] = useState<"setup" | "confirm">("setup");
  const [error, setError] = useState<string>();

  /**
   * The funding leg is the one that can be defaulted: the chain's USD unit where
   * the venue carries one, otherwise its coin. The traded leg is left for the
   * reader to pick, seeded with the last contract they imported — which on this
   * chain is the memecoin they were just looking at.
   */
  useEffect(() => {
    if (!chainId || !meta) return;
    const funding = stableToken(chainId) ?? nativeToken(chainId);
    const lastImported = [...customTokens]
      .reverse()
      .find((token) => token.chainId === chainId);
    setQuote((current) => (current?.chainId === chainId ? current : funding));
    setBase((current) => (current?.chainId === chainId ? current : lastImported));
  }, [chainId, meta, venueKey, customTokens]);

  useEffect(() => {
    if (open) {
      setDraft(EMPTY_DRAFT);
      setStep("setup");
      setError(undefined);
    }
  }, [open]);

  const { price } = usePairPrice(open ? base : undefined, open ? quote : undefined, 20_000);

  const patch = (key: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const amountQuote = num(draft.amountQuote);
  const entryPrice = num(draft.entryPrice);
  const takeProfitPct = num(draft.takeProfitPct);
  const cutLossPct = num(draft.cutLossPct);

  /** Rupiah only means anything when the funding leg is the chain's stable. */
  const stableQuote =
    quote !== undefined &&
    quote.address.toLowerCase() === stableToken(chainId)?.address.toLowerCase();
  const money = (value: number) =>
    stableQuote ? formatMoney(value, { currency: settings.currency, fx, locale }) : undefined;

  const offsetLabel = useMemo(() => {
    if (!price || entryPrice <= 0) return undefined;
    const delta = (entryPrice / price - 1) * 100;
    return t("order.entryOffset", {
      percent: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`,
    });
  }, [entryPrice, price, t]);

  const projection = useMemo(() => {
    if (amountQuote <= 0 || entryPrice <= 0) return undefined;
    return {
      size: amountQuote / entryPrice,
      takeProfitPrice: entryPrice * (1 + takeProfitPct / 100),
      cutLossPrice: entryPrice * (1 - cutLossPct / 100),
      profit: (amountQuote * takeProfitPct) / 100,
      loss: (amountQuote * cutLossPct) / 100,
    };
  }, [amountQuote, cutLossPct, entryPrice, takeProfitPct]);

  const validate = (): string | undefined => {
    if (!base || !quote) return t("composer.errPair");
    if (base.address.toLowerCase() === quote.address.toLowerCase())
      return t("composer.errSame");
    if (amountQuote <= 0) return t("order.errAmount");
    if (entryPrice <= 0) return t("order.errEntry");
    if (price !== undefined && entryPrice > price) return t("order.errEntryAbove");
    if (takeProfitPct <= 0) return t("order.errTakeProfit");
    if (cutLossPct <= 0 || cutLossPct >= 100) return t("order.errCutLoss");
    return undefined;
  };

  const review = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    setStep("confirm");
  };

  const arm = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      setStep("setup");
      return;
    }
    if (!base || !quote || !chainId) return;

    const now = Date.now();
    const strategy: Strategy = {
      kind: "order",
      amountQuote,
      entryPrice,
      takeProfitPct,
      cutLossPct,
      expiresAt: now + ORDER_TTL_MS,
    };

    const bot: Bot = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${base.symbol} ${t("order.title")}`,
      chainId,
      base,
      quote,
      strategy,
      slippageBps: 100,
      cooldownSec: 30,
      dailyCapQuote: 0,
      execution: "auto",
      // An order is armed by confirming it; there is no second switch to find.
      status: "armed",
      createdAt: now,
      runtime: { ...emptyRuntime(), stage: "waiting" },
    };

    addBot(bot);
    onClose();
  };

  const expiryDate = new Date(Date.now() + ORDER_TTL_MS).toLocaleDateString(
    locale === "id" ? "id-ID" : "en-US",
    { day: "numeric", month: "short" },
  );

  return (
    <Sheet
      open={open}
      title={step === "setup" ? t("order.new") : t("order.confirmTitle")}
      onClose={onClose}
      footer={
        step === "setup" ? (
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm flex-1" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn-accent btn-sm flex-1" onClick={review}>
              {t("order.review")}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={() => setStep("setup")}
            >
              {t("order.edit")}
            </button>
            <button type="button" className="btn btn-accent btn-sm flex-1" onClick={arm}>
              {t("order.confirm")}
            </button>
          </div>
        )
      }
    >
      {step === "setup" ? (
        <div className="flex flex-col gap-4 p-3">
          <section>
            <p className="lbl mb-2">
              {t("composer.pairOn", { chain: meta?.label ?? t("common.network") })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <PairButton
                token={base}
                caption={t("token.base")}
                placeholder={t("token.selectShort")}
                onClick={() => setPicker("base")}
              />
              <PairButton
                token={quote}
                caption={t("token.quote")}
                placeholder={t("token.selectShort")}
                onClick={() => setPicker("quote")}
              />
            </div>
            <div className="mt-2 flex items-center justify-between border border-line bg-base px-3 py-2">
              <span className="lbl">{t("composer.poolMid")}</span>
              <span className="num text-[13px]">
                {price !== undefined
                  ? `${formatPrice(price)} ${quote?.symbol ?? ""}`
                  : t("composer.reading")}
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <Field
              label={t("order.spend", { symbol: quote?.symbol ?? "" })}
              value={draft.amountQuote}
              onChange={(value) => patch("amountQuote", value)}
              hint={amountQuote > 0 ? money(amountQuote) : undefined}
            />

            <div>
              <Field
                label={t("order.entry", { symbol: quote?.symbol ?? "" })}
                value={draft.entryPrice}
                onChange={(value) => patch("entryPrice", value)}
                hint={offsetLabel}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OFFSETS.map((offset) => (
                  <button
                    key={offset}
                    type="button"
                    className="chip transition-colors hover:text-ink disabled:opacity-40"
                    disabled={price === undefined}
                    onClick={() =>
                      price !== undefined &&
                      patch("entryPrice", String(Number((price * (1 - offset / 100)).toPrecision(8))))
                    }
                  >
                    −{offset}%
                  </button>
                ))}
              </div>
            </div>

            <Field
              label={t("order.takeProfit")}
              value={draft.takeProfitPct}
              onChange={(value) => patch("takeProfitPct", value)}
              hint={
                projection
                  ? t("order.exitAt", { price: formatPrice(projection.takeProfitPrice) })
                  : undefined
              }
            />
            <Field
              label={t("order.cutLoss")}
              value={draft.cutLossPct}
              onChange={(value) => patch("cutLossPct", value)}
              hint={
                projection
                  ? t("order.exitAt", { price: formatPrice(projection.cutLossPrice) })
                  : undefined
              }
            />
          </section>

          {error && <p className="text-[11px] short">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between border border-line bg-base px-3 py-2">
            <span className="text-[13px] font-semibold">
              {base?.symbol} / {quote?.symbol}
            </span>
            <span className="lbl">{t("order.once")}</span>
          </div>

          <div className="panel p-3">
            <Line
              k={t("order.buyLabel")}
              v={t("order.buyLine", {
                amount: amountQuote,
                quote: quote?.symbol ?? "",
                size: projection ? formatAmount(projection.size) : "—",
                base: base?.symbol ?? "",
              })}
            />
            <Line k={t("order.atPrice")} v={formatPrice(entryPrice)} />
            <div className="my-2 h-px bg-line" />
            <Line
              k={t("order.ifTakeProfit")}
              v={`+${formatAmount(projection?.profit ?? 0)} ${quote?.symbol ?? ""}${
                money(projection?.profit ?? 0) ? ` · ${money(projection?.profit ?? 0)}` : ""
              }`}
              tone="long"
            />
            <Line
              k={t("order.ifCutLoss")}
              v={`−${formatAmount(projection?.loss ?? 0)} ${quote?.symbol ?? ""}${
                money(projection?.loss ?? 0) ? ` · ${money(projection?.loss ?? 0)}` : ""
              }`}
              tone="short"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-faint">
            {t("order.terms", {
              slippage: "1%",
              loss: formatAmount(projection?.loss ?? 0),
              symbol: quote?.symbol ?? "",
            })}
          </p>
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-warn">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            {t("order.expiryNote", { date: expiryDate, price: formatPrice(entryPrice) })}
          </p>
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            {t("composer.autoNote")}
          </p>

          {error && <p className="text-[11px] short">{error}</p>}
        </div>
      )}

      <TokenPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        tokens={tokens}
        listed={listed}
        chainId={chainId}
        excludeAddress={picker === "base" ? quote?.address : base?.address}
        title={picker === "base" ? t("token.base") : t("token.quote")}
        onSelect={(token) => (picker === "base" ? setBase(token) : setQuote(token))}
      />
    </Sheet>
  );
}

function Line({ k, v, tone }: { k: string; v: string; tone?: "long" | "short" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12px] text-dim">{k}</span>
      <span className={`num text-right text-[12.5px] ${tone ?? ""}`}>{v}</span>
    </div>
  );
}
