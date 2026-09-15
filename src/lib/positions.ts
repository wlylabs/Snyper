import { dexMeta, isNative } from "./chains";
import type { Token } from "./tokens";
import type { Trade } from "./types";

/**
 * A position rebuilt from the local trade log. Everything here is derived from
 * swaps this browser actually submitted — there is no indexer behind it, so a
 * wallet traded elsewhere shows a holding on the assets page with no entry price
 * here, which is the honest answer rather than a guessed one.
 */
export type Position = {
  key: string;
  chainId: number;
  /** Asset being accumulated. */
  base: Token;
  /** Funding asset the entry was paid in, and the unit every figure is in. */
  cash: Token;
  /** Base units still open according to the log. */
  size: number;
  /** Weighted average entry, cash per base unit. */
  entry: number;
  /** Cash still tied up in the open size. */
  costOpen: number;
  /** Cash booked from the size already sold. */
  realised: number;
  /** Cash in and out across the whole life of the position. */
  spent: number;
  proceeds: number;
  fills: number;
  firstAt: number;
  lastAt: number;
  /**
   * A sell was larger than anything the log had bought. The size is anchored at
   * zero and the realised figure only counts the part with a known entry.
   */
  partial: boolean;
};

/** Assets treated as money rather than as a position: native, wrapped, stable. */
export function isCashAsset(token: Token): boolean {
  if (token.native || isNative(token.address)) return true;
  const dex = dexMeta(token.chainId);
  if (!dex) return false;
  const address = token.address.toLowerCase();
  return address === dex.wrapped.toLowerCase() || address === dex.stable.toLowerCase();
}

function toFloat(amount: string | undefined, decimals: number): number {
  if (!amount) return 0;
  try {
    return Number(BigInt(amount)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

function positionKey(chainId: number, base: Token, cash: Token): string {
  return `${chainId}:${base.address.toLowerCase()}:${cash.address.toLowerCase()}`;
}

function blank(chainId: number, base: Token, cash: Token, at: number): Position {
  return {
    key: positionKey(chainId, base, cash),
    chainId,
    base,
    cash,
    size: 0,
    entry: 0,
    costOpen: 0,
    realised: 0,
    spent: 0,
    proceeds: 0,
    fills: 0,
    firstAt: at,
    lastAt: at,
    partial: false,
  };
}

/**
 * Folds the confirmed swap log into positions, weighted-average cost basis.
 * `amountOut` is what the quote promised rather than what the receipt delivered,
 * so an entry on a taxed token reads slightly optimistic — the fill price a
 * staged strategy records from its own balance delta is the exact one.
 */
export function buildPositions(trades: Trade[], chainId?: number): Position[] {
  const open = new Map<string, Position>();

  // The store keeps the newest trade first; cost basis has to run forwards.
  const ordered = [...trades].reverse();

  for (const trade of ordered) {
    if (trade.kind !== "swap" || trade.status !== "confirmed") continue;
    if (chainId !== undefined && trade.chainId !== chainId) continue;
    const { tokenIn, tokenOut } = trade;
    if (!tokenIn || !tokenOut) continue;

    const cashIn = isCashAsset(tokenIn);
    const cashOut = isCashAsset(tokenOut);
    // Cash to cash is a conversion, and token to token has no basis to carry.
    if (cashIn === cashOut) continue;

    const base = cashIn ? tokenOut : tokenIn;
    const cash = cashIn ? tokenIn : tokenOut;
    const key = positionKey(trade.chainId, base, cash);
    const position = open.get(key) ?? blank(trade.chainId, base, cash, trade.createdAt);

    const amountIn = toFloat(trade.amountIn, tokenIn.decimals);
    const amountOut = toFloat(trade.amountOut, tokenOut.decimals);
    if (amountIn <= 0) continue;

    if (cashIn) {
      position.size += amountOut;
      position.costOpen += amountIn;
      position.spent += amountIn;
    } else {
      const sold = Math.min(amountIn, position.size);
      if (sold < amountIn) position.partial = true;
      // Only the part with a known entry books a result.
      const share = sold / amountIn;
      position.realised += amountOut * share - position.entry * sold;
      position.costOpen = Math.max(0, position.costOpen - position.entry * sold);
      position.size = Math.max(0, position.size - sold);
      position.proceeds += amountOut;
    }

    position.entry = position.size > 0 ? position.costOpen / position.size : 0;
    position.fills += 1;
    position.lastAt = trade.createdAt;
    position.firstAt = Math.min(position.firstAt, trade.createdAt);
    open.set(key, position);
  }

  return [...open.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export type PricedPosition = Position & {
  /** Live mid price in cash units, when the pair still routes. */
  price?: number;
  value?: number;
  unrealised?: number;
  /** Unrealised result as a fraction of the entry, 0.1 = up a tenth. */
  change?: number;
};

export function pricePosition(position: Position, price?: number): PricedPosition {
  if (price === undefined || position.size <= 0) return position;
  const value = position.size * price;
  return {
    ...position,
    price,
    value,
    unrealised: value - position.costOpen,
    change: position.entry > 0 ? price / position.entry - 1 : undefined,
  };
}
