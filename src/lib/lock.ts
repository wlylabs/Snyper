import { encodePacked, keccak256, parseAbi, parseAbiItem, type PublicClient } from "viem";
import { poolAbi } from "./screener";

/**
 * Whether the liquidity under a pair can be walked away with.
 *
 * The oldest way to take money off a memecoin buyer is not to sell into them,
 * it is to remove the pool they bought through. The terminal already asks
 * whether a position can be sold at all — that is the quoted sell side in
 * `useShot` — but a sell side that quotes today says nothing about a pool that
 * will not be there tomorrow, and the two failures look identical afterwards.
 *
 * On a Uniswap v3 chain the question has a different shape than the one most
 * screens answer. There is no LP token to burn: liquidity is a position, and a
 * position is either held directly by the address that minted it or wrapped in
 * an NFT by a position manager. So "locked" here means exactly one thing — the
 * holder of that position has no key — and the only form of that this app will
 * claim is a position whose NFT has been burned.
 *
 * That narrowness is measured rather than cautious. Sampled across eighteen
 * pools on this chain that held anything at all: five had every position
 * burned, four were held by ordinary wallets that can withdraw at any block,
 * one was 89.8% burned, and eight were held by contracts — eight different
 * contracts, no two the same. There is no locker on chain 4663 that a screen
 * could learn to recognise, and several of those holders carry
 * `decreaseLiquidity` and an `owner()`, which makes them wrappers rather than
 * locks. Calling those locked would be the single most expensive thing this
 * screen could get wrong, so they are reported as what they are: unread.
 */

/**
 * The two contracts that hold positions on behalf of someone else.
 *
 * Both verified against the chain rather than taken from a deployment list.
 * The first is `router.positionManager()`, and it answers `Uniswap V3 Positions
 * NFT-V1` / `UNI-V3-POS` with `factory()` and `WETH9()` both matching the venue
 * this app trades through. The second turned up by counting `Mint` owners — it
 * is `up Position NFT` / `UP-POS`, it carries 28% of all mints on this chain,
 * and it was checked to emit the same `IncreaseLiquidity` and answer the same
 * `ownerOf` and `positions` as the first. A manager this app does not know is
 * not assumed to behave like these; it falls through to unread.
 */
export const POSITION_MANAGERS: readonly `0x${string}`[] = [
  "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  "0x07f44C47743A2F36414a82B9f558eCFcf0eEdCEf",
];

export function isManager(address: string): boolean {
  const held = address.toLowerCase();
  return POSITION_MANAGERS.some((manager) => manager.toLowerCase() === held);
}

/**
 * Where a position goes to stop being anyone's.
 *
 * The same two addresses the screener subtracts from a supply, and for the same
 * reason: neither has a key, so an NFT sent to one can never call
 * `decreaseLiquidity` again. A token id that has been burned outright is the
 * third case and needs no address — `ownerOf` reverts, which is read here as
 * the strongest form of the same answer.
 */
export const NO_KEY = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
] as const;

export function hasNoKey(address: string): boolean {
  const held = address.toLowerCase();
  return NO_KEY.some((entry) => entry === held);
}

export const poolMintEvent = parseAbiItem(
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);

/**
 * `IncreaseLiquidity(uint256 indexed tokenId, uint128, uint256, uint256)`.
 *
 * A pool's `Mint` names the manager but not which of its NFTs the liquidity
 * went into, and the manager's own event is the only place that number
 * appears. They are emitted in the same transaction, so the receipt of the
 * mint is what joins them — there is no filter that would fetch one from the
 * other, because the token id is the indexed field and it is what is unknown.
 */
export const INCREASE_LIQUIDITY_TOPIC =
  "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";

export const managerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowth0, uint256 feeGrowth1, uint128 owed0, uint128 owed1)",
]);

export const poolPositionsAbi = parseAbi([
  "function positions(bytes32 key) view returns (uint128 liquidity, uint256 feeGrowth0, uint256 feeGrowth1, uint128 owed0, uint128 owed1)",
]);

/**
 * How many positions this will read before it stops and says so.
 *
 * Most pools have one. The cap is here for the ones that do not: a pool on this
 * chain was measured carrying more than forty mints, most of them long since
 * emptied, and each one that is still open costs a receipt to resolve. Twenty
 * four covers every pool sampled except that one, and when it does bind the
 * result says the share is over what it read rather than over the pool.
 */
export const MAX_POSITIONS = 24;

/** One `eth_call` per multicall, however many reads go into it. */
const ONE_CALL = 0;

