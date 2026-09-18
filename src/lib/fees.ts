import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import type { Token } from "./tokens";
import { activeVenue } from "./venue";
import type { TradeVenue } from "./quote";

/**
 * What Snyper charges, and where the charge is allowed to come from.
 *
 * Every figure here rides on SwapRouter02's own fee split — `sweepTokenWithFee`
 * and `unwrapWETH9WithFee`, the two calls Uniswap put there for exactly this.
 * That means no contract of Snyper's own stands between a reader and their
 * trade: the fee is one more call in the multicall the swap already sends, and
 * a reader who stops using Snyper stops paying it the same moment.
 *
 * It also means the router's limits are Snyper's limits. `feeBips` outside
 * 1…100 reverts — confirmed against the deployment on chain 4663, not taken
 * from a source listing — so 1% of a trade is the ceiling on anything charged
 * this way, whatever a policy asks for.
 */

/** SwapRouter02's ceiling, which binds whenever the trade goes through it. */
export const ROUTER_MAX_FEE_BPS = 100;

/**
 * SnyperRouter's ceiling, which is where the intended charge actually fits: a
 * snype owes a tenth of its profit, a profit is never larger than the sale it
 * came out of, so a tenth of a profit is never more than a tenth of a sale.
 */
export const SNYPER_MAX_FEE_BPS = 1_000;

export type FeePolicy = {
  /**
   * Where the split lands. There is no default and no fallback: a build with
   * no recipient configured charges nothing at all, anywhere, rather than
   * quietly sending a cut to an address nobody chose.
   */
  recipient?: Address;
  /** Taken off the output of a swap the reader asked for by hand. */
  swapBps: number;
  /**
   * Share of the profit a snype made, charged only on an exit that made one.
   * Held in bps of the profit — 1_000 is a tenth of it — which is a different
   * unit from everything else here, and the one the pitch is written in.
   */
  profitShareBps: number;
};

function address(value: string | undefined): Address | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !isAddress(trimmed)) return undefined;
  const parsed = getAddress(trimmed);
  return parsed === zeroAddress ? undefined : parsed;
}

function bps(value: string | undefined, fallback: number, ceiling: number): number {
  const parsed = Number(value);
  const chosen = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  return Math.max(0, Math.min(ceiling, Math.round(chosen)));
}

/**
 * Snyper's own router, when one has been deployed and the build points at it.
 *
 * Without it the fee rides on SwapRouter02's split, which is the lighter
 * arrangement — no contract of Snyper's in the path — and comes with the two
 * limits that arrangement has: 1% of a trade, and nothing at all on a launchpad
 * curve. With it, both lift.
 */
export function feeRouter(): Address | undefined {
  routerCached ??= { value: address(process.env.NEXT_PUBLIC_SNYPER_ROUTER) };
  return routerCached.value;
}

let routerCached: { value: Address | undefined } | undefined;

/** The most that can be charged on one trade, given how it will be routed. */
export function maxFeeBps(): number {
  return feeRouter() ? SNYPER_MAX_FEE_BPS : ROUTER_MAX_FEE_BPS;
}

let cached: FeePolicy | undefined;

/**
 * The policy this build runs under. Read from the environment at build time,
 * so it is one deployment's decision rather than something a session can move.
 */
export function feePolicy(): FeePolicy {
  cached ??= Object.freeze({
    recipient: address(process.env.NEXT_PUBLIC_FEE_RECIPIENT),
    swapBps: bps(process.env.NEXT_PUBLIC_FEE_BPS, 25, SNYPER_MAX_FEE_BPS),
    profitShareBps: bps(process.env.NEXT_PUBLIC_PROFIT_SHARE_BPS, 1_000, 10_000),
  });
  return cached;
}

/**
 * Whether this venue can carry a fee at all. SwapRouter02 splits a pool trade
 * and knows nothing about a bonding curve; SnyperRouter reaches both, so a
 * launchpad trade is only chargeable once one is deployed.
 */
export function feeChargeable(venue: TradeVenue): boolean {
  // v4 is priced but never routed, so there is no trade here to charge for.
  if (venue === "v4") return false;
  return venue === "v3" || Boolean(feeRouter());
}

/**
 * Which end of the trade the fee comes off.
 *
 * The rule is that Snyper is paid in the asset the trade was funded with —
 * never in the memecoin, which is a treasury full of things nobody can sell.
 * The funding assets are the chain's own money: native currency and whatever
 * the venue prices in dollars. A trade between two of them, or between two of
 * neither, is charged on the way in.
 */
export function feeSide(tokenIn: Token, tokenOut: Token): { feeOnInput: boolean } {
  const stable = activeVenue()?.stable?.toLowerCase();
  const funding = (token: Token) =>
    Boolean(token.native) || (stable !== undefined && token.address.toLowerCase() === stable);
  return { feeOnInput: !(funding(tokenOut) && !funding(tokenIn)) };
}

/**
 * The cut on a swap the reader asked for by hand. Snype entries are deliberately
 * not charged here — the bot is paid out of what it makes, in `profitFeeBps`,
 * and charging the entry too would be charging twice for one position.
 */
export function swapFeeBps(): number {
  const policy = feePolicy();
  return policy.recipient ? Math.min(maxFeeBps(), policy.swapBps) : 0;
}

/**
 * A snype's exit, priced as a share of what the position actually made.
 *
 * The router can only take a percentage of the whole output, so the share of
 * the profit is converted into the equivalent share of the exit and handed over
 * in that unit. Two things follow, and both are deliberate:
 *
 *   an exit that lost money is charged nothing — there is no profit to divide,
 *   and a cut loss is not an event anyone should be billed for;
 *
 *   a big winner may be charged less than the headline share, because the
 *   ceiling bites first. Through SwapRouter02 that ceiling is 100 bps, so a
 *   position that doubled owes 500 and pays 100; through SnyperRouter it is
 *   1_000, which the intended share can never exceed. Either way the cap is in
 *   the reader's favour and is described as one wherever it is shown.
 */
export function profitFeeBps(params: {
  /** Quote units the exit returns, before any split. */
  grossOut: bigint;
  /** Quote units the entry actually paid for the position. */
  costBasis: bigint;
}): number {
  const policy = feePolicy();
  if (!policy.recipient || policy.profitShareBps <= 0) return 0;

  const { grossOut, costBasis } = params;
  if (grossOut <= 0n || costBasis <= 0n) return 0;

  const profit = grossOut - costBasis;
  if (profit <= 0n) return 0;

  const fee = (profit * BigInt(policy.profitShareBps)) / 10_000n;
  const share = Number((fee * 10_000n) / grossOut);
  if (!Number.isFinite(share)) return 0;
  // Below one bip the router refuses the call outright, so a fee that rounds to
  // nothing is no fee rather than a reverted exit.
  return Math.min(maxFeeBps(), Math.floor(share));
}

/** The part of an output the fee leg keeps. */
export function feeOnOutput(amountOut: bigint, feeBps: number): bigint {
  if (amountOut <= 0n || feeBps <= 0) return 0n;
  return (amountOut * BigInt(Math.min(maxFeeBps(), Math.round(feeBps)))) / 10_000n;
}

/** What actually reaches the wallet once the fee leg has taken its part. */
export function netOfFee(amountOut: bigint, feeBps: number): bigint {
  return amountOut - feeOnOutput(amountOut, feeBps);
}
