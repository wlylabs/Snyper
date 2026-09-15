import { formatPrice } from "./format";
import type { TKey, TVars } from "./i18n";
import type { Reason, Snype, SnypeLeg, SnypePlan } from "./types";

export type Intent = {
  side: "buy" | "sell";
  /** Quote currency to spend on a buy. */
  amountQuote?: number;
  /**
   * Exact base units to sell, bypassing the float round trip. A full exit has
   * to send back precisely what came in, so every sell leg sets this.
   */
  amountBaseRaw?: string;
  /** Dictionary key plus values, so the log reads in whatever language is set. */
  reason: Reason;
  leg: SnypeLeg;
};

/** How long a snype waits for its entry before giving up. */
export const SNYPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Defaults a new snype starts from. */
export const SNYPE_DEFAULTS = {
  slippageBps: 100,
  cooldownSec: 30,
} as const;

export type ExitTargets = { takeProfit: number; cutLoss: number };

/**
 * Prices the take profit and cut loss sit at. Both hang off what the entry
 * actually paid; before anything fills they fall back to the price the snype
 * was set at, so the card can show targets while it is still waiting.
 */
export function exitTargets(
  plan: Pick<SnypePlan, "entryPrice" | "takeProfitPct" | "cutLossPct">,
  fillPrice?: number,
): ExitTargets {
  const base = fillPrice && fillPrice > 0 ? fillPrice : plan.entryPrice;
  if (!(base > 0)) return { takeProfit: 0, cutLoss: 0 };
  return {
    takeProfit: base * (1 + plan.takeProfitPct / 100),
    cutLoss: base * (1 - plan.cutLossPct / 100),
  };
}

function units(value: string | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

/** Base units the snype is holding, or zero before it fills. */
export function position(snype: Snype): bigint {
  return units(snype.runtime.positionBase);
}

/**
 * Pure evaluation of a snype against the latest observed price.
 * `price` is quote currency per one unit of base currency.
 */
export function evaluate(snype: Snype, price: number, now: number): Intent | undefined {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const { plan, runtime } = snype;
  if (runtime.completed) return undefined;

  const stage = runtime.stage ?? "waiting";

  // A cooldown exists to space out entries. Letting it hold back the exit of a
  // position under water would turn a cut loss into a suggestion, so a snype
  // already guarding a fill is exempt.
  const cooledDown =
    !runtime.lastFireAt || now - runtime.lastFireAt >= snype.cooldownSec * 1000;
  if (!cooledDown && stage !== "holding") return undefined;

  if (stage === "waiting") {
    // Expiry closes the snype in the runner; here it only stops it firing.
    if (now >= plan.expiresAt) return undefined;
    if (price > plan.entryPrice) return undefined;
    return {
      side: "buy",
      amountQuote: plan.amountQuote,
      leg: "entry",
      reason: { key: "reason.entry", vars: { price: formatPrice(plan.entryPrice) } },
    };
  }

  if (stage !== "holding") return undefined;

  const held = position(snype);
  if (held <= 0n) return undefined;

  const { takeProfit, cutLoss } = exitTargets(plan, runtime.fillPrice);
  const leg: Exclude<SnypeLeg, "entry" | "manual"> | undefined =
    takeProfit > 0 && price >= takeProfit
      ? "tp"
      : cutLoss > 0 && price <= cutLoss
        ? "cl"
        : undefined;
  if (!leg) return undefined;

  return {
    side: "sell",
    // Exactly what came in, so nothing is left stranded behind rounding.
    amountBaseRaw: held.toString(),
    leg,
    reason: {
      key: leg === "tp" ? "reason.takeProfit" : "reason.cutLoss",
      vars: {
        percent: leg === "tp" ? plan.takeProfitPct : plan.cutLossPct,
        price: formatPrice(leg === "tp" ? takeProfit : cutLoss),
      },
    },
  };
}

/** Size gate applied after a snype produces an intent. */
export function withinLimits(
  snype: Snype,
  intent: Intent,
  price: number,
): { ok: true } | { ok: false; reason: TKey } {
  const baseSize =
    intent.amountBaseRaw !== undefined
      ? Number(intent.amountBaseRaw) / 10 ** snype.base.decimals
      : 0;
  const notional = intent.side === "buy" ? (intent.amountQuote ?? 0) : baseSize * price;
  if (notional <= 0) return { ok: false, reason: "reason.zeroSize" };
  return { ok: true };
}

export function describeSnype(snype: Snype): Reason {
  return {
    key: "snype.desc",
    vars: {
      amount: snype.plan.amountQuote,
      quote: snype.quote.symbol,
      entry: formatPrice(snype.plan.entryPrice),
      tp: snype.plan.takeProfitPct,
      cl: snype.plan.cutLossPct,
    },
  };
}

export type { TVars };