/** What holds a position, once it is known. */
export type Holder = "burned" | "wallet" | "contract";

/** Liquidity under a pool, split by what could happen to it. */
export type Lock = {
  /** Burned: provably nobody can withdraw it. */
  burned: bigint;
  /** Held by an address with a key, which can withdraw at any block. */
  open: bigint;
  /** Held by a contract this app cannot read a verdict out of. */
  unread: bigint;
  /** `burned / (burned + open + unread)`, or undefined when there is nothing. */
  share?: number;
  /**
   * Whether any burned liquidity covers the price the pool is trading at.
   *
   * A v3 position only backs the price while the price is inside its range, so
   * a burned position parked outside it is liquidity that cannot be withdrawn
   * and is also not holding anything up. Worth separating, because burning a
   * token's worth of range nobody trades in is the cheap way to buy a badge.
   *
   * Three values rather than two, and the third is the point. This was a plain
   * boolean until a test fed it a pool whose price could not be read: the range
   * test then quietly returned false for every position, which on screen is the
   * sentence "the burned liquidity is not holding this price up" — a claim, made
   * out of a failed read. `undefined` is the honest third answer, and the screen
   * says nothing when it gets one.
   */
  backsPrice?: boolean;
  /** True when there were more positions than `MAX_POSITIONS`. */
  partial: boolean;
};

export type Verdict = "burned" | "open" | "mixed" | "unread" | "empty";

/** The one word this reduces to, and the one it refuses to reduce to. */
export function verdictOf(lock: Lock): Verdict {
  const total = lock.burned + lock.open + lock.unread;
  if (total === 0n) return "empty";
  if (lock.burned === total) return "burned";
  if (lock.burned === 0n) return lock.open === 0n ? "unread" : "open";
  return "mixed";
}

/** The share, as a percentage a screen can print. */
export function shareOf(lock: Lock): number | undefined {
  const total = lock.burned + lock.open + lock.unread;
  if (total === 0n) return undefined;
  return Number((lock.burned * 10_000n) / total) / 100;
}

/** A position as the pool itself keys it: a holder and a range. */
type Range = {
  owner: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  /** The transactions that funded it, for resolving token ids if needed. */
  txs: `0x${string}`[];
};

/**
 * The pool's own key for a position: the holder and the range, packed.
 *
 * Uniswap stores positions under `keccak256(owner, tickLower, tickUpper)`, so
 * everything one address holds in one range is a single entry however many
 * times it was topped up. That is what makes the first read below cheap, and
 * also why a manager's entry cannot be split by owner from the pool alone —
 * every NFT it holds in one range lands in one slot, and separating them means
 * asking the manager.
 */
function positionKey({ owner, tickLower, tickUpper }: Range): `0x${string}` {
  return keccak256(encodePacked(["address", "int24", "int24"], [owner, tickLower, tickUpper]));
}

/**
 * What is under a pool, and whether anyone can take it away.
 *
 * The order of the questions is the whole design, and it was wrong the first
 * time. A pool's `Mint` log says what went in once; it says nothing about what
 * is there now, and a pool that has been topped up and emptied thirty times
 * carries thirty mints of which one may still hold anything. Resolving them all
 * meant a transaction receipt each — expensive enough to need a cap, and the cap
 * then truncated the history rather than the answer. Measured on a live pool
 * holding $3.6K: forty-three mints across thirty-three transactions, the first
 * twenty-four of them long since closed, and the screen said the pool was empty.
 *
 * So the pool is asked first. Every distinct holder-and-range is one slot it can
 * report directly, in one call, and the ranges holding nothing drop out before a
 * single receipt is fetched — which on that same pool left three. The cap now
 * bounds the positions that still hold something, which is a number in the low
 * single digits on every pool sampled.
 *
 * What survives truncation is the arithmetic. Each range's liquidity is known
 * from the pool before its token ids are, so anything left unresolved inside it
 * is counted as unread rather than dropped: the share is always over the whole
 * of what is in the pool, and a cap that binds makes the answer vaguer instead
 * of making it wrong.
 */
