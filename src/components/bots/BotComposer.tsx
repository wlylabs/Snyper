"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { TokenPicker } from "@/components/terminal/TokenPicker";
import { Field, PairButton } from "@/components/bots/fields";
import { usePairPrice } from "@/hooks/usePairPrice";
import { useTokenList } from "@/hooks/useTokenList";
import { chainMeta } from "@/lib/chains";
import { formatPrice } from "@/lib/format";
import { STRATEGY_SHORT, STRATEGY_SUMMARY } from "@/lib/strategies";
import { useI18n } from "@/hooks/useI18n";
import { nativeToken, stableToken, type Token } from "@/lib/tokens";
import type { Bot, Strategy, StrategyKind } from "@/lib/types";
import { emptyRuntime, useAppStore } from "@/store/useAppStore";

const KIND_ORDER: StrategyKind[] = ["dca", "grid", "limit", "trail", "protect"];

type Draft = {
  name: string;
  kind: StrategyKind;
  intervalMin: string;
  amountQuote: string;
  priceCeiling: string;
  budgetQuote: string;
  lower: string;
  upper: string;
  levels: string;
  side: "buy" | "sell";
  trigger: string;
  amount: string;
  trailPercent: string;
  amountBase: string;
  activation: string;
  sellPercent: string;
  takeProfitPct: string;
  cutLossPct: string;
  referencePrice: string;
  slippageBps: string;
  cooldownSec: string;
  dailyCapQuote: string;
  execution: "manual" | "auto";
};

