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
  snipe: "strategy.snipe",
  protect: "strategy.protect",
};

export const STRATEGY_SHORT: Record<StrategyKind, TKey> = {
  dca: "strategy.dcaShort",
  grid: "strategy.gridShort",
  limit: "strategy.limitShort",
  trail: "strategy.trailShort",
  order: "strategy.orderShort",
  snipe: "strategy.snipeShort",
  protect: "strategy.protectShort",
};

export const STRATEGY_SUMMARY: Record<StrategyKind, TKey> = {
  dca: "strategy.dcaSummary",
  grid: "strategy.gridSummary",
  limit: "strategy.limitSummary",
  trail: "strategy.trailSummary",
  order: "strategy.orderSummary",
  snipe: "strategy.snipeSummary",
  protect: "strategy.protectSummary",
};

/** How long a snipe watches for liquidity before it gives up. */
export const SNIPE_TTL_MS = 24 * 60 * 60 * 1000;

export function gridLevels(strategy: Extract<Strategy, { kind: "grid" }>): number[] {
  const { lower, upper, levels } = strategy;
  if (levels < 2 || upper <= lower) return [];
  const step = (upper - lower) / (levels - 1);
  return Array.from({ length: levels }, (_, i) => lower + step * i);
}

/**
 * Strategies that buy once and then manage the position they are left with.
 * An order waits for a price; a snipe waits for a pool. From the fill onwards
 * they behave identically, so they share one lifecycle.
 */
export type StagedStrategy = Extract<Strategy, { kind: "order" | "snipe" }>;

export function isStaged(strategy: Strategy): strategy is StagedStrategy {
  return strategy.kind === "order" || strategy.kind === "snipe";
}

export type ExitTargets = { takeProfit?: number; cutLoss?: number };

/**
 * Prices the take profit and cut loss sit at. Both hang off what the entry
 * actually paid; an order falls back to the price it was set at so the card can
 * show targets before anything has filled. A target set to zero is switched off,
 * which a snipe is allowed to do on either side.
 */
export function exitTargets(
  strategy: StagedStrategy,
  fillPrice: number | undefined,
): ExitTargets {
  const filled = fillPrice && fillPrice > 0 ? fillPrice : undefined;
  const base = filled ?? (strategy.kind === "order" ? strategy.entryPrice : 0);
  if (!(base > 0)) return {};
  return {
    takeProfit:
      strategy.takeProfitPct > 0 ? base * (1 + strategy.takeProfitPct / 100) : undefined,
    cutLoss: strategy.cutLossPct > 0 ? base * (1 - strategy.cutLossPct / 100) : undefined,
  };
}

/** Whether a fill is worth holding on to, or is handed straight to the wallet. */
export function hasExitTargets(strategy: StagedStrategy): boolean {
  return strategy.takeProfitPct > 0 || strategy.cutLossPct > 0;
}

/** Prices a protect watch sells at, measured from its reference price. */
export function protectTargets(
  strategy: Extract<Strategy, { kind: "protect" }>,
  reference: number | undefined,
): ExitTargets {
  if (!reference || reference <= 0) return {};
  return {
    takeProfit:
      strategy.takeProfitPct > 0 ? reference * (1 + strategy.takeProfitPct / 100) : undefined,
    cutLoss:
      strategy.cutLossPct > 0 ? reference * (1 - strategy.cutLossPct / 100) : undefined,
  };
}

/** The price a protect watch measures against: the one it was armed at. */
export function protectReference(bot: Bot): number | undefined {
  if (bot.strategy.kind !== "protect") return undefined;
  const fixed = bot.strategy.referencePrice;
  if (fixed > 0) return fixed;
  return bot.runtime.refPrice && bot.runtime.refPrice > 0 ? bot.runtime.refPrice : undefined;
}

