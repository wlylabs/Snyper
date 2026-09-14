import type { PublicClient } from "viem";
import { getAddress, parseAbiItem } from "viem";
import { erc20Abi } from "./abi";
import { CHAIN_META } from "./chains";
import type { Token } from "./tokens";

/** A token found by scanning the wallet's own transfer history. */
export type DiscoveredToken = Token & {
  balance: bigint;
  totalSupply?: bigint;
  /** When this scan saw it, so a later run can tell fresh finds from old ones. */
  discoveredAt: number;
};

export type DiscoveryResult = {
  tokens: DiscoveredToken[];
  /** How many blocks back from the head the scan actually reached. */
  scannedBlocks: number;
  /** True when the block budget ran out before the window was covered. */
  partial: boolean;
};

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const MAX_REQUESTS = 14;
const MAX_CHUNK = 10_000n;
const MIN_CHUNK = 500n;
/** Reading metadata for more than this many contracts is not worth the RPC. */
const MAX_CANDIDATES = 80;

/**
 * Walks back from the chain head collecting ERC-20 Transfer logs addressed to
 * the wallet. Public endpoints cap both block range and result size, so the
 * window is chunked and the chunk shrinks whenever a request is rejected.
 */
async function collectContracts(
  client: PublicClient,
  address: `0x${string}`,
  head: bigint,
  windowSize: bigint,
): Promise<{ contracts: Set<string>; scanned: bigint; partial: boolean }> {
  const contracts = new Set<string>();
  const floor = head > windowSize ? head - windowSize : 0n;
  let toBlock = head;
  let chunk = MAX_CHUNK;
  let requests = 0;

  while (toBlock > floor && requests < MAX_REQUESTS) {
    const span = chunk - 1n;
    const fromBlock = toBlock > floor + span ? toBlock - span : floor;
    requests += 1;
    try {
      const logs = await client.getLogs({
        event: TRANSFER_EVENT,
        args: { to: address },
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        // ERC-721 shares this topic but carries a third indexed argument.
        if (log.topics.length !== 3) continue;
        contracts.add(getAddress(log.address));
      }
      if (fromBlock === floor) {
        return { contracts, scanned: head - floor, partial: false };
      }
      toBlock = fromBlock - 1n;
    } catch {
      // Range or result-size rejection: retry the same window, smaller.
      if (chunk <= MIN_CHUNK) break;
      chunk = chunk / 2n > MIN_CHUNK ? chunk / 2n : MIN_CHUNK;
    }
  }

  return { contracts, scanned: head - toBlock, partial: toBlock > floor };
}

/**
 * Finds every ERC-20 the wallet has actually received on this chain, including
 * tokens no curated list carries. Metadata and balances are read from the
 * contracts themselves — there is no indexer and no third-party token feed.
 */
export async function discoverWalletTokens(
  client: PublicClient,
  chainId: number,
  address: `0x${string}`,
  options: { windowBlocks?: bigint } = {},
): Promise<DiscoveryResult> {
  if (!CHAIN_META[chainId]) return { tokens: [], scannedBlocks: 0, partial: false };

  const head = await client.getBlockNumber();
  const windowSize = options.windowBlocks ?? defaultWindow(chainId);
  const { contracts, scanned, partial } = await collectContracts(
    client,
    address,
    head,
    windowSize,
  );

  const candidates = [...contracts].slice(0, MAX_CANDIDATES) as `0x${string}`[];
  if (candidates.length === 0) {
    return { tokens: [], scannedBlocks: Number(scanned), partial };
  }

  const reads = await client.multicall({
    allowFailure: true,
    contracts: candidates.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
      { address: token, abi: erc20Abi, functionName: "name" as const },
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "balanceOf" as const, args: [address] as const },
      { address: token, abi: erc20Abi, functionName: "totalSupply" as const },
    ]),
  });

  const now = Date.now();
  const tokens: DiscoveredToken[] = [];
  candidates.forEach((token, index) => {
    const slice = reads.slice(index * 5, index * 5 + 5);
    const [symbol, name, decimals, balance, supply] = slice;
    // A contract that cannot answer symbol/decimals/balanceOf is not an ERC-20.
    if (
      symbol?.status !== "success" ||
      decimals?.status !== "success" ||
      balance?.status !== "success"
    ) {
      return;
    }
    const held = balance.result as bigint;
    if (held <= 0n) return;

    tokens.push({
      chainId,
      address: token,
      symbol: String(symbol.result),
      name: name?.status === "success" ? String(name.result) : String(symbol.result),
      decimals: Number(decimals.result),
      balance: held,
      totalSupply: supply?.status === "success" ? (supply.result as bigint) : undefined,
      discoveredAt: now,
    });
  });

  return { tokens, scannedBlocks: Number(scanned), partial };
}

/**
 * Roughly a fortnight of history, derived from the chain's own block time so a
 * 100 ms chain and a 12 s chain both land on a sensible window.
 */
function defaultWindow(chainId: number): bigint {
  const seconds = CHAIN_META[chainId]?.chain.blockTime;
  const blockSeconds = seconds ? seconds / 1000 : 12;
  const blocks = Math.round((14 * 24 * 60 * 60) / Math.max(0.05, blockSeconds));
  return BigInt(Math.min(2_000_000, Math.max(50_000, blocks)));
}