const EMPTY_DRAFT: Draft = {
  name: "",
  kind: "dca",
  intervalMin: "60",
  amountQuote: "25",
  priceCeiling: "0",
  budgetQuote: "0",
  lower: "",
  upper: "",
  levels: "5",
  side: "buy",
  trigger: "",
  amount: "25",
  trailPercent: "5",
  amountBase: "",
  activation: "0",
  sellPercent: "100",
  takeProfitPct: "50",
  cutLossPct: "20",
  referencePrice: "0",
  slippageBps: "50",
  cooldownSec: "60",
  dailyCapQuote: "0",
  execution: "manual",
};

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function BotComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const activeChainId = useChainId();
  const { chainId: accountChainId } = useAccount();
  const chainId = accountChainId ?? activeChainId;
  const meta = chainMeta(chainId);
  const { tokens, listed } = useTokenList(chainId);
  const addBot = useAppStore((state) => state.addBot);
  const customTokens = useAppStore((state) => state.customTokens);
  const venueKey = useAppStore((state) => state.venueKey);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [base, setBase] = useState<Token>();
  const [quote, setQuote] = useState<Token>();
  const [picker, setPicker] = useState<"base" | "quote" | null>(null);
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
      setError(undefined);
    }
  }, [open]);

  const { price } = usePairPrice(open ? base : undefined, open ? quote : undefined, 20_000);

  const patch = (key: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const strategy = useMemo<Strategy | undefined>(() => {
    switch (draft.kind) {
      case "dca":
        return {
          kind: "dca",
          intervalMin: Math.max(1, num(draft.intervalMin, 60)),
          amountQuote: num(draft.amountQuote),
          priceCeiling: num(draft.priceCeiling),
          budgetQuote: num(draft.budgetQuote),
        };
      case "grid":
        return {
          kind: "grid",
          lower: num(draft.lower),
          upper: num(draft.upper),
          levels: Math.max(2, Math.round(num(draft.levels, 5))),
          amountQuote: num(draft.amountQuote),
        };
      case "limit":
        return {
          kind: "limit",
          side: draft.side,
          trigger: num(draft.trigger),
          amount: num(draft.amount),
        };
      case "trail":
        return {
          kind: "trail",
          trailPercent: num(draft.trailPercent, 5),
          amountBase: num(draft.amountBase),
          activation: num(draft.activation),
        };
      case "protect":
        return {
          kind: "protect",
          sellFraction: Math.min(1, Math.max(0, num(draft.sellPercent, 100) / 100)),
          takeProfitPct: Math.max(0, num(draft.takeProfitPct)),
          cutLossPct: Math.min(99, Math.max(0, num(draft.cutLossPct))),
          referencePrice: Math.max(0, num(draft.referencePrice)),
        };
      default:
        return undefined;
    }
  }, [draft]);

  /** Where the two targets would sit if the watch were armed right now. */
  const protectPreview = useMemo(() => {
    if (draft.kind !== "protect") return undefined;
    const reference = num(draft.referencePrice) > 0 ? num(draft.referencePrice) : price;
    if (!reference || reference <= 0) return undefined;
    return {
      takeProfit: reference * (1 + num(draft.takeProfitPct) / 100),
      cutLoss: reference * (1 - num(draft.cutLossPct) / 100),
    };
  }, [draft.kind, draft.referencePrice, draft.takeProfitPct, draft.cutLossPct, price]);

  const validate = (): string | undefined => {
    if (!base || !quote) return t("composer.errPair");
    if (base.address.toLowerCase() === quote.address.toLowerCase())
      return t("composer.errSame");
    if (!strategy) return t("composer.errStrategy");
    if (strategy.kind === "dca" && strategy.amountQuote <= 0) return t("composer.errAmount");
    if (strategy.kind === "grid") {
      if (strategy.lower <= 0 || strategy.upper <= 0) return t("composer.errBounds");
      if (strategy.upper <= strategy.lower) return t("composer.errUpper");
      if (strategy.amountQuote <= 0) return t("composer.errLevelAmount");
    }
    if (strategy.kind === "limit") {
      if (strategy.trigger <= 0) return t("composer.errTrigger");
      if (strategy.amount <= 0) return t("composer.errSize");
    }
    if (strategy.kind === "trail") {
      if (strategy.trailPercent <= 0 || strategy.trailPercent >= 100)
        return t("composer.errTrail");
      if (strategy.amountBase <= 0) return t("composer.errUnwind", { symbol: base.symbol });
    }
    if (strategy.kind === "protect") {
      if (strategy.sellFraction <= 0) return t("composer.errShare");
      if (strategy.takeProfitPct <= 0 && strategy.cutLossPct <= 0) {
        return t("composer.errNoTarget");
      }
    }
    return undefined;
  };

  const save = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!base || !quote || !strategy || !chainId) return;

    const bot: Bot = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: draft.name.trim() || `${base.symbol}/${quote.symbol} ${draft.kind.toUpperCase()}`,
      chainId,
      base,
      quote,
      strategy,
      slippageBps: Math.max(1, Math.min(1000, Math.round(num(draft.slippageBps, 50)))),
      cooldownSec: Math.max(0, Math.round(num(draft.cooldownSec, 60))),
      dailyCapQuote: Math.max(0, num(draft.dailyCapQuote)),
      execution: draft.execution,
      status: "idle",
      createdAt: Date.now(),
      runtime: emptyRuntime(),
    };

    addBot(bot);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={t("composer.title")}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm flex-1" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-accent btn-sm flex-1" onClick={save}>
            {t("composer.create")}
          </button>
        </div>
      }
    >
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

        <section>
          <p className="lbl mb-2">{t("composer.strategy")}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {KIND_ORDER.map((kind) => (
              <button
                key={kind}
                type="button"
                className="btn btn-sm"
                data-active={draft.kind === kind}
                style={
                  draft.kind === kind
                    ? {
                        borderColor: "var(--color-accent-line)",
                        color: "var(--color-accent-text)",
                      }
                    : undefined
                }
                onClick={() => patch("kind", kind)}
              >
                {t(STRATEGY_SHORT[kind])}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {t(STRATEGY_SUMMARY[draft.kind])}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          {draft.kind === "dca" && (
            <>
              <Field
                label={t("composer.amountPerLeg", { symbol: quote?.symbol ?? "" })}
                value={draft.amountQuote}
                onChange={(value) => patch("amountQuote", value)}
              />
              <Field
                label={t("composer.interval")}
                value={draft.intervalMin}
                onChange={(value) => patch("intervalMin", value)}
              />
              <Field
                label={t("composer.priceCeiling")}
                value={draft.priceCeiling}
                onChange={(value) => patch("priceCeiling", value)}
                hint={
                  price !== undefined
                    ? t("composer.midNow", { price: formatPrice(price) })
                    : undefined
                }
              />
              <Field
                label={t("composer.budget")}
                value={draft.budgetQuote}
                onChange={(value) => patch("budgetQuote", value)}
              />
            </>
          )}

          {draft.kind === "grid" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={t("composer.lower")}
                  value={draft.lower}
                  onChange={(value) => patch("lower", value)}
                />
                <Field
                  label={t("composer.upper")}
                  value={draft.upper}
                  onChange={(value) => patch("upper", value)}
                />
              </div>
              <Field
                label={t("composer.levels")}
                value={draft.levels}
                onChange={(value) => patch("levels", value)}
              />
              <Field
                label={t("composer.amountPerLevel", { symbol: quote?.symbol ?? "" })}
                value={draft.amountQuote}
                onChange={(value) => patch("amountQuote", value)}
                hint={
                  price !== undefined
                    ? t("composer.gridHint", {
                        price: formatPrice(price),
                        total: (
                          num(draft.amountQuote) * Math.max(2, num(draft.levels, 5))
                        ).toFixed(2),
                        symbol: quote?.symbol ?? "",
                      })
                    : undefined
                }
              />
            </>
          )}

          {draft.kind === "limit" && (
            <>
              <Segmented
                options={[
                  { value: "buy", label: t("composer.buyBelow") },
                  { value: "sell", label: t("composer.sellAbove") },
                ]}
                value={draft.side}
                onChange={(value) => patch("side", value)}
                className="w-full"
              />
              <Field
                label={t("composer.trigger", { symbol: quote?.symbol ?? "" })}
                value={draft.trigger}
                onChange={(value) => patch("trigger", value)}
                hint={
                  price !== undefined
                    ? t("composer.midNow", { price: formatPrice(price) })
                    : undefined
                }
              />
              <Field
                label={
                  draft.side === "buy"
                    ? t("composer.spend", { symbol: quote?.symbol ?? "" })
                    : t("composer.sell", { symbol: base?.symbol ?? "" })
                }
                value={draft.amount}
                onChange={(value) => patch("amount", value)}
              />
            </>
          )}

          {draft.kind === "trail" && (
            <>
              <Field
                label={t("composer.trailDistance")}
                value={draft.trailPercent}
                onChange={(value) => patch("trailPercent", value)}
              />
              <Field
                label={t("composer.sizeToUnwind", { symbol: base?.symbol ?? "" })}
                value={draft.amountBase}
                onChange={(value) => patch("amountBase", value)}
              />
              <Field
                label={t("composer.activation")}
                value={draft.activation}
                onChange={(value) => patch("activation", value)}
                hint={
                  price !== undefined
                    ? t("composer.midNow", { price: formatPrice(price) })
                    : undefined
                }
              />
            </>
          )}

          {draft.kind === "protect" && (
            <>
              <Field
                label={t("composer.shareToSell", { symbol: base?.symbol ?? "" })}
                value={draft.sellPercent}
                onChange={(value) => patch("sellPercent", value)}
                hint={t("composer.shareHint")}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={t("composer.takeProfit")}
                  value={draft.takeProfitPct}
                  onChange={(value) => patch("takeProfitPct", value)}
                  hint={
                    protectPreview
                      ? t("order.exitAt", { price: formatPrice(protectPreview.takeProfit) })
                      : undefined
                  }
                />
                <Field
                  label={t("composer.cutLoss")}
                  value={draft.cutLossPct}
                  onChange={(value) => patch("cutLossPct", value)}
                  hint={
                    protectPreview
                      ? t("order.exitAt", { price: formatPrice(protectPreview.cutLoss) })
                      : undefined
                  }
                />
              </div>
              <Field
                label={t("composer.reference", { symbol: quote?.symbol ?? "" })}
                value={draft.referencePrice}
                onChange={(value) => patch("referencePrice", value)}
                hint={
                  price !== undefined
                    ? t("composer.referenceHint", { price: formatPrice(price) })
                    : undefined
                }
              />
            </>
          )}
        </section>

        <section>
          <p className="lbl mb-2">{t("composer.risk")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field
              label={t("composer.slippageBps")}
              value={draft.slippageBps}
              onChange={(value) => patch("slippageBps", value)}
            />
            <Field
              label={t("composer.cooldown")}
              value={draft.cooldownSec}
              onChange={(value) => patch("cooldownSec", value)}
            />
          </div>
          <div className="mt-2">
            <Field
              label={t("composer.dailyCap", { symbol: quote?.symbol ?? "" })}
              value={draft.dailyCapQuote}
              onChange={(value) => patch("dailyCapQuote", value)}
            />
          </div>
        </section>

        <section>
          <p className="lbl mb-2">{t("composer.dispatch")}</p>
          <Segmented
            options={[
              { value: "manual", label: t("composer.reviewEach") },
              { value: "auto", label: t("composer.autoSubmit") },
            ]}
            value={draft.execution}
            onChange={(value) => patch("execution", value)}
            className="w-full"
          />
          <p className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            {t("composer.autoNote")}
          </p>
        </section>

        <section>
          <Field
            label={t("composer.name")}
            value={draft.name}
            onChange={(value) => patch("name", value)}
            numeric={false}
          />
        </section>

        {error && <p className="text-[11px] short">{error}</p>}
      </div>

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