function units(value: string | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

/** Base units the staged entry is still holding, or zero before it fills. */
export function orderPosition(bot: Bot): bigint {
  return units(bot.runtime.positionBase);
}

/** Base units the wallet held at the last tick, for a protect watch. */
export function heldPosition(bot: Bot): bigint {
  return units(bot.runtime.heldBase);
}

/** Take profit and cut loss for a staged entry that has already filled. */
function stagedExit(
  bot: Bot,
  strategy: StagedStrategy,
  price: number,
): Intent | undefined {
  const position = orderPosition(bot);
  if (position <= 0n) return undefined;

  const { takeProfit, cutLoss } = exitTargets(strategy, bot.runtime.fillPrice);
  const leg: OrderLeg | undefined =
    takeProfit !== undefined && price >= takeProfit
      ? "tp"
      : cutLoss !== undefined && price <= cutLoss
        ? "cl"
        : undefined;
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

/** Order targets as plain numbers — an order always sets both sides. */
export function orderTargets(
  strategy: Extract<Strategy, { kind: "order" }>,
  fillPrice: number | undefined,
): { takeProfit: number; cutLoss: number } {
  const { takeProfit, cutLoss } = exitTargets(strategy, fillPrice);
  return { takeProfit: takeProfit ?? 0, cutLoss: cutLoss ?? 0 };
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
  // position under water would turn a cut loss into a suggestion, so anything
  // already guarding a position is exempt.
  const protectingPosition =
    strategy.kind === "protect" || (isStaged(strategy) && runtime.stage === "holding");
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
      return stagedExit(bot, strategy, price);
    }

    case "snipe": {
      const stage = runtime.stage ?? "waiting";

      if (stage === "waiting") {
        // A price at all means a pool exists. Depth and impact are checked
        // against the chain right before the signal is raised, because neither
        // can be read from the price alone.
        if (now >= strategy.expiresAt) return undefined;
        if (strategy.maxEntryPrice > 0 && price > strategy.maxEntryPrice) return undefined;
        return {
          side: "buy",
          amountQuote: strategy.amountQuote,
          leg: "entry",
          reason: { key: "reason.snipeEntry", vars: { price: formatPrice(price) } },
        };
      }

      if (stage !== "holding") return undefined;
      return stagedExit(bot, strategy, price);
    }

    case "protect": {
      // The watch guards whatever the wallet is holding right now, so the size
      // comes from the balance read on the last tick rather than from a fill.
      const held = heldPosition(bot);
      if (held <= 0n) return undefined;

      const reference = protectReference(bot);
      const { takeProfit, cutLoss } = protectTargets(strategy, reference);
      const leg: OrderLeg | undefined =
        takeProfit !== undefined && price >= takeProfit
          ? "tp"
          : cutLoss !== undefined && price <= cutLoss
            ? "cl"
            : undefined;
      if (!leg) return undefined;

      const fraction = Math.min(1, Math.max(0, strategy.sellFraction));
      const size =
        fraction >= 1 ? held : (held * BigInt(Math.round(fraction * 10_000))) / 10_000n;
      if (size <= 0n) return undefined;

      return {
        side: "sell",
        amountBaseRaw: size.toString(),
        leg,
        reason: {
          key: leg === "tp" ? "reason.protectTakeProfit" : "reason.protectCutLoss",
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

  // Closing a guarded position is not spending. A daily cap that blocked the
  // exit would hold a losing position open precisely when it needs to be let go.
  const closingPosition =
    intent.side === "sell" &&
    (isStaged(bot.strategy) || bot.strategy.kind === "protect");

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
    case "snipe":
      return {
        key: s.takeProfitPct > 0 || s.cutLossPct > 0 ? "strategy.snipeDesc" : "strategy.snipeDescBare",
        vars: {
          amount: s.amountQuote,
          quote,
          base,
          tp: s.takeProfitPct,
          cl: s.cutLossPct,
        },
      };
    case "protect":
      return {
        key: "strategy.protectDesc",
        vars: {
          percent: Math.round(s.sellFraction * 100),
          base,
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
