import type { PublicClient } from "viem";
import { zeroAddress } from "viem";
import { erc20Abi, quoterV2Abi, v3FactoryAbi, v3PoolAbi } from "./abi";
import { dexMeta } from "./chains";
import {
  curveMidPrice,
  isCurveToken,
  quoteCurveBuy,
  quoteCurveSell,
  readCurveState,
  readPonsLaunch,
  tradesOnCurve,
  type CurveState,
} from "./pons";
import { routingAddress, type Token } from "./tokens";

export type PoolRef = {
  address: `0x${string}`;
  fee: number;
  liquidity: bigint;
};

/**
 * Where a trade settles. Robinhood Chain carries both: Pons V1 launches and
 * everything else route through Uniswap v3, while a Pons V2 launch trades
 * directly against its own bonding curve until it graduates.
 */
export type TradeVenue = "v3" | "curve";

export type Quote = {
  venue: TradeVenue;
  /** v3 fee tier, or the curve's combined fee, in hundredths of a bip. */
  fee: number;
  amountIn: bigint;
  amountOut: bigint;
  /** Pool mid price expressed as tokenOut per tokenIn. */
  midPrice: number;
  /** Realised rate for this size, tokenOut per tokenIn. */
  executionPrice: number;
  /** Fraction of mid price lost to depth, 0.01 = 1%. */
  priceImpact: number;
  gasEstimate: bigint;
  /** The v3 pool, or the curve, the trade settles against. */
  pool: `0x${string}`;
  /**
   * The quote was derived from the venue's own state rather than simulated by a
   * quoter. Accurate to the point where the trade leaves the current tick, so
   * the interface labels it instead of presenting it as a firm number.
   */
  estimated?: boolean;
  /** Quote refunded by a curve buy that cleared the remaining supply. */
  refund?: bigint;
  /** Which leg of a curve trade this is. Absent on a v3 route. */
  curveSide?: "buy" | "sell";
};

const POOL_TTL_MS = 10 * 60 * 1000;
const CURVE_TTL_MS = 60 * 1000;
const poolCache = new Map<string, { at: number; pools: PoolRef[] }>();
/** Which token trades on which curve. A launch never moves back onto one. */
const curveCache = new Map<string, { at: number; curve?: `0x${string}` }>();

