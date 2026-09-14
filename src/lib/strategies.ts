import { formatPrice } from "./format";
import type { TKey, TVars } from "./i18n";
import type { Bot, OrderLeg, Reason, Strategy, StrategyKind } from "./types";

export type Intent = {
  side: "buy" | "sell";
  /** Quote currency to spend on a buy. */
  amountQuote?: number;
  /** Base currency to sell. */
  amountBase?: number;
  /**
   * Exact base units to sell, bypassing the float round trip. A full exit has
   * to send back precisely what came in, so an order always sets this.
   */
  amountBaseRaw?: string;
  /** Dictionary key plus values, so the log reads in whatever language is set. */
  reason: Reason;
  level?: number;
  leg?: OrderLeg;
};

/** How long an order waits for its entry before giving up. */
export const ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const STRATEGY_LABELS: Record<StrategyKind, TKey> = {
  dca: "strategy.dca",
  grid: "strategy.grid",
  limit: "strategy.limit",
  trail: "strategy.trail",
  order: "strategy.order",
};

export const STRATEGY_SHORT: Record<StrategyKind, TKey> = {
  dca: "strategy.dcaShort",
  grid: "strategy.gridShort",
  limit: "strategy.limitShort",
  trail: "strategy.trailShort",
  order: "strategy.orderShort",
};

export const STRATEGY_SUMMARY: Record<StrategyKind, TKey> = {
  dca: "strategy.dcaSummary",
  grid: "strategy.gridSummary",
  limit: "strategy.limitSummary",
  trail: "strategy.trailSummary",
  order: "strategy.orderSummary",
};

export function gridLevels(strategy: Extract<Strategy, { kind: "grid" }>): number[] {
  const { lower, upper, levels } = strategy;
  if (levels < 2 || upper <= lower) return [];
  const step = (upper - lower) / (levels - 1);
  return Array.from({ length: levels }, (_, i) => lower + step * i);
}

/** Prices the take profit and cut loss sit at, once the entry has filled. */
export function orderTargets(
  strategy: Extract<Strategy, { kind: "order" }>,
  fillPrice: number | undefined,
): { takeProfit: number; cutLoss: number } {
  const base = fillPrice && fillPrice > 0 ? fillPrice : strategy.entryPrice;
  return {
    takeProfit: base * (1 + strategy.takeProfitPct / 100),
    cutLoss: base * (1 - strategy.cutLossPct / 100),
  };
}

/** Base units the order is still holding, or zero before the entry fills. */
export function orderPosition(bot: Bot): bigint {
  try {
    return BigInt(bot.runtime.positionBase ?? "0");
  } catch {
    return 0n;
  }
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

  // A cooldown exists to space out entries. Letting it hold back the exit of a
  // position under water would turn a cut loss into a suggestion, so an order
  // that is already holding is exempt.
  const protectingPosition = strategy.kind === "order" && runtime.stage === "holding";
  const cooledDown =
    !runtime.lastFireAt || now - runtime.lastFireAt >= bot.cooldownSec * 1000;
  if (!cooledDown && !protectingPosition) return undefined;

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

    case "order": {
      const stage = runtime.stage ?? "waiting";

      if (stage === "waiting") {
        // Expiry closes the order in the engine; here it only stops it firing.
        if (now >= strategy.expiresAt) return undefined;
        if (price > strategy.entryPrice) return undefined;
        return {
          side: "buy",
          amountQuote: strategy.amountQuote,
          leg: "entry",
          reason: {
            key: "reason.orderEntry",
            vars: { price: formatPrice(strategy.entryPrice) },
          },
        };
      }

      if (stage !== "holding") return undefined;

      const position = orderPosition(bot);
      if (position <= 0n) return undefined;

      const { takeProfit, cutLoss } = orderTargets(strategy, runtime.fillPrice);
      const leg: OrderLeg | undefined =
        price >= takeProfit ? "tp" : price <= cutLoss ? "cl" : undefined;
      if (!leg) return undefined;

      return {
        side: "sell",
        // Exactly what came in, so nothing is left stranded behind rounding.
        amountBaseRaw: position.toString(),
        leg,
        reason: {
          key: leg === "tp" ? "reason.orderTakeProfit" : "reason.orderCutLoss",
          vars: {
            percent: leg === "tp" ? strategy.takeProfitPct : strategy.cutLossPct,
            price: formatPrice(leg === "tp" ? takeProfit : cutLoss),
          },
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
  const baseSize =
    intent.amountBaseRaw !== undefined
      ? Number(intent.amountBaseRaw) / 10 ** bot.base.decimals
      : (intent.amountBase ?? 0);
  const notional = intent.side === "buy" ? (intent.amountQuote ?? 0) : baseSize * price;

  if (notional <= 0) return { ok: false, reason: "reason.zeroSize" };

  // Closing an order is not spending. A daily cap that blocked the exit would
  // hold a losing position open precisely when it needs to be let go.
  const closingPosition = bot.strategy.kind === "order" && intent.side === "sell";

  if (bot.dailyCapQuote > 0 && !closingPosition) {
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
    case "order":
      return {
        key: "strategy.orderDesc",
        vars: {
          amount: s.amountQuote,
          quote,
          entry: formatPrice(s.entryPrice),
          tp: s.takeProfitPct,
          cl: s.cutLossPct,
        },
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
