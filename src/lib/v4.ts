import type { PublicClient } from "viem";
import {
  decodeEventLog,
  encodePacked,
  getAddress,
  keccak256,
  parseAbiItem,
  toHex,
  zeroAddress,
} from "viem";
import { poolManagerAbi } from "./abi";
import { NATIVE } from "./native";
import type { Token } from "./tokens";
import { dexMeta } from "./chains";
import { scanBack } from "./logscan";

/**
 * Reading Uniswap v4 on Robinhood Chain.
 *
 * This exists because the app was blind in exactly the place it could least
 * afford to be. A Pons V2 launch trades on its own bonding curve and then
 * graduates into a v4 pool; `quote.ts` stops resolving a token the moment that
 * happens, so a position went unpriced, a portfolio row went blank and a snype
 * stopped ticking at the point the token had actually succeeded.
 *
 * It turned out to be the larger half of the chain as well. Measured on
 * 2026-09-18: v4's PoolManager initialised 2,168 pools in five and a half
 * hours — around twenty times the rate the v3 factory opens them — against
 * 4,619 v3 pools in eleven days. Whatever else is true of this chain, most of
 * it is on v4.
 *
 * What this module does NOT do is trade. A v4 swap goes through the Universal
 * Router with Permit2 and has to reckon with hooks, and 530 of those 2,168
 * pools carried one. Pricing is safe without any of that, so pricing is all
 * this does: it is wired into `midPrice`, which is what values a portfolio and
 * ticks a snype, and deliberately not into `quoteExactIn`, which is what signs.
 * A token that can only be priced here is one the app shows honestly and
 * declines to route, rather than one it offers a swap that would fail.
 */

/**
 * The singleton every v4 pool lives in. Read off chain 4663 rather than taken
 * from a deployment list: it is the contract that emitted every `Initialize`
 * event on the chain, which is the only definition that cannot be stale.
 */
export const V4_POOL_MANAGER: `0x${string}` = getAddress(
  process.env.NEXT_PUBLIC_V4_POOL_MANAGER?.trim() ||
    "0x8366a39cc670b4001a1121b8f6a443a643e40951",
);

const INITIALIZE = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

/** Topic of the event above, which is also how a pool is found. */
const INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as const;

/**
 * Where `_pools` sits in the PoolManager's storage, so `extsload` can reach a
 * pool's state without a helper contract deployed beside it.
 *
 * Six is not read from an ABI anywhere — the mapping is internal and nothing
 * publishes it — so it was confirmed against the chain instead: walking slots
 * zero upward for a pool whose `Initialize` event had just been read, six is
 * the one whose first word carries back that pool's own `sqrtPriceX96`.
 */
const POOLS_SLOT = 6n;

/** A v4 pool key, which is also its identity: the id is the hash of these. */
export type V4Pool = {
  id: `0x${string}`;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  /** Static fee in hundredths of a bip, or the dynamic-fee flag. */
  fee: number;
  tickSpacing: number;
  /** Zero when the pool has no hook attached. */
  hooks: `0x${string}`;
};

export type V4PoolState = {
  sqrtPriceX96: bigint;
  tick: number;
  /** Fee actually in force, which for a dynamic-fee pool is set by its hook. */
  lpFee: number;
  liquidity: bigint;
};

/** The flag a pool sets instead of a fee when its hook decides one per swap. */
export const DYNAMIC_FEE_FLAG = 0x800000;

export function hasDynamicFee(fee: number): boolean {
  return fee === DYNAMIC_FEE_FLAG;
}

/**
 * How v4 names the chain's coin. The app carries a sentinel for native currency
 * and v4 carries the zero address; a pool between ether and a token is keyed
 * with the latter, so every lookup has to translate before it asks.
 */
export function v4Currency(token: Token): `0x${string}` {
  return token.native || token.address.toLowerCase() === NATIVE.toLowerCase()
    ? zeroAddress
    : token.address;
}

/** Storage slot holding a pool's `Slot0`. Liquidity is three words further on. */
function stateSlot(id: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(["bytes32", "uint256"], [id, POOLS_SLOT]));
}

function topicAddress(value: string): `0x${string}` {
  return getAddress(`0x${value.slice(26)}`);
}

/**
 * Every v4 pool one currency sits in, over the whole chain.
 *
 * Both currencies are indexed on `Initialize`, which is what makes this cheap
 * enough to do on demand: two filtered queries cover all sixty-six million
 * blocks in about three seconds, and there is no window to miss a pool in.
 * That matters more here than it would on v3 — a graduated launch's pool was
 * opened once, at graduation, and nothing about it is recent.
 */
