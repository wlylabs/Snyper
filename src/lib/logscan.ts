import type { PublicClient } from "viem";
import { CHAIN_META } from "./chains";

/**
 * Walking a public endpoint's log history backwards, which is the only way this
 * app finds anything it was not told about.
 *
 * Every public RPC caps both the block span of one `eth_getLogs` and the number
 * of results it will answer with, and neither cap is advertised — the request
 * simply fails. So a scan cannot be one call over the whole window; it has to
 * be chunked, and the chunk has to shrink whenever the endpoint says no. That
 * logic was written once for the wallet scan and is now shared with the
 * launchpad index, because both want the same thing: as far back as the request
 * budget reaches, and an honest answer about where they stopped.
 */

/** Requests one walk may spend before it reports what it managed to cover. */
const MAX_REQUESTS = 14;
const MAX_CHUNK = 10_000n;
const MIN_CHUNK = 500n;

export type ScanBudget = {
  maxRequests?: number;
  maxChunk?: bigint;
  minChunk?: bigint;
};

export type ScanResult = {
  /** How many blocks back from the head the walk actually reached. */
  scanned: bigint;
  /** True when the budget ran out before the window was covered. */
  partial: boolean;
};

/**
 * Calls `read` over successive block ranges, newest first, until the window is
 * covered or the budget is spent. A rejected range is retried at half the
 * chunk size rather than abandoned: a range rejection and a result-size
 * rejection look identical from here, and both are answered by asking for less.
 */
export async function scanBack(
  head: bigint,
  windowSize: bigint,
  read: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<void>,
  budget: ScanBudget = {},
): Promise<ScanResult> {
  const maxRequests = budget.maxRequests ?? MAX_REQUESTS;
  const maxChunk = budget.maxChunk ?? MAX_CHUNK;
  const minChunk = budget.minChunk ?? MIN_CHUNK;

  const floor = head > windowSize ? head - windowSize : 0n;
  let toBlock = head;
  let chunk = maxChunk;
  let requests = 0;

  while (toBlock > floor && requests < maxRequests) {
    const span = chunk - 1n;
    const fromBlock = toBlock > floor + span ? toBlock - span : floor;
    requests += 1;
    try {
      await read({ fromBlock, toBlock });
      if (fromBlock === floor) return { scanned: head - floor, partial: false };
      toBlock = fromBlock - 1n;
    } catch {
      // Range or result-size rejection: retry the same window, smaller.
      if (chunk <= minChunk) break;
      chunk = chunk / 2n > minChunk ? chunk / 2n : minChunk;
    }
  }

  return { scanned: head - toBlock, partial: toBlock > floor };
}

/**
 * A window of `days` expressed in blocks, derived from the chain's own block
 * time so a 100 ms chain and a 12 s chain both land on a sensible number.
 */
export function blockWindow(chainId: number, days: number): bigint {
  const blockMs = CHAIN_META[chainId]?.chain.blockTime;
  const blockSeconds = blockMs ? blockMs / 1000 : 12;
  const blocks = Math.round((days * 24 * 60 * 60) / Math.max(0.05, blockSeconds));
  return BigInt(Math.min(2_000_000, Math.max(50_000, blocks)));
}

/** The chain head, or nothing when the endpoint will not say. */
export async function chainHead(client: PublicClient): Promise<bigint | undefined> {
  try {
    return await client.getBlockNumber();
  } catch {
    return undefined;
  }
}