function pairKey(chainId: number, a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${chainId}:${x}:${y}`;
}

/** Resolves every deployed fee tier for a pair, ordered by active liquidity. */
export async function findPools(
  client: PublicClient,
  chainId: number,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
): Promise<PoolRef[]> {
  const dex = dexMeta(chainId);
  if (!dex) return [];

  const key = pairKey(chainId, tokenA, tokenB);
  const hit = poolCache.get(key);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.pools;

  const addresses = await client.multicall({
    allowFailure: true,
    contracts: dex.feeTiers.map((fee) => ({
      address: dex.factory,
      abi: v3FactoryAbi,
      functionName: "getPool" as const,
      args: [tokenA, tokenB, fee] as const,
    })),
  });

  const candidates: { address: `0x${string}`; fee: number }[] = [];
  addresses.forEach((entry, index) => {
    if (entry.status !== "success") return;
    const address = entry.result as `0x${string}`;
    if (!address || address === zeroAddress) return;
    candidates.push({ address, fee: dex.feeTiers[index] });
  });
  if (candidates.length === 0) return [];

  const liquidity = await client.multicall({
    allowFailure: true,
    contracts: candidates.map((c) => ({
      address: c.address,
      abi: v3PoolAbi,
      functionName: "liquidity" as const,
    })),
  });

  const pools: PoolRef[] = [];
  candidates.forEach((c, index) => {
    const entry = liquidity[index];
    if (entry.status !== "success") return;
    const value = entry.result as bigint;
    if (value === 0n) return;
    pools.push({ ...c, liquidity: value });
  });

  pools.sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));
  // An empty result is never cached: a pool that is deployed but still dry is
  // exactly what a snipe is waiting on, and ten minutes of cached emptiness
  // would make it miss the moment liquidity lands.
  if (pools.length > 0) poolCache.set(key, { at: Date.now(), pools });
  return pools;
}

/**
 * The bonding curve a pair trades on, if either side is a Pons V2 launch that
 * has not graduated yet. Looked up through the launchpad's own record, so a
 * token that has since moved to a Uniswap v4 pool stops resolving here.
 */
export async function findCurve(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
): Promise<CurveState | undefined> {
  for (const token of [tokenOut, tokenIn]) {
    if (token.native) continue;
    const key = `${token.chainId}:${token.address.toLowerCase()}`;
    const hit = curveCache.get(key);
    let curve = hit && Date.now() - hit.at < CURVE_TTL_MS ? hit.curve : undefined;

    if (!hit || Date.now() - hit.at >= CURVE_TTL_MS) {
      const launch = await readPonsLaunch(client, token.address).catch(() => undefined);
      curve = tradesOnCurve(launch) ? launch.curve : undefined;
      curveCache.set(key, { at: Date.now(), curve });
    }
    if (!curve) continue;

    const state = await readCurveState(client, curve).catch(() => undefined);
    if (!state || state.graduated) continue;
    // The other leg has to be the curve's own quote asset: a curve trades in
    // one pair and nothing else can be routed through it.
    const other = token === tokenOut ? tokenIn : tokenOut;
    if (!curveAcceptsQuote(state, other)) continue;
    return state;
  }
  return undefined;
}

function curveAcceptsQuote(state: CurveState, token: Token): boolean {
  if (state.pairToken === zeroAddress) return Boolean(token.native);
  return token.address.toLowerCase() === state.pairToken.toLowerCase();
}

/**
 * Quote-side depth of a pool, in whole quote units. Reading the pool's own
 * balance of the funding asset is the plainest measure of what can actually be
 * traded against — and the one a rug empties first.
 */
export async function poolDepth(
  client: PublicClient,
  pool: `0x${string}`,
  quote: Token,
): Promise<number | undefined> {
  try {
    // A pool never holds native currency: the native leg sits there wrapped,
    // which is what `routingAddress` resolves to.
    const balance = (await client.readContract({
      address: routingAddress(quote),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [pool],
    })) as bigint;
    return Number(balance) / 10 ** quote.decimals;
  } catch {
    return undefined;
  }
}

const Q96 = 2n ** 96n;
const SCALE = 10n ** 18n;

/** Converts a pool's sqrtPriceX96 into a decimal-adjusted tokenOut/tokenIn rate. */
function rateFromSqrtPrice(
  sqrtPriceX96: bigint,
  inIsToken0: boolean,
  decimalsIn: number,
  decimalsOut: number,
): number {
  if (sqrtPriceX96 === 0n) return 0;
  // token1 per token0, scaled by 1e18 before narrowing to a float.
  const numerator = sqrtPriceX96 * sqrtPriceX96 * SCALE;
  const oneZero = numerator / (Q96 * Q96);
  if (oneZero === 0n) return 0;

  const raw = inIsToken0 ? Number(oneZero) / 1e18 : 1e18 / Number(oneZero);
  // Decimal adjustment collapses to the same exponent in both directions.
  return raw * 10 ** (decimalsIn - decimalsOut);
}

type PoolSnapshot = {
  pool: PoolRef;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  inIsToken0: boolean;
};

async function readPool(
  client: PublicClient,
  pool: PoolRef,
  inAddress: `0x${string}`,
): Promise<PoolSnapshot | undefined> {
  try {
    const [slot0, token0, liquidity] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: pool.address, abi: v3PoolAbi, functionName: "slot0" as const },
        { address: pool.address, abi: v3PoolAbi, functionName: "token0" as const },
        { address: pool.address, abi: v3PoolAbi, functionName: "liquidity" as const },
      ],
    });
    return {
      pool,
      sqrtPriceX96: slot0[0],
      liquidity,
      inIsToken0: token0.toLowerCase() === inAddress.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

/** Pool mid price for a pair, independent of trade size. */
export async function midPrice(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
): Promise<{ price: number; pool: PoolRef; venue: TradeVenue } | undefined> {
  const chainId = tokenIn.chainId;
  const inAddress = routingAddress(tokenIn);
  const outAddress = routingAddress(tokenOut);
  if (inAddress.toLowerCase() === outAddress.toLowerCase()) return undefined;

  const curve = await findCurve(client, tokenIn, tokenOut);
  if (curve) {
    const price = curveMidPrice(curve, tokenIn, tokenOut);
    if (price === undefined) return undefined;
    return {
      price,
      pool: {
        address: curve.curve,
        fee: Number(curve.feeBps) * 100,
        liquidity: curve.tokenReserve,
      },
      venue: "curve",
    };
  }

  const pools = await findPools(client, chainId, inAddress, outAddress);
  const pool = pools[0];
  if (!pool) return undefined;

  const snapshot = await readPool(client, pool, inAddress);
  if (!snapshot) return undefined;

  const price = rateFromSqrtPrice(
    snapshot.sqrtPriceX96,
    snapshot.inIsToken0,
    tokenIn.decimals,
    tokenOut.decimals,
  );
  if (!Number.isFinite(price) || price <= 0) return undefined;
  return { price, pool, venue: "v3" };
}

function toFloat(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/**
 * Prices a swap from the pool's own state, for venues where no QuoterV2 address
 * is configured. A v3 pool's liquidity and sqrt price are equivalent to a pair
 * of virtual reserves, so the constant-product result is exact while the trade
 * stays inside the current tick range and drifts once it crosses out of it.
 * That is why every quote from here is marked `estimated` — the slippage bound
 * on the swap itself is what stands between an optimistic estimate and a bad
 * fill, and it fails the trade closed rather than filling it badly.
 */
function estimateFromPool(
  snapshot: PoolSnapshot,
  amountIn: bigint,
  feePips: number,
): bigint {
  const { sqrtPriceX96, liquidity, inIsToken0 } = snapshot;
  if (liquidity <= 0n || sqrtPriceX96 <= 0n) return 0n;

  // x = L / sqrtP and y = L * sqrtP, both carried at X96 precision.
  const reserve0 = (liquidity * Q96) / sqrtPriceX96;
  const reserve1 = (liquidity * sqrtPriceX96) / Q96;
  const reserveIn = inIsToken0 ? reserve0 : reserve1;
  const reserveOut = inIsToken0 ? reserve1 : reserve0;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const netIn = (amountIn * BigInt(1_000_000 - Math.round(feePips))) / 1_000_000n;
  if (netIn <= 0n) return 0n;

  // Past roughly a third of price impact the trade has certainly left the tick
  // these reserves describe, and the constant-product answer stops meaning
  // anything. Returning nothing reads as "no route", which is honest; returning
  // the number would put a fiction on the receive line.
  if (netIn * 2n > reserveIn) return 0n;

  return (netIn * reserveOut) / (reserveIn + netIn);
}

/** Full execution quote: routes across fee tiers and measures depth cost. */
export async function quoteExactIn(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
): Promise<Quote | undefined> {
  if (amountIn <= 0n) return undefined;

  const curve = await findCurve(client, tokenIn, tokenOut);
  if (curve) return quoteAgainstCurve(curve, tokenIn, tokenOut, amountIn);

  const chainId = tokenIn.chainId;
  const dex = dexMeta(chainId);
  if (!dex) return undefined;

  const inAddress = routingAddress(tokenIn);
  const outAddress = routingAddress(tokenOut);
  if (inAddress.toLowerCase() === outAddress.toLowerCase()) return undefined;

  const pools = await findPools(client, chainId, inAddress, outAddress);
  if (pools.length === 0) return undefined;
  const probed = pools.slice(0, 4);

  const best = dex.quoter
    ? await quoteThroughQuoter(client, dex.quoter, probed, inAddress, outAddress, amountIn)
    : await quoteThroughPoolState(client, probed, inAddress, amountIn);
  if (!best) return undefined;

  const executionPrice =
    toFloat(best.amountOut, tokenOut.decimals) / toFloat(amountIn, tokenIn.decimals);
  const mid = await midPrice(client, tokenIn, tokenOut);
  const midValue = mid?.price ?? executionPrice;
  const impact = midValue > 0 ? Math.max(0, 1 - executionPrice / midValue) : 0;

  return {
    venue: "v3",
    fee: best.pool.fee,
    amountIn,
    amountOut: best.amountOut,
    midPrice: midValue,
    executionPrice,
    priceImpact: impact,
    gasEstimate: best.gasEstimate,
    pool: best.pool.address,
    estimated: best.estimated,
  };
}

type BestRoute = {
  pool: PoolRef;
  amountOut: bigint;
  gasEstimate: bigint;
  estimated?: boolean;
};

async function quoteThroughQuoter(
  client: PublicClient,
  quoter: `0x${string}`,
  pools: PoolRef[],
  inAddress: `0x${string}`,
  outAddress: `0x${string}`,
  amountIn: bigint,
): Promise<BestRoute | undefined> {
  const attempts = await Promise.allSettled(
    pools.map((pool) =>
      client.simulateContract({
        address: quoter,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: inAddress,
            tokenOut: outAddress,
            amountIn,
            fee: pool.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    ),
  );

  let best: BestRoute | undefined;
  attempts.forEach((attempt, index) => {
    if (attempt.status !== "fulfilled") return;
    const result = attempt.value.result as readonly [bigint, bigint, number, bigint];
    const amountOut = result[0];
    if (amountOut <= 0n) return;
    if (!best || amountOut > best.amountOut) {
      best = { pool: pools[index], amountOut, gasEstimate: result[3] };
    }
  });
  return best;
}

async function quoteThroughPoolState(
  client: PublicClient,
  pools: PoolRef[],
  inAddress: `0x${string}`,
  amountIn: bigint,
): Promise<BestRoute | undefined> {
  const snapshots = await Promise.all(pools.map((pool) => readPool(client, pool, inAddress)));

  let best: BestRoute | undefined;
  snapshots.forEach((snapshot) => {
    if (!snapshot) return;
    const amountOut = estimateFromPool(snapshot, amountIn, snapshot.pool.fee);
    if (amountOut <= 0n) return;
    if (!best || amountOut > best.amountOut) {
      best = { pool: snapshot.pool, amountOut, gasEstimate: 0n, estimated: true };
    }
  });
  return best;
}

/**
 * Prices a trade against a bonding curve with the curve's own arithmetic, so
 * what the interface shows is what the contract will settle — clamp, fee and
 * creator tax included.
 */
function quoteAgainstCurve(
  state: CurveState,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
): Quote | undefined {
  const buying = isCurveToken(state, tokenOut);
  const fill = buying ? quoteCurveBuy(state, amountIn) : quoteCurveSell(state, amountIn);
  if (!fill) return undefined;

  const mid = curveMidPrice(state, tokenIn, tokenOut);
  const executionPrice =
    toFloat(fill.amountOut, tokenOut.decimals) / toFloat(fill.spent, tokenIn.decimals);
  const midValue = mid ?? executionPrice;
  const impact = midValue > 0 ? Math.max(0, 1 - executionPrice / midValue) : 0;

  return {
    venue: "curve",
    fee: fill.fee,
    // A clamped buy spends less than it offered; the trade is still sent with
    // the full amount and the curve refunds the difference itself.
    amountIn,
    amountOut: fill.amountOut,
    midPrice: midValue,
    executionPrice,
    priceImpact: impact,
    gasEstimate: 0n,
    pool: state.curve,
    refund: fill.refund > 0n ? fill.refund : undefined,
    curveSide: buying ? "buy" : "sell",
  };
}