export async function findV4Pools(
  client: PublicClient,
  currency: `0x${string}`,
): Promise<V4Pool[]> {
  const padded = `0x${currency.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

  const sides = await Promise.all(
    [
      [INITIALIZE_TOPIC, null, padded],
      [INITIALIZE_TOPIC, null, null, padded],
    ].map((topics) =>
      client
        .request({
          method: "eth_getLogs",
          params: [{ address: V4_POOL_MANAGER, topics, fromBlock: "0x0", toBlock: "latest" }],
        } as never)
        .catch(() => [] as unknown[]),
    ),
  );

  const pools: V4Pool[] = [];
  for (const logs of sides) {
    for (const log of logs as { topics: string[]; data: `0x${string}` }[]) {
      try {
        const { args } = decodeEventLog({
          abi: [INITIALIZE],
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        pools.push({
          id: log.topics[1] as `0x${string}`,
          currency0: topicAddress(log.topics[2]),
          currency1: topicAddress(log.topics[3]),
          fee: Number(args.fee),
          tickSpacing: Number(args.tickSpacing),
          hooks: getAddress(args.hooks),
        });
      } catch {
        // A log this ABI cannot read is a log from something else.
      }
    }
  }
  return pools;
}

/**
 * A pool's live state, read straight out of the singleton's storage.
 *
 * `Slot0` packs four values into one word — the sqrt price in the low 160 bits,
 * then tick, protocol fee and LP fee above it — and liquidity is a word of its
 * own three slots further into the struct.
 */
export async function readV4State(
  client: PublicClient,
  id: `0x${string}`,
): Promise<V4PoolState | undefined> {
  const slot = stateSlot(id);
  const reads = await client.multicall({
    allowFailure: true,
    contracts: [
      {
        address: V4_POOL_MANAGER,
        abi: poolManagerAbi,
        functionName: "extsload" as const,
        args: [slot] as const,
      },
      {
        address: V4_POOL_MANAGER,
        abi: poolManagerAbi,
        functionName: "extsload" as const,
        args: [toHex(BigInt(slot) + 3n, { size: 32 })] as const,
      },
    ],
  });

  const [slot0, liquidity] = reads;
  if (slot0.status !== "success") return undefined;

  const packed = BigInt(slot0.result as `0x${string}`);
  const sqrtPriceX96 = packed & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) return undefined;

  // `tick` is a signed 24-bit field, so the top bit carries the sign.
  const rawTick = Number((packed >> 160n) & 0xffffffn);
  const tick = rawTick >= 0x800000 ? rawTick - 0x1000000 : rawTick;

  return {
    sqrtPriceX96,
    tick,
    lpFee: Number((packed >> 208n) & 0xffffffn),
    liquidity:
      liquidity.status === "success" ? BigInt(liquidity.result as `0x${string}`) : 0n,
  };
}

/** The chain's own money, which is what must never be the searched side. */
function isVenueAsset(token: Token): boolean {
  if (token.native) return true;
  const dex = dexMeta(token.chainId);
  if (!dex) return false;
  const address = token.address.toLowerCase();
  return (
    address === dex.wrapped.toLowerCase() ||
    Boolean(dex.stable && address === dex.stable.toLowerCase())
  );
}

/** Whether a pool pairs exactly these two currencies, in either order. */
function pairs(pool: V4Pool, a: `0x${string}`, b: `0x${string}`): boolean {
  const [x, y] = [pool.currency0.toLowerCase(), pool.currency1.toLowerCase()];
  const [p, q] = [a.toLowerCase(), b.toLowerCase()];
  return (x === p && y === q) || (x === q && y === p);
}

export type V4Quote = {
  pool: V4Pool;
  state: V4PoolState;
  /** `tokenOut` per `tokenIn`, decimals accounted for. */
  price: number;
};

/**
 * The deepest v4 pool for a pair, priced.
 *
 * A token can sit in several pools that differ only by hook or tick spacing, so
 * the one with the most liquidity behind it wins — the same rule v3 routing
 * already uses, and for the same reason: it is the price the most money agrees
 * with. A pool with no liquidity at all is skipped rather than priced, because
 * an initialised pool nobody funded still carries the sqrt price it was opened
 * at and would otherwise report a number that no trade could get.
 */
export async function v4MidPrice(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
  rate: (
    sqrtPriceX96: bigint,
    inIsCurrency0: boolean,
    decimalsIn: number,
    decimalsOut: number,
  ) => number,
): Promise<V4Quote | undefined> {
  const inCurrency = v4Currency(tokenIn);
  const outCurrency = v4Currency(tokenOut);
  if (inCurrency.toLowerCase() === outCurrency.toLowerCase()) return undefined;

  /*
   * Search by the side that is not the chain's own money.
   *
   * The dollar and the wrapped coin each sit in thousands of pools, and asking
   * for all of them trips the endpoint's ten-thousand-log ceiling — which comes
   * back as no pools rather than as an error, so searching the wrong side does
   * not fail loudly, it just silently prices nothing. The token being looked up
   * sits in a handful, which is the query worth making.
   */
  const search = isVenueAsset(tokenIn) && !isVenueAsset(tokenOut) ? outCurrency : inCurrency;

  const found = await findV4Pools(client, search);
  const candidates = found.filter((pool) => pairs(pool, inCurrency, outCurrency));
  if (candidates.length === 0) return undefined;

  const states = await Promise.all(
    candidates.map(async (pool) => ({ pool, state: await readV4State(client, pool.id) })),
  );

  let best: V4Quote | undefined;
  for (const { pool, state } of states) {
    if (!state || state.liquidity <= 0n) continue;
    const price = rate(
      state.sqrtPriceX96,
      pool.currency0.toLowerCase() === inCurrency.toLowerCase(),
      tokenIn.decimals,
      tokenOut.decimals,
    );
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!best || state.liquidity > best.state.liquidity) best = { pool, state, price };
  }
  return best;
}

/**
 * Every v4 pool quoted against one of the chain's own assets, keyed by pool id.
 *
 * A swap log names its pool by id and nothing else — not its currencies, not
 * its fee — so an index built from swaps cannot say what any of them trades
 * until something maps the id back to a pool key. Asking per pool is not an
 * option: the id is indexed, but resolving eight hundred of them in parallel
 * returned nothing and took forty seconds, and there are thousands.
 *
 * So the map is built from the other end. Both currencies are indexed on
 * `Initialize`, so one filtered scan per asset per side collects every pool
 * that could ever be funded from this app, and the swap scan is matched against
 * it. Pools older than the window are missed rather than guessed at, which the
 * caller reports.
 */
/**
 * The map, kept between calls.
 *
 * Pool keys are append-only: a pool is initialised once and its currencies
 * never change, so nothing already in here can go stale. Rebuilding it from
 * scratch every time cost twenty-five seconds and tens of thousands of logs,
 * and spent enough of the endpoint's patience that reads queued behind it came
 * back rate-limited. After the first pass only the blocks since the last one
 * are scanned.
 */
const keyCache = {
  keys: new Map<string, V4Pool>(),
  /** Head the cache was last brought up to, or zero when it is empty. */
  head: 0n,
};

export function resetV4KeyCache(): void {
  keyCache.keys = new Map();
  keyCache.head = 0n;
}

export async function indexV4PoolKeys(
  client: PublicClient,
  money: readonly `0x${string}`[],
  head: bigint,
  windowBlocks: bigint,
): Promise<{ keys: Map<string, V4Pool>; partial: boolean }> {
  /* First pass covers the window; every one after it covers only what is new,
     which is a few thousand blocks rather than ten million. */
  const span = keyCache.head > 0n && head > keyCache.head ? head - keyCache.head : windowBlocks;
  if (keyCache.head > 0n && head <= keyCache.head) {
    return { keys: keyCache.keys, partial: false };
  }

  const filters: (string | null)[][] = [];
  for (const asset of money) {
    const padded = `0x${asset.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
    filters.push([INITIALIZE_TOPIC, null, padded]);
    filters.push([INITIALIZE_TOPIC, null, null, padded]);
  }

  let partial = false;
  for (const topics of filters) {
    const result = await scanBack(
      head,
      span,
      async (range) => {
        const logs = (await client.request({
          method: "eth_getLogs",
          params: [
            {
              address: V4_POOL_MANAGER,
              topics,
              fromBlock: toHex(range.fromBlock),
              toBlock: toHex(range.toBlock),
            },
          ],
        } as never)) as { topics: string[]; data: `0x${string}` }[];

        for (const log of logs) {
          const id = log.topics[1];
          if (!id || keyCache.keys.has(id.toLowerCase())) continue;
          try {
            const { args } = decodeEventLog({
              abi: [INITIALIZE],
              data: log.data,
              topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
            });
            keyCache.keys.set(id.toLowerCase(), {
              id: id as `0x${string}`,
              currency0: topicAddress(log.topics[2]),
              currency1: topicAddress(log.topics[3]),
              fee: Number(args.fee),
              tickSpacing: Number(args.tickSpacing),
              hooks: getAddress(args.hooks),
            });
          } catch {
            // Not this event.
          }
        }
      },
      // The ceiling is on results, and a busy asset opens pools fast, so the
      // chunk starts well below the whole window and shrinks from there.
      { maxRequests: 8, maxChunk: 4_000_000n, minChunk: 250_000n },
    ).catch(() => ({ partial: true }));
    if (result.partial) partial = true;
  }

  keyCache.head = head;
  return { keys: keyCache.keys, partial };
}
