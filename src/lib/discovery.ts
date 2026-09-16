import type { PublicClient } from "viem";
import { getAddress, parseAbiItem } from "viem";
import { erc20Abi } from "./abi";
import { CHAIN_META } from "./chains";
import { blockWindow, scanBack } from "./logscan";
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

/** Roughly a fortnight of history, which is what one budget reaches. */
const WINDOW_DAYS = 14;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Reading metadata for more than this many contracts is not worth the RPC. */
const MAX_CANDIDATES = 80;

/**
 * Walks back from the chain head collecting ERC-20 Transfer logs addressed to
 * the wallet. The chunking and the shrink-on-rejection live in `logscan.ts`,
 * which the launchpad index walks with too.
 */
async function collectContracts(
  client: PublicClient,
  address: `0x${string}`,
  head: bigint,
  windowSize: bigint,
): Promise<{ contracts: Set<string>; scanned: bigint; partial: boolean }> {
  const contracts = new Set<string>();

  const { scanned, partial } = await scanBack(head, windowSize, async (range) => {
    const logs = await client.getLogs({
      event: TRANSFER_EVENT,
      args: { to: address },
      ...range,
    });
    for (const log of logs) {
      // ERC-721 shares this topic but carries a third indexed argument.
      if (log.topics.length !== 3) continue;
      contracts.add(getAddress(log.address));
    }
  });

  return { contracts, scanned, partial };
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
  const windowSize = options.windowBlocks ?? blockWindow(chainId, WINDOW_DAYS);
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
