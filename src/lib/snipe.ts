import type { PublicClient } from "viem";
import { erc20Abi } from "./abi";
import { formatAmount, formatPercent } from "./format";
import { findPools, poolDepth, quoteExactIn, type PoolRef } from "./quote";
import { routingAddress, type Token } from "./tokens";
import type { Bot, Reason, Strategy } from "./types";

/** Defaults a snipe starts from. Deliberately cautious rather than fast. */
export const SNIPE_DEFAULTS = {
  minLiquidityQuote: 0,
  maxImpactBps: 1_500,
  takeProfitPct: 100,
  cutLossPct: 35,
  slippageBps: 300,
} as const;

export type SnipeStrategy = Extract<Strategy, { kind: "snipe" }>;

/**
 * What can be read about a pair before committing to it: whether a pool exists
 * at all, how much funding sits in it, and what a trade of this size would cost
 * in depth. None of it proves a token is safe — it only rules out the pools that
 * are demonstrably too thin to sell back out of.
 */
export type PoolState = {
  pool?: PoolRef;
  /** Quote-side depth in whole quote units, when it could be read. */
  depth?: number;
  /** Total supply of the base token, used for the meme heuristics. */
  totalSupply?: bigint;
};

export async function readPoolState(
  client: PublicClient,
  base: Token,
  quote: Token,
): Promise<PoolState> {
  const [pools, supply] = await Promise.all([
    findPools(client, base.chainId, routingAddress(base), routingAddress(quote)),
    client
      .readContract({ address: base.address, abi: erc20Abi, functionName: "totalSupply" })
      .catch(() => undefined),
  ]);

  const pool = pools[0];
  const depth = pool ? await poolDepth(client, pool.address, quote) : undefined;
  return {
    pool,
    depth,
    totalSupply: typeof supply === "bigint" ? supply : undefined,
  };
}

export type SnipeGate = { ok: true } | { ok: false; reason: Reason; waiting: boolean };

/**
 * The check that stands between a snipe and the buy it is waiting to make.
 * `waiting` separates "the pool is not ready yet", which is the normal state of
 * a snipe, from a guard the operator set that the pool actually failed.
 */
export async function snipeGate(
  client: PublicClient,
  bot: Bot,
  amountIn: bigint,
): Promise<SnipeGate> {
  const strategy = bot.strategy;
  if (strategy.kind !== "snipe") return { ok: true };

  const pools = await findPools(
    client,
    bot.chainId,
    routingAddress(bot.base),
    routingAddress(bot.quote),
  );
  const pool = pools[0];
  if (!pool) return { ok: false, reason: { key: "reason.snipeNoPool" }, waiting: true };

  if (strategy.minLiquidityQuote > 0) {
    const depth = await poolDepth(client, pool.address, bot.quote);
    if (depth === undefined) {
      return { ok: false, reason: { key: "reason.snipeDepthUnknown" }, waiting: true };
    }
    if (depth < strategy.minLiquidityQuote) {
      return {
        ok: false,
        waiting: true,
        reason: {
          key: "reason.snipeThin",
          vars: {
            depth: formatAmount(depth),
            min: formatAmount(strategy.minLiquidityQuote),
            symbol: bot.quote.symbol,
          },
        },
      };
    }
  }

  // The last word belongs to the quoter: it prices this exact size against the
  // pool as it stands, which is what a rugged or one-sided pool fails on.
  const quote = await quoteExactIn(client, bot.quote, bot.base, amountIn);
  if (!quote) return { ok: false, reason: { key: "reason.snipeNoRoute" }, waiting: true };

  const limit = Math.max(0, strategy.maxImpactBps) / 10_000;
  if (limit > 0 && quote.priceImpact > limit) {
    return {
      ok: false,
      waiting: false,
      reason: {
        key: "reason.snipeImpact",
        vars: {
          impact: formatPercent(quote.priceImpact),
          limit: formatPercent(limit),
        },
      },
    };
  }

  return { ok: true };
}
