import type { DisplayCurrency } from "./currency";
import type { Locale, TKey, TVars } from "./i18n";
import type { Token } from "./tokens";

/**
 * Lifecycle of a snype. The entry stage is the only one that can time out:
 * once the position exists, its protection runs until it is closed.
 */
export type SnypeStage =
  | "waiting"
  | "entering"
  | "holding"
  | "exiting"
  | "done"
  | "expired"
  | "cancelled";

export type SnypeLeg = "entry" | "tp" | "cl" | "manual";

/**
 * A message stored as a dictionary key so it renders in the reader's language
 * whenever it is shown. Plain strings are accepted for entries written before
 * the app was translated.
 */
export type Reason = { key: TKey; vars?: TVars };

/** The numbers a snype is armed with. They never change once it is confirmed. */
export type SnypePlan = {
  /** Quote currency spent once the entry fills. */
  amountQuote: number;
  /** The snype buys at or below this price. */
  entryPrice: number;
  /** Take profit, percent above the price the entry actually filled at. */
  takeProfitPct: number;
  /** Cut loss, percent below the price the entry actually filled at. */
  cutLossPct: number;
  /** The entry stage gives up here. Exits are never time limited. */
  expiresAt: number;
};

export type SnypeRuntime = {
  lastTickAt?: number;
  lastFireAt?: number;
  lastPrice?: number;
  fills: number;
  completed?: boolean;
  error?: string;
  stage?: SnypeStage;
  /** Price the entry actually filled at, which is what TP and CL hang off. */
  fillPrice?: number;
  /** Base units of the asset actually received, held as a string. */
  positionBase?: string;
  /**
   * Quote units the entry actually paid, held as a string. This is the figure
   * the performance fee is measured against, so it is recorded raw rather than
   * rebuilt from `fillPrice` — a float round trip on a position's cost basis is
   * how a reader ends up charged on a profit they did not make.
   */
  costQuote?: string;
  exitReason?: Exclude<SnypeLeg, "entry">;
};

export type Snype = {
  id: string;
  name: string;
  chainId: number;
  /** Asset the snype accumulates. */
  base: Token;
  /** Funding asset the snype prices against. */
  quote: Token;
  plan: SnypePlan;
  slippageBps: number;
  cooldownSec: number;
  status: "idle" | "armed";
  createdAt: number;
  runtime: SnypeRuntime;
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
  snypeId: string;
  snypeName: string;
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
  /** Which leg of the snype this signal settles. */
  leg?: SnypeLeg;
};

export type TradeKind = "swap" | "approval";

export type Trade = {
  id: string;
  kind: TradeKind;
  chainId: number;
  createdAt: number;
  hash: `0x${string}`;
  status: "submitted" | "confirmed" | "failed";
  source: "terminal" | "snype";
  tokenIn?: Token;
  tokenOut?: Token;
  amountIn?: string;
  /** What the wallet actually received, already net of anything Snyper took. */
  amountOut?: string;
  /** Snyper's share of the output, in bps. Absent on trades that predate fees. */
  feeBps?: number;
  snypeName?: string;
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
  /** Swaps above this much price impact are refused outright. 0 disables. */
  maxImpactBps: number;
};
