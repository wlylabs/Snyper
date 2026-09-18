import type { PublicClient } from "viem";
import { decodeEventLog, getAddress, parseAbiItem } from "viem";
import { scanBack } from "./logscan";
import { V4_POOL_MANAGER } from "./v4";

/**
 * What has actually changed hands, on both venues, read from their swap logs.
 *
 * The index used to rank by depth, because depth was the only thing that could
 * be read for a v3 pool. Uniswap v4 broke that: its pools all live inside one
 * singleton, so no balance belongs to any one of them, and the obvious
 * substitute — active liquidity converted to a virtual reserve — turned out not
 * to be the same quantity at all. Measured against 24 live v3 pools, the
 * virtual reserve ran a median of 604 times the money actually in the pool and
 * in one case 477 billion times it, because liquidity squeezed into a narrow
 * band inflates it without end. Ranking the two side by side would have been
 * arithmetic on two different units.
 *
 * Volume is the one figure both venues report the same way, and it was the
 * better ranking from the start: depth is an offer a launch can mint itself,
 * volume is the part somebody had to pay for. It was skipped the first time
 * round because a whole chain's swap history will not come back through one
 * query — and that is still true, but it was the wrong conclusion. Measured at
 * roughly one swap a block on v3 and two on v4, an hour of it fits in a handful
 * of chunked queries.
 *
 * Both events carry `sqrtPriceX96` as well, so every pool that traded also
 * hands back its own price with no further reads.
 */

/** Uniswap v3's pool-level swap. The emitter is the pool. */
const V3_SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const V3_SWAP_TOPIC =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67" as const;

/** Uniswap v4's swap, emitted by the singleton with the pool as its first topic. */
const V4_SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const V4_SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f" as const;

/**
 * Blocks one pass covers. At a hundred milliseconds a block this is about
 * seventeen minutes — long enough to mean something on a chain that opens five
 * hundred pools a day, and short enough that the scan does not use up the
 * endpoint's patience before the reads that come after it. Reaching twice as
 * far was tried, and cost every v3 pool read behind it.
 */
export const SWAP_WINDOW_BLOCKS = 10_000n;

/**
 * Chunking. The ceiling is on results rather than on blocks, and v4 carries
 * about two swaps a block, so three thousand blocks is the largest ask that
 * reliably stays under it. A rejected range is halved by `scanBack`.
 */
const SWAP_BUDGET = {
  maxRequests: 24,
  maxChunk: 3_000n,
  minChunk: 250n,
} as const;

/** One pool's trading over the window, before anyone knows what it trades. */
export type TradedPool = {
  venue: "v3" | "v4";
  /** Pool address on v3, pool id on v4. */
  key: string;
  /**
   * Absolute amounts moved on each side. Which of the two is the quote cannot
   * be known here — the swap log does not name its currencies — so both are
   * carried and the caller picks once it has resolved the pair.
   */
  amount0: bigint;
  amount1: bigint;
  swaps: number;
  /** Price at the last swap seen, which is as current as a traded pool gets. */
  sqrtPriceX96: bigint;
  liquidity: bigint;
};

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function fold(
  into: Map<string, TradedPool>,
  venue: "v3" | "v4",
  key: string,
  args: {
    amount0: bigint;
    amount1: bigint;
    sqrtPriceX96: bigint;
    liquidity: bigint;
  },
): void {
  const held = into.get(key);
  if (held) {
    held.amount0 += abs(args.amount0);
    held.amount1 += abs(args.amount1);
    held.swaps += 1;
    // Logs arrive newest-range first, so the first price seen is the latest.
    return;
  }
  into.set(key, {
    venue,
    key,
    amount0: abs(args.amount0),
    amount1: abs(args.amount1),
    swaps: 1,
    sqrtPriceX96: args.sqrtPriceX96,
    liquidity: args.liquidity,
  });
}

export type SwapScan = {
  pools: Map<string, TradedPool>;
  /** True when the block budget ran out before the window was covered. */
  partial: boolean;
};

/**
 * Every pool that traded in the window, on both venues.
 *
 * The two scans are deliberately separate rather than one topic-less sweep:
 * a query with no address and no topic would be most of the chain's log volume,
 * and v3's swap is emitted by thousands of pools while v4's comes from a single
 * contract. Each is allowed to fail on its own — one venue missing is a shorter
 * list, and the caller is told the window was not covered.
 */
export async function scanSwaps(
  client: PublicClient,
  head: bigint,
  windowBlocks: bigint = SWAP_WINDOW_BLOCKS,
): Promise<SwapScan> {
  const pools = new Map<string, TradedPool>();

  // v3 first and v4 after, with a pause between: these are the two heaviest
  // queries in the build, and running them back to back is what leaves the
  // endpoint refusing everything that follows.
  const v3 = await scanBack(
    head,
    windowBlocks,
    async (range) => {
      const logs = await client.getLogs({ event: V3_SWAP, ...range });
      for (const log of logs) {
        if (!log.address) continue;
        fold(pools, "v3", getAddress(log.address).toLowerCase(), {
          amount0: log.args.amount0 ?? 0n,
          amount1: log.args.amount1 ?? 0n,
          sqrtPriceX96: log.args.sqrtPriceX96 ?? 0n,
          liquidity: log.args.liquidity ?? 0n,
        });
      }
    },
    SWAP_BUDGET,
  ).catch(() => ({ partial: true }));

  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const v4 = await scanBack(
    head,
    windowBlocks,
    async (range) => {
      const logs = await client.getLogs({
        address: V4_POOL_MANAGER,
        event: V4_SWAP,
        ...range,
      });
      for (const log of logs) {
        const id = log.topics[1];
        if (!id) continue;
        fold(pools, "v4", id.toLowerCase(), {
          amount0: log.args.amount0 ?? 0n,
          amount1: log.args.amount1 ?? 0n,
          sqrtPriceX96: log.args.sqrtPriceX96 ?? 0n,
          liquidity: log.args.liquidity ?? 0n,
        });
      }
    },
    SWAP_BUDGET,
  ).catch(() => ({ partial: true }));

  return { pools, partial: Boolean(v3.partial) || Boolean(v4.partial) };
}

export { V3_SWAP_TOPIC, V4_SWAP_TOPIC, V3_SWAP, V4_SWAP, decodeEventLog };
