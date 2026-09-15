import type { PublicClient } from "viem";
import { zeroAddress } from "viem";
import { erc20Abi, quoterV2Abi, v3FactoryAbi, v3PoolAbi } from "./abi";
import { dexMeta } from "./chains";
import { routingAddress, type Token } from "./tokens";

export type PoolRef = {
  address: `0x${string}`;
  fee: number;
  liquidity: bigint;
};

export type Quote = {
  /** Fee tier of the pool the quote routed through, in hundredths of a bip. */
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
  pool: `0x${string}`;
};

const POOL_TTL_MS = 10 * 60 * 1000;
const poolCache = new Map<string, { at: number; pools: PoolRef[] }>();

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

/** Pool mid price for a pair, independent of trade size. */
export async function midPrice(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
): Promise<{ price: number; pool: PoolRef } | undefined> {
  const chainId = tokenIn.chainId;
  const inAddress = routingAddress(tokenIn);
  const outAddress = routingAddress(tokenOut);
  if (inAddress.toLowerCase() === outAddress.toLowerCase()) return undefined;

  const pools = await findPools(client, chainId, inAddress, outAddress);
  const pool = pools[0];
  if (!pool) return undefined;

  const [slot0, token0] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: pool.address, abi: v3PoolAbi, functionName: "slot0" as const },
      { address: pool.address, abi: v3PoolAbi, functionName: "token0" as const },
    ],
  });

  const sqrtPriceX96 = (slot0 as readonly [bigint, number, number, number, number, number, boolean])[0];
  const inIsToken0 = (token0 as `0x${string}`).toLowerCase() === inAddress.toLowerCase();
  const price = rateFromSqrtPrice(sqrtPriceX96, inIsToken0, tokenIn.decimals, tokenOut.decimals);
  if (!Number.isFinite(price) || price <= 0) return undefined;
  return { price, pool };
}

function toFloat(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/** Full execution quote: routes across fee tiers and measures depth cost. */
export async function quoteExactIn(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
): Promise<Quote | undefined> {
  if (amountIn <= 0n) return undefined;
  const chainId = tokenIn.chainId;
  const dex = dexMeta(chainId);
  if (!dex) return undefined;

  const inAddress = routingAddress(tokenIn);
  const outAddress = routingAddress(tokenOut);
  if (inAddress.toLowerCase() === outAddress.toLowerCase()) return undefined;

  const pools = await findPools(client, chainId, inAddress, outAddress);
  if (pools.length === 0) return undefined;

  const attempts = await Promise.allSettled(
    pools.slice(0, 4).map((pool) =>
      client.simulateContract({
        address: dex.quoter,
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

  let best: { pool: PoolRef; amountOut: bigint; gasEstimate: bigint } | undefined;
  attempts.forEach((attempt, index) => {
    if (attempt.status !== "fulfilled") return;
    const result = attempt.value.result as readonly [bigint, bigint, number, bigint];
    const amountOut = result[0];
    const gasEstimate = result[3];
    if (amountOut <= 0n) return;
    if (!best || amountOut > best.amountOut) {
      best = { pool: pools[index], amountOut, gasEstimate };
    }
  });
  if (!best) return undefined;

  const executionPrice = toFloat(best.amountOut, tokenOut.decimals) / toFloat(amountIn, tokenIn.decimals);
  const mid = await midPrice(client, tokenIn, tokenOut);
  const midValue = mid?.price ?? executionPrice;
  const impact = midValue > 0 ? Math.max(0, 1 - executionPrice / midValue) : 0;

  return {
    fee: best.pool.fee,
    amountIn,
    amountOut: best.amountOut,
    midPrice: midValue,
    executionPrice,
    priceImpact: impact,
    gasEstimate: best.gasEstimate,
    pool: best.pool.address,
  };
}