export async function readLock(
  client: PublicClient,
  pool: `0x${string}`,
): Promise<Lock> {
  const mints = await client.getLogs({
    address: pool,
    event: poolMintEvent,
    fromBlock: 0n,
    toBlock: "latest",
  });

  /*
   * Mints folded onto the slots the pool actually keeps. A launch that seeds a
   * pool across two ranges in one signature is two slots and one transaction;
   * a pool topped up weekly into one range is one slot and many.
   */
  const ranges = new Map<string, Range>();
  for (const mint of mints) {
    const owner = mint.args.owner;
    if (!owner) continue;
    const tickLower = mint.args.tickLower ?? 0;
    const tickUpper = mint.args.tickUpper ?? 0;
    const key = `${owner.toLowerCase()}:${tickLower}:${tickUpper}`;
    const held = ranges.get(key);
    if (held) {
      if (!held.txs.includes(mint.transactionHash)) held.txs.push(mint.transactionHash);
    } else {
      ranges.set(key, { owner, tickLower, tickUpper, txs: [mint.transactionHash] });
    }
  }

  const all = [...ranges.values()];

  /*
   * The price, and what each slot holds now. Two shapes of call, so two
   * requests — the transport batches whatever is issued on the same tick, so
   * they still leave as one body.
   */
  const [slot, held] = await Promise.all([
    client
      .readContract({ address: pool, abi: poolAbi, functionName: "slot0" })
      .catch(() => undefined),
    client.multicall({
      contracts: all.map(
        (range) =>
          ({
            address: pool,
            abi: poolPositionsAbi,
            functionName: "positions" as const,
            args: [positionKey(range)] as const,
          }) as const,
      ),
      allowFailure: true,
      batchSize: ONE_CALL,
    }),
  ]);

  const tick = slot ? Number((slot as readonly unknown[])[1]) : undefined;
  /** Without a price there is no range test, and no answer to report from one. */
  const priceKnown = tick !== undefined && Number.isFinite(tick);
  const covers = (lower: number, upper: number) =>
    priceKnown && lower <= (tick as number) && (tick as number) < upper;

  /*
   * Slots that still hold something. Everything else is history.
   *
   * A failure here is not a slot holding nothing, and the difference matters
   * more than anywhere else in this file. `positions` on a pool is a mapping
   * read — it cannot revert, so the only way an entry comes back failed is that
   * the call did not happen, and viem's `allowFailure` reports a whole batch
   * that never left as a failure on every entry in it. Treated as emptiness
   * that reads on screen as "nothing is left in this pool", which is the
   * sentence a reader sees after a rug. So it is refused instead, and the
   * screen says it could not read rather than saying the pool is gone.
   */
  const active: { range: Range; amount: bigint }[] = [];
  all.forEach((range, index) => {
    const outcome = held[index];
    if (outcome?.status !== "success") {
      throw new Error("pool positions could not be read");
    }
    const amount = (outcome.result as readonly unknown[])[0];
    if (typeof amount !== "bigint" || amount === 0n) return;
    active.push({ range, amount });
  });

  let burned = 0n;
  let open = 0n;
  let unread = 0n;
  let backsPrice = priceKnown ? false : undefined;

  /**
   * A holder with a key is open, a burn address is burned, anything else is
   * unread — and "anything else" deliberately includes not knowing.
   *
   * An earlier version read a failed `ownerOf` as a burn, on the reasoning that
   * a burnt token id has no owner and reverts. That reasoning is sound about
   * reverts and wrong about failures, and `allowFailure` does not distinguish
   * them: one batch that never left the browser would have come back as a
   * revert on every position in the pool and printed a confident "100% burned"
   * over liquidity a wallet could empty in the next block. There is no error
   * this file could make that costs a reader more.
   *
   * So only an address that is provably keyless counts as burned. A token id
   * that genuinely was burnt outright is then reported as unread rather than
   * locked, which is a worse answer and a safe one — and on the manager this
   * chain uses it cannot arise anyway, because `burn` there requires the
   * position to be empty first.
   */
  const place = (
    amount: bigint,
    holder: string | undefined,
    code: string | undefined,
    range: Range,
  ) => {
    if (holder !== undefined && hasNoKey(holder)) {
      burned += amount;
      if (covers(range.tickLower, range.tickUpper)) backsPrice = true;
      return;
    }
    if (holder === undefined || (code && code !== "0x")) {
      unread += amount;
      return;
    }
    open += amount;
  };

  const managed = active.filter(({ range }) => isManager(range.owner));
  const direct = active.filter(({ range }) => !isManager(range.owner));

  /*
   * Positions held by an address rather than wrapped need nothing further: the
   * pool named the holder, and the holder is the answer.
   */
  const directCodes = await Promise.all(
    direct.map(({ range }) =>
      hasNoKey(range.owner)
        ? Promise.resolve(undefined)
        : client.getCode({ address: range.owner }).catch(() => "0x"),
    ),
  );
  direct.forEach(({ range, amount }, index) => {
    place(amount, range.owner, directCodes[index], range);
  });

  /*
   * The wrapped ones, and only the ones still holding anything. The cap binds
   * here rather than over the pool's history, which is the difference between
   * reading three receipts and thirty-three.
   */
  const resolving = managed.slice(0, MAX_POSITIONS);
  const partial = managed.length > resolving.length;

  /* Every range past the cap is liquidity nobody looked at, so it is unread. */
  for (const { amount } of managed.slice(resolving.length)) unread += amount;

  const hashes = [...new Set(resolving.flatMap(({ range }) => range.txs))].slice(
    0,
    MAX_POSITIONS,
  );
  const receipts = await Promise.all(
    hashes.map((hash) => client.getTransactionReceipt({ hash }).catch(() => undefined)),
  );

  /** Token ids, grouped by the manager and range their liquidity landed in. */
  const tokens: { manager: `0x${string}`; tokenId: bigint }[] = [];
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (!receipt) continue;
    for (const log of receipt.logs) {
      if (log.topics[0] !== INCREASE_LIQUIDITY_TOPIC) continue;
      if (!isManager(log.address)) continue;
      const raw = log.topics[1];
      if (!raw) continue;
      const tokenId = BigInt(raw);
      const key = `${log.address.toLowerCase()}:${tokenId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push({ manager: log.address as `0x${string}`, tokenId });
    }
  }

  const [positions, owners] = await Promise.all([
    client.multicall({
      contracts: tokens.map(
        (entry) =>
          ({
            address: entry.manager,
            abi: managerAbi,
            functionName: "positions" as const,
            args: [entry.tokenId] as const,
          }) as const,
      ),
      allowFailure: true,
      batchSize: ONE_CALL,
    }),
    /*
     * `allowFailure` here keeps one unreadable token id from taking the rest of
     * the pool down with it. What it does not do is say why an entry failed —
     * see `place`, which is why an unanswered `ownerOf` is counted as unread
     * rather than as the burn it usually is.
     */
    client.multicall({
      contracts: tokens.map(
        (entry) =>
          ({
            address: entry.manager,
            abi: managerAbi,
            functionName: "ownerOf" as const,
            args: [entry.tokenId] as const,
          }) as const,
      ),
      allowFailure: true,
      batchSize: ONE_CALL,
    }),
  ]);

  /** What each resolved token holds, filed under the slot it belongs to. */
  const resolved = new Map<string, bigint>();
  const holders: { key: string; amount: bigint; holder: string | undefined }[] = [];

  tokens.forEach((entry, index) => {
    const outcome = positions[index];
    if (outcome?.status !== "success") return;
    const result = outcome.result as readonly unknown[];
    const amount = result[7];
    if (typeof amount !== "bigint" || amount === 0n) return;
    const key = `${entry.manager.toLowerCase()}:${Number(result[5])}:${Number(result[6])}`;
    resolved.set(key, (resolved.get(key) ?? 0n) + amount);
    const ownerOf = owners[index];
    holders.push({
      key,
      amount,
      holder: ownerOf?.status === "success" ? (ownerOf.result as string) : undefined,
    });
  });

  const holderCodes = await Promise.all(
    holders.map(({ holder }) =>
      holder && !hasNoKey(holder)
        ? client.getCode({ address: holder as `0x${string}` }).catch(() => "0x")
        : Promise.resolve(undefined),
    ),
  );

  const rangeOf = new Map(
    resolving.map(({ range }) => [
      `${range.owner.toLowerCase()}:${range.tickLower}:${range.tickUpper}`,
      range,
    ]),
  );

  holders.forEach(({ key, amount, holder }, index) => {
    const range = rangeOf.get(key);
    place(amount, holder, holderCodes[index], range ?? resolving[0].range);
  });

  /*
   * Whatever the pool says is in a slot and the manager did not account for.
   *
   * This is the guard that keeps a cap or a missing token id from quietly
   * shrinking the denominator: the pool's figure is the truth about how much is
   * there, the token ids are only how it is split, and anything the split does
   * not reach is liquidity this check did not read.
   */
  for (const { range, amount } of resolving) {
    const key = `${range.owner.toLowerCase()}:${range.tickLower}:${range.tickUpper}`;
    const accounted = resolved.get(key) ?? 0n;
    if (amount > accounted) unread += amount - accounted;
  }

  return { burned, open, unread, backsPrice, partial };
}
