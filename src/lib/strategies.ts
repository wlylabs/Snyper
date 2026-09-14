import { formatPrice } from "./format";
import type { TKey, TVars } from "./i18n";
import type { Bot, Reason, Strategy, StrategyKind } from "./types";

export type Intent = {
  side: "buy" | "sell";
  /** Quote currency to spend on a buy. */
  amountQuote?: number;
  /** Base currency to sell. */
  amountBase?: number;
  /** Dictionary key plus values, so the log reads in whatever language is set. */
  reason: Reason;
  level?: number;
};

export const STRATEGY_LABELS: Record<StrategyKind, TKey> = {
  dca: "strategy.dca",
  grid: "strategy.grid",
  limit: "strategy.limit",
  trail: "strategy.trail",
};

export const STRATEGY_SHORT: Record<StrategyKind, TKey> = {
  dca: "strategy.dcaShort",
  grid: "strategy.gridShort",
  limit: "strategy.limitShort",
  trail: "strategy.trailShort",
};

export const STRATEGY_SUMMARY: Record<StrategyKind, TKey> = {
  dca: "strategy.dcaSummary",
  grid: "strategy.gridSummary",
  limit: "strategy.limitSummary",
  trail: "strategy.trailSummary",
};

export function gridLevels(strategy: Extract<Strategy, { kind: "grid" }>): number[] {
  const { lower, upper, levels } = strategy;
  if (levels < 2 || upper <= lower) return [];
  const step = (upper - lower) / (levels - 1);
  return Array.from({ length: levels }, (_, i) => lower + step * i);
}

export function gridStep(strategy: Extract<Strategy, { kind: "grid" }>): number {
  if (strategy.levels < 2) return 0;
  return (strategy.upper - strategy.lower) / (strategy.levels - 1);
}

/**
 * Pure evaluation of a strategy against the latest observed price.
 * `price` is quote currency per one unit of base currency.
 */
export function evaluate(bot: Bot, price: number, now: number): Intent | undefined {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const { strategy, runtime } = bot;

  if (runtime.completed) return undefined;

  const cooledDown =
    !runtime.lastFireAt || now - runtime.lastFireAt >= bot.cooldownSec * 1000;
  if (!cooledDown) return undefined;

  switch (strategy.kind) {
    case "dca": {
      const due =
        !runtime.lastFireAt || now - runtime.lastFireAt >= strategy.intervalMin * 60_000;
      if (!due) return undefined;
      if (strategy.priceCeiling > 0 && price > strategy.priceCeiling) return undefined;
      if (
        strategy.budgetQuote > 0 &&
        runtime.deployedQuote + strategy.amountQuote > strategy.budgetQuote
      ) {
        return undefined;
      }
      return {
        side: "buy",
        amountQuote: strategy.amountQuote,
        reason:
          strategy.priceCeiling > 0
            ? { key: "reason.dcaDueCeiling", vars: { ceiling: formatPrice(strategy.priceCeiling) } }
            : { key: "reason.dcaDue" },
      };
    }

    case "grid": {
      const levels = gridLevels(strategy);
      if (levels.length === 0) return undefined;
      const step = gridStep(strategy);
      const filled = new Set(runtime.filledLevels);

      // Unwind the lowest filled level once price reclaims a full step above it.
      for (let i = 0; i < levels.length; i += 1) {
        if (!filled.has(i)) continue;
        if (price >= levels[i] + step) {
          return {
            side: "sell",
            amountBase: strategy.amountQuote / levels[i],
            level: i,
            reason: {
              key: "reason.gridSell",
              vars: { level: i + 1, price: formatPrice(levels[i] + step) },
            },
          };
        }
      }

      // Buy the highest unfilled level price has traded through.
      for (let i = levels.length - 1; i >= 0; i -= 1) {
        if (filled.has(i)) continue;
        if (price <= levels[i] && price >= strategy.lower) {
          return {
            side: "buy",
            amountQuote: strategy.amountQuote,
            level: i,
            reason: {
              key: "reason.gridBuy",
              vars: { level: i + 1, price: formatPrice(levels[i]) },
            },
          };
        }
      }
      return undefined;
    }

    case "limit": {
      const hit =
        strategy.side === "buy" ? price <= strategy.trigger : price >= strategy.trigger;
      if (!hit) return undefined;
      return strategy.side === "buy"
        ? {
            side: "buy",
            amountQuote: strategy.amount,
            reason: {
              key: "reason.limitBuy",
              vars: { trigger: formatPrice(strategy.trigger) },
            },
          }
        : {
            side: "sell",
            amountBase: strategy.amount,
            reason: {
              key: "reason.limitSell",
              vars: { trigger: formatPrice(strategy.trigger) },
            },
          };
    }

    case "trail": {
      if (strategy.activation > 0 && !runtime.activated && price < strategy.activation) {
        return undefined;
      }
      const peak = Math.max(runtime.peak ?? 0, price);
      const stop = peak * (1 - strategy.trailPercent / 100);
      if (peak <= 0 || price > stop) return undefined;
      return {
        side: "sell",
        amountBase: strategy.amountBase,
        reason: {
          key: "reason.trail",
          vars: { percent: strategy.trailPercent, peak: formatPrice(peak) },
        },
      };
    }

    default:
      return undefined;
  }
}

/** Risk gate applied after a strategy produces an intent. */
export function withinRiskLimits(
  bot: Bot,
  intent: Intent,
  price: number,
  today: string,
): { ok: true } | { ok: false; reason: TKey } {
  const notional =
    intent.side === "buy" ? (intent.amountQuote ?? 0) : (intent.amountBase ?? 0) * price;

  if (notional <= 0) return { ok: false, reason: "reason.zeroSize" };

  if (bot.dailyCapQuote > 0) {
    const spent = bot.runtime.spentDate === today ? bot.runtime.spentQuote : 0;
    if (spent + notional > bot.dailyCapQuote) {
      return { ok: false, reason: "reason.dailyCap" };
    }
  }
  return { ok: true };
}

export function describeStrategy(bot: Bot): Reason {
  const s = bot.strategy;
  const quote = bot.quote.symbol;
  const base = bot.base.symbol;
  switch (s.kind) {
    case "dca":
      return s.priceCeiling > 0
        ? {
            key: "strategy.dcaDescCeiling",
            vars: {
              amount: s.amountQuote,
              quote,
              interval: s.intervalMin,
              ceiling: formatPrice(s.priceCeiling),
            },
          }
        : {
            key: "strategy.dcaDesc",
            vars: { amount: s.amountQuote, quote, interval: s.intervalMin },
          };
    case "grid":
      return {
        key: "strategy.gridDesc",
        vars: {
          levels: s.levels,
          lower: formatPrice(s.lower),
          upper: formatPrice(s.upper),
          amount: s.amountQuote,
          quote,
        },
      };
    case "limit":
      return s.side === "buy"
        ? {
            key: "strategy.limitBuyDesc",
            vars: { amount: s.amount, quote, trigger: formatPrice(s.trigger) },
          }
        : {
            key: "strategy.limitSellDesc",
            vars: { amount: s.amount, base, trigger: formatPrice(s.trigger) },
          };
    case "trail":
      return {
        key: "strategy.trailDesc",
        vars: { amount: s.amountBase, base, percent: s.trailPercent },
      };
    default:
      return { key: "common.none" };
  }
}

export type { TVars };
