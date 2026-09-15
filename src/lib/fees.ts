import { getAddress, isAddress, zeroAddress, type Address } from "viem";

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

/** The router's ceiling, and therefore Snyper's. */
export const MAX_FEE_BPS = 100;

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

let cached: FeePolicy | undefined;

/**
 * The policy this build runs under. Read from the environment at build time,
 * so it is one deployment's decision rather than something a session can move.
 */
export function feePolicy(): FeePolicy {
  cached ??= Object.freeze({
    recipient: address(process.env.NEXT_PUBLIC_FEE_RECIPIENT),
    swapBps: bps(process.env.NEXT_PUBLIC_FEE_BPS, 25, MAX_FEE_BPS),
    profitShareBps: bps(process.env.NEXT_PUBLIC_PROFIT_SHARE_BPS, 1_000, 10_000),
  });
  return cached;
}

/** Only a pool route can carry a fee leg; a bonding curve has nowhere to put one. */
export function feeChargeable(venue: "v3" | "curve"): boolean {
  return venue === "v3";
}

/**
 * The cut on a swap the reader asked for by hand. Snype entries are deliberately
 * not charged here — the bot is paid out of what it makes, in `profitFeeBps`,
 * and charging the entry too would be charging twice for one position.
 */
export function swapFeeBps(): number {
  const policy = feePolicy();
  return policy.recipient ? Math.min(MAX_FEE_BPS, policy.swapBps) : 0;
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
 *   a big winner is charged less than the headline share, because the router's
 *   100 bps ceiling bites first. A position that doubled would owe 10% of a
 *   profit worth half the exit — 500 bps — and pays 100. The ceiling is a cap
 *   in the reader's favour and is described as one wherever it is shown.
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
  return Math.min(MAX_FEE_BPS, Math.floor(share));
}

/** The part of an output the fee leg keeps. */
export function feeOnOutput(amountOut: bigint, feeBps: number): bigint {
  if (amountOut <= 0n || feeBps <= 0) return 0n;
  return (amountOut * BigInt(Math.min(MAX_FEE_BPS, Math.round(feeBps)))) / 10_000n;
}

/** What actually reaches the wallet once the fee leg has taken its part. */
export function netOfFee(amountOut: bigint, feeBps: number): bigint {
  return amountOut - feeOnOutput(amountOut, feeBps);
}
