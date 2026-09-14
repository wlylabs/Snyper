import type { Bot, Strategy, StrategyKind } from "./types";

export type Intent = {
  side: "buy" | "sell";
  /** Quote currency to spend on a buy. */
  amountQuote?: number;
  /** Base currency to sell. */
  amountBase?: number;
  reason: string;
  level?: number;
};

export const STRATEGY_LABELS: Record<StrategyKind, string> = {
  dca: "Interval accumulation",
  grid: "Grid",
  limit: "Trigger order",
  trail: "Trailing stop",
};

export const STRATEGY_SUMMARY: Record<StrategyKind, string> = {
  dca: "Buys a fixed quote amount on a timer, optionally only under a price ceiling.",
  grid: "Places ladder legs between two bounds, buying each level down and unwinding it a step up.",
  limit: "Fires once when price crosses the trigger in the chosen direction.",
  trail: "Tracks the running peak and unwinds when price gives back the trail distance.",
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
            ? `Interval leg due under ceiling ${strategy.priceCeiling}`
            : "Interval leg due",
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
            reason: `Level ${i + 1} reclaimed ${(levels[i] + step).toFixed(4)}`,
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
            reason: `Level ${i + 1} crossed at ${levels[i].toFixed(4)}`,
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
            reason: `Price crossed under ${strategy.trigger}`,
          }
        : {
            side: "sell",
            amountBase: strategy.amount,
            reason: `Price crossed over ${strategy.trigger}`,
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
        reason: `Gave back ${strategy.trailPercent}% from peak ${peak.toFixed(4)}`,
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
): { ok: true } | { ok: false; reason: string } {
  const notional =
    intent.side === "buy" ? (intent.amountQuote ?? 0) : (intent.amountBase ?? 0) * price;

  if (notional <= 0) return { ok: false, reason: "Zero size" };

  if (bot.dailyCapQuote > 0) {
    const spent = bot.runtime.spentDate === today ? bot.runtime.spentQuote : 0;
    if (spent + notional > bot.dailyCapQuote) {
      return { ok: false, reason: "Daily cap reached" };
    }
  }
  return { ok: true };
}

export function describeStrategy(bot: Bot): string {
  const s = bot.strategy;
  const quote = bot.quote.symbol;
  const base = bot.base.symbol;
  switch (s.kind) {
    case "dca":
      return `${s.amountQuote} ${quote} every ${s.intervalMin}m${
        s.priceCeiling > 0 ? ` under ${s.priceCeiling}` : ""
      }`;
    case "grid":
      return `${s.levels} levels ${s.lower}–${s.upper}, ${s.amountQuote} ${quote} each`;
    case "limit":
      return s.side === "buy"
        ? `Buy ${s.amount} ${quote} at ≤ ${s.trigger}`
        : `Sell ${s.amount} ${base} at ≥ ${s.trigger}`;
    case "trail":
      return `Sell ${s.amountBase} ${base} on ${s.trailPercent}% giveback`;
    default:
      return "";
  }
}
