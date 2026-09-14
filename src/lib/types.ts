import type { DisplayCurrency } from "./currency";
import type { Locale, TKey, TVars } from "./i18n";
import type { Token } from "./tokens";

export type StrategyKind = "dca" | "grid" | "limit" | "trail" | "order";

/**
 * Lifecycle of a one-shot order. The entry stage is the only one that can time
 * out — once the position exists, its protection runs until it is closed.
 */
export type OrderStage =
  | "waiting"
  | "entering"
  | "holding"
  | "exiting"
  | "done"
  | "expired"
  | "cancelled";

export type OrderLeg = "entry" | "tp" | "cl" | "manual";

/**
 * A message stored as a dictionary key so it renders in the reader's language
 * whenever it is shown. Plain strings are accepted for entries written before
 * the app was translated.
 */
export type Reason = { key: TKey; vars?: TVars };

export type Strategy =
  | {
      kind: "dca";
      /** Minutes between scheduled buys. */
      intervalMin: number;
      /** Quote currency spent per buy. */
      amountQuote: number;
      /** Skip a leg when price trades above this ceiling. 0 disables. */
      priceCeiling: number;
      /** Stop after this much quote has been deployed. 0 disables. */
      budgetQuote: number;
    }
  | {
      kind: "grid";
      lower: number;
      upper: number;
      levels: number;
      /** Quote currency committed at each level. */
      amountQuote: number;
    }
  | {
      kind: "limit";
      side: "buy" | "sell";
      trigger: number;
      /** Quote amount for a buy, base amount for a sell. */
      amount: number;
    }
  | {
      kind: "order";
      /** Quote currency spent once the entry fills. */
      amountQuote: number;
      /** The order buys at or below this price. */
      entryPrice: number;
      /** Take profit, percent above the price the entry actually filled at. */
      takeProfitPct: number;
      /** Cut loss, percent below the price the entry actually filled at. */
      cutLossPct: number;
      /** The entry stage gives up here. Exits are never time limited. */
      expiresAt: number;
    }
  | {
      kind: "trail";
      /** Distance below the running peak that closes the position. */
      trailPercent: number;
      /** Base amount sold when the stop fires. */
      amountBase: number;
      /** Optional floor that must be reclaimed before the stop arms. */
      activation: number;
    };

export type BotRuntime = {
  lastTickAt?: number;
  lastFireAt?: number;
  lastPrice?: number;
  peak?: number;
  activated?: boolean;
  filledLevels: number[];
  spentDate?: string;
  spentQuote: number;
  deployedQuote: number;
  fills: number;
  completed?: boolean;
  error?: string;
  /** Order lifecycle. Undefined for every other strategy. */
  stage?: OrderStage;
  /** Price the entry actually filled at, which is what TP and CL hang off. */
  fillPrice?: number;
  /** Base units of the asset actually received, held as a string. */
  positionBase?: string;
  exitReason?: Exclude<OrderLeg, "entry">;
};

export type Bot = {
  id: string;
  name: string;
  chainId: number;
  /** Asset the strategy accumulates or unwinds. */
  base: Token;
  /** Funding asset the strategy prices against. */
  quote: Token;
  strategy: Strategy;
  slippageBps: number;
  cooldownSec: number;
  /** Maximum quote spend per rolling day. 0 disables. */
  dailyCapQuote: number;
  execution: "manual" | "auto";
  status: "idle" | "armed";
  createdAt: number;
  runtime: BotRuntime;
};

export type SignalStatus =
  | "pending"
  | "executing"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled";

export type Signal = {
  id: string;
  botId: string;
  botName: string;
  chainId: number;
  createdAt: number;
  side: "buy" | "sell";
  reason: Reason | string;
  tokenIn: Token;
  tokenOut: Token;
  /** Base-unit amount held as a string so it survives persistence. */
  amountIn: string;
  price: number;
  status: SignalStatus;
  hash?: `0x${string}`;
  error?: string;
  /** Grid level this signal belongs to, when applicable. */
  level?: number;
  /** Which leg of an order this signal settles, when applicable. */
  leg?: OrderLeg;
};

export type TradeKind = "swap" | "approval";

export type Trade = {
  id: string;
  kind: TradeKind;
  chainId: number;
  createdAt: number;
  hash: `0x${string}`;
  status: "submitted" | "confirmed" | "failed";
  source: "terminal" | "bot";
  tokenIn?: Token;
  tokenOut?: Token;
  amountIn?: string;
  amountOut?: string;
  botName?: string;
};

export type PricePoint = { t: number; p: number };

export type Settings = {
  locale: Locale;
  /** Whether the reader picked a language, as opposed to it being detected. */
  localeChosen: boolean;
  currency: DisplayCurrency;
  slippageBps: number;
  deadlineMinutes: number;
  tickSeconds: number;
  theme: "dark" | "light";
  /** Auto execution still needs a wallet signature; this gates dispatch. */
  autoDispatch: boolean;
};
