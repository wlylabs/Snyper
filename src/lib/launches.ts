import type { Log, PublicClient } from "viem";
import { getAddress } from "viem";
import { CHAIN_META, dexMeta } from "./chains";
import { blockWindow, scanBack } from "./logscan";
import { PONS_V1_FACTORY, PONS_V2_FACTORY, readPonsLaunches, type PonsLaunch } from "./pons";

/**
 * Every memecoin the Pons launchpad has minted lately, read off the chain.
 *
 * The app already knew what a launch was — `readPonsLaunch` asks the factory
 * about one pasted address — but it had no way to ask the opposite question:
 * what has been launched? That is the reason the picker was three tokens deep
 * on a chain whose whole point is memecoins. A launch is not an ERC-20 the
 * reader has been airdropped, so the wallet scan never sees it, and it is
 * usually minutes old, so no indexer carries it either.
 *
 * What follows reads the factories' own logs. It deliberately does not decode
 * them: the launch event's signature is not published anywhere this app can
 * verify, and an ABI guessed from a block explorer would silently index nothing
 * the day it was wrong. Instead every 32-byte word in every factory log that
 * has the shape of an address is treated as a candidate, and the factory itself
 * is then asked which of them it minted. Deployers, pair tokens and curves fall
 * out on that question; the tokens survive it. The answer is the launchpad's
 * own record either way, which is the only authority this app recognises about
 * what a memecoin is.
 */

/** A launch as the index found it. */
export type LaunchListing = {
  address: `0x${string}`;
  launch: PonsLaunch;
  /** Highest block at which a factory log named this token, so newest first. */
  block: bigint;
};

export type LaunchIndex = {
  launches: LaunchListing[];
  /** How many blocks back from the head the scan reached. */
  scannedBlocks: number;
  /** True when the request budget ran out before the window was covered. */
  partial: boolean;
};

/**
 * How far back to look. A launch that is a fortnight old is not news, and the
 * budget below reaches nothing like that far on a fast chain anyway — the
 * window is the ceiling, the budget is what actually binds.
 */
const WINDOW_DAYS = 14;

/**
 * More requests than the wallet scan gets. This walk has one job and runs on a
 * page the reader opened to see new launches, where reaching further back is
 * worth the wait; the wallet scan competes with a balance read on the same tab.
 */
const MAX_REQUESTS = 20;

/**
 * Addresses to confirm with the factory. Each one costs three calls inside a
 * multicall, so this is a ceiling on one round trip's size rather than on the
 * number of launches — a launch event names a handful of addresses, only one of
 * which is the token.
 */
const MAX_CANDIDATES = 240;

/** Launches carried back to the caller, newest first. */
const MAX_LAUNCHES = 60;

const ZERO_WORD = "0".repeat(24);

/**
 * Every word in a log that could be a left-padded address. Topics after the
 * signature and the data body are treated alike: which of the two a launch
 * event puts its token in depends on whether the argument is indexed, and that
 * is exactly the detail this module refuses to assume.
 */
function candidateAddresses(log: Log): `0x${string}`[] {
  const words: string[] = log.topics.slice(1).map((topic) => topic.slice(2));
  const data = log.data.slice(2);
  for (let index = 0; index + 64 <= data.length; index += 64) {
    words.push(data.slice(index, index + 64));
  }

  const found: `0x${string}`[] = [];
  for (const word of words) {
    if (word.length !== 64) continue;
    // A left-padded address has twelve zero bytes in front of it. A uint256, a
    // bool or a fee tier does not look like this; a large number does not either.
    if (word.slice(0, 24) !== ZERO_WORD) continue;
    const body = word.slice(24);
    if (body === "0".repeat(40)) continue;
    try {
      found.push(getAddress(`0x${body}`));
    } catch {
      // Not an address after all.
    }
  }
  return found;
}

/** Contracts a launch event names that are never the launched token. */
function knownAddresses(chainId: number): Set<string> {
  const venue = dexMeta(chainId);
  const known = [
    PONS_V1_FACTORY,
    PONS_V2_FACTORY,
    venue?.factory,
    venue?.router,
    venue?.quoter,
    venue?.wrapped,
    venue?.stable,
  ];
  return new Set(
    known.filter((address): address is `0x${string}` => Boolean(address)).map((address) =>
      address.toLowerCase(),
    ),
  );
}

/**
 * Indexes recent launches on this chain.
 *
 * Failure is quiet by design and costs only the list: a reader whose endpoint
 * refuses `eth_getLogs` still has every other way into a token, and an empty
 * launch list is a truthful thing for this to return.
 */
export async function indexPonsLaunches(
  client: PublicClient,
  chainId: number,
  options: { windowBlocks?: bigint } = {},
): Promise<LaunchIndex> {
  if (!CHAIN_META[chainId]) return { launches: [], scannedBlocks: 0, partial: false };

  const head = await client.getBlockNumber();
  const windowSize = options.windowBlocks ?? blockWindow(chainId, WINDOW_DAYS);

  /* Newest block each candidate was seen at, which is the order to return in. */
  const seen = new Map<string, { address: `0x${string}`; block: bigint }>();

  const { scanned, partial } = await scanBack(
    head,
    windowSize,
    async (range) => {
      const logs = await client.getLogs({
        address: [PONS_V1_FACTORY, PONS_V2_FACTORY],
        ...range,
      });
      for (const log of logs) {
        const block = log.blockNumber ?? 0n;
        for (const address of candidateAddresses(log)) {
          const key = address.toLowerCase();
          const held = seen.get(key);
          if (!held || block > held.block) seen.set(key, { address, block });
        }
      }
    },
    { maxRequests: MAX_REQUESTS },
  );

  const skip = knownAddresses(chainId);
  /* Newest first, so a budget that clips the candidate list clips the oldest. */
  const candidates = [...seen.values()]
    .filter((entry) => !skip.has(entry.address.toLowerCase()))
    .sort((a, b) => (b.block > a.block ? 1 : b.block < a.block ? -1 : 0))
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    return { launches: [], scannedBlocks: Number(scanned), partial };
  }

  const confirmed = await readPonsLaunches(
    client,
    candidates.map((entry) => entry.address),
  );

  const launches: LaunchListing[] = [];
  for (const entry of candidates) {
    const launch = confirmed.get(entry.address.toLowerCase());
    if (!launch) continue;
    launches.push({ address: entry.address, launch, block: entry.block });
    if (launches.length >= MAX_LAUNCHES) break;
  }

  return { launches, scannedBlocks: Number(scanned), partial };
}
