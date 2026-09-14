"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { TokenBadge, TokenPicker } from "@/components/terminal/TokenPicker";
import { usePairPrice } from "@/hooks/usePairPrice";
import { useTokenList } from "@/hooks/useTokenList";
import { chainMeta } from "@/lib/chains";
import { formatPrice } from "@/lib/format";
import { STRATEGY_SHORT, STRATEGY_SUMMARY } from "@/lib/strategies";
import { useI18n } from "@/hooks/useI18n";
import { baseTokens, nativeToken, type Token } from "@/lib/tokens";
import type { Bot, Strategy, StrategyKind } from "@/lib/types";
import { emptyRuntime, useAppStore } from "@/store/useAppStore";

const KIND_ORDER: StrategyKind[] = ["dca", "grid", "limit", "trail"];

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
  const { tokens } = useTokenList(chainId);
  const addBot = useAppStore((state) => state.addBot);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [base, setBase] = useState<Token>();
  const [quote, setQuote] = useState<Token>();
  const [picker, setPicker] = useState<"base" | "quote" | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!chainId || !meta) return;
    const defaults = baseTokens(chainId);
    setBase((current) => (current?.chainId === chainId ? current : nativeToken(chainId)));
    setQuote((current) =>
      current?.chainId === chainId ? current : defaults.find((t) => t.address === meta.stable),
    );
  }, [chainId, meta]);

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
      default:
        return undefined;
    }
  }, [draft]);

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
          <Segmented
            options={KIND_ORDER.map((kind) => ({ value: kind, label: t(STRATEGY_SHORT[kind]) }))}
            value={draft.kind}
            onChange={(value) => patch("kind", value)}
            className="w-full"
          />
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
        chainId={chainId}
        excludeAddress={picker === "base" ? quote?.address : base?.address}
        title={picker === "base" ? t("token.base") : t("token.quote")}
        onSelect={(token) => (picker === "base" ? setBase(token) : setQuote(token))}
      />
    </Sheet>
  );
}

function PairButton({
  token,
  caption,
  placeholder,
  onClick,
}: {
  token?: Token;
  caption: string;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="row-link panel flex items-center gap-2.5 p-2.5"
      onClick={onClick}
    >
      {token ? <TokenBadge token={token} size={26} /> : <span className="h-[26px] w-[26px] border border-line" />}
      <span className="min-w-0 flex-1 text-left">
        <span className="lbl block">{caption}</span>
        <span className="block truncate text-[13px] font-semibold">
          {token?.symbol ?? placeholder}
        </span>
      </span>
      <Icon name="chevron" size={12} className="text-faint" />
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  numeric = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <label className="block">
      <span className="lbl mb-1.5 block">{label}</span>
      <input
        className="field"
        value={value}
        inputMode={numeric ? "decimal" : "text"}
        onChange={(event) =>
          onChange(numeric ? event.target.value.replace(/[^\d.]/g, "") : event.target.value)
        }
      />
      {hint && <span className="mt-1 block text-[10px] text-faint">{hint}</span>}
    </label>
  );
}
