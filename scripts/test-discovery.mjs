/**
 * Checks the two ways the app finds tokens nobody told it about.
 *
 * Unlike `test-router.mjs` this touches no network: the chain and the market
 * feed are both stubbed, because what is under test is not what they answer but
 * what this app does with the answer. That matters most for the launchpad
 * index, whose whole design is to survive not knowing the launch event's ABI —
 * a fixture is the only place that claim can actually be exercised.
 */
import { register } from "node:module";
import assert from "node:assert/strict";

register("./ts-resolve.mjs", import.meta.url);

const { scanBack, blockWindow } = await import("../src/lib/logscan.ts");
const { discoverWalletTokens } = await import("../src/lib/discovery.ts");
const { readMarketTokens, tradeable } = await import("../src/lib/market.ts");
const { readPonsLaunches, PONS_V1_FACTORY, PONS_V2_FACTORY } = await import(
  "../src/lib/pons.ts"
);
const { CHAIN_ID, dexMeta } = await import("../src/lib/chains.ts");
const { NATIVE } = await import("../src/lib/native.ts");
const { buildMarketIndex } = await import("../src/lib/marketIndex.ts");
const { resolveVenue } = await import("../src/lib/venue.ts");
const { readV4State, v4Currency, findV4Pools, V4_POOL_MANAGER } = await import(
  "../src/lib/v4.ts"
);
const { buildSwap } = await import("../src/lib/swap.ts");

const checks = [];
function test(name, run) {
  checks.push({ name, run });
}

const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const topic = (hex) => `0x${word(hex)}`;

/* Addresses that are nothing to do with the venue or the factories. */
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";
const DEPLOYER = "0x3333333333333333333333333333333333333333";
const CURVE = "0x4444444444444444444444444444444444444444";

test("scanBack covers the whole window and reports it complete", async () => {
  const ranges = [];
  const result = await scanBack(1000n, 400n, async (range) => {
    ranges.push(range);
  }, { maxChunk: 100n });

  assert.equal(result.partial, false);
  assert.equal(result.scanned, 400n);
  assert.equal(ranges.length, 4);
  assert.equal(ranges[0].toBlock, 1000n);
  // The window is the four hundred blocks behind the head, so the floor itself
  // is the block before the first one read rather than the first one read.
  assert.equal(ranges.at(-1).fromBlock, 601n);
});

test("scanBack halves the chunk when the endpoint refuses a range", async () => {
  const spans = [];
  let refused = 0;
  const result = await scanBack(1000n, 400n, async (range) => {
    spans.push(range.toBlock - range.fromBlock + 1n);
    // Refuse anything wider than fifty blocks, the way a capped endpoint does.
    if (range.toBlock - range.fromBlock + 1n > 50n) {
      refused += 1;
      throw new Error("query returned more than 10000 results");
    }
  }, { maxChunk: 200n, minChunk: 25n });

  assert.ok(refused >= 2, "the wide ranges should have been refused");
  assert.equal(result.partial, false, "it should still finish at a smaller chunk");
  assert.ok(spans.some((span) => span <= 50n), "it should have shrunk");
});

test("scanBack stops at its request budget and says the window is partial", async () => {
  let calls = 0;
  const result = await scanBack(10_000n, 9_000n, async () => {
    calls += 1;
  }, { maxChunk: 100n, maxRequests: 3 });

  assert.equal(calls, 3);
  assert.equal(result.partial, true);
  assert.equal(result.scanned, 300n);
});

test("blockWindow stays inside its clamps whatever the block time", () => {
  const window = blockWindow(CHAIN_ID, 14);
  assert.ok(window >= 50_000n && window <= 2_000_000n);
  assert.equal(blockWindow(CHAIN_ID, 0), 50_000n, "a zero-day window still has a floor");
});

/*
 * The wallet scan is the other caller of `scanBack`, so these guard the two
 * filters that make it a token scan rather than a log dump.
 */
const HOLDER = "0x5555555555555555555555555555555555555555";

function walletClient(logs, balances) {
  return {
    async getBlockNumber() {
      return 1_000n;
    },
    async getLogs() {
      return logs;
    },
    async multicall({ contracts }) {
      return contracts.map((call) => {
        const token = call.address.toLowerCase();
        switch (call.functionName) {
          case "symbol":
            return { status: "success", result: "MEME" };
          case "name":
            return { status: "success", result: "Meme Token" };
          case "decimals":
            return { status: "success", result: 18 };
          case "balanceOf":
            return { status: "success", result: balances[token] ?? 0n };
          default:
            return { status: "success", result: 0n };
        }
      });
    },
  };
}

test("the wallet scan skips NFT transfers and empty balances", async () => {
  const client = walletClient(
    [
      // An ERC-20 the wallet holds.
      {
        address: TOKEN_A,
        topics: [topic("0xddf2"), topic(DEPLOYER), topic(HOLDER)],
      },
      // An ERC-721 sharing the Transfer topic, told apart by its third index.
      {
        address: TOKEN_B,
        topics: [topic("0xddf2"), topic(DEPLOYER), topic(HOLDER), topic("0x01")],
      },
      // An ERC-20 that was received once and has since been sold.
      {
        address: CURVE,
        topics: [topic("0xddf2"), topic(DEPLOYER), topic(HOLDER)],
      },
    ],
    { [TOKEN_A.toLowerCase()]: 42n },
  );

  const result = await discoverWalletTokens(client, CHAIN_ID, HOLDER);
  assert.deepEqual(
    result.tokens.map((token) => token.address.toLowerCase()),
    [TOKEN_A.toLowerCase()],
  );
  assert.equal(result.tokens[0].balance, 42n);
});

/**
 * The launchpad as the app now uses it: not a source of rows, but the one
 * authority on whether a row it was handed is a Pons mint. Asked of the factory
 * directly, which cannot be wrong about its own mints.
 */
test("the launchpad confirms its own mints and disowns everything else", async () => {
  const client = {
    async multicall({ contracts }) {
      return contracts.map((call) => {
        const token = String(call.args[0]).toLowerCase();
        if (call.functionName === "graduationStatus") {
          return { status: "success", result: [0n, 0n, false] };
        }
        if (call.address === PONS_V2_FACTORY || token !== TOKEN_A.toLowerCase()) {
          return { status: "success", result: { exists: false } };
        }
        return {
          status: "success",
          result: {
            token: TOKEN_A,
            deployer: DEPLOYER,
            pairedToken: dexMeta(CHAIN_ID).wrapped,
            restrictionsEndBlock: 0n,
            supply: 1_000_000n,
            poolFee: 10_000,
            exists: true,
          },
        };
      });
    },
  };

  const found = await readPonsLaunches(client, [TOKEN_A, TOKEN_B]);
  assert.equal(found.size, 1);
  assert.equal(found.get(TOKEN_A.toLowerCase()).gen, "v1");
  assert.equal(found.get(TOKEN_B.toLowerCase()), undefined);
});

/*
 * The market index: the chain's own answer to "what trades here".
 *
 * These stub the chain rather than an indexer, because that is what the index
 * now reads. What is under test is the filtering — a pool standing empty is the
 * eighty percent case on this chain, and every one of them that slips through
 * is a dead row in front of a reader.
 */
const VENUE = resolveVenue(undefined, undefined);
const WRAPPED = VENUE.wrapped;
const STABLE = VENUE.stable;

const poolFor = (token) => `0x${token.slice(2, 6)}${"0".repeat(36)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;


/** A PoolCreated log, shaped the way viem decodes one. */
function poolLog({ token, quote = WRAPPED, fee = 10_000, block = 900n }) {
  const [token0, token1] =
    token.toLowerCase() < quote.toLowerCase() ? [token, quote] : [quote, token];
  return {
    address: VENUE.factory,
    blockNumber: block,
    args: { token0, token1, fee, tickSpacing: 200, pool: poolFor(token) },
  };
}

/**
 * The sqrt price a pool would carry for a given rate.
 *
 * `sqrtPriceX96` is token1 per token0 in raw units, so the decimals of both
 * sides are baked into it: a coin with eighteen of them quoted in a dollar with
 * six sits at 1e-12 raw when it is worth exactly one dollar. Writing 2**96 and
 * calling it "a price of one" is how a fixture ends up asserting that ether
 * costs a trillion dollars.
 */
function sqrtPriceFor(rate, decimalsToken, decimalsQuote) {
  const raw = rate / 10 ** (decimalsToken - decimalsQuote);
  return BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96));
}

/**
 * A chain that answers with the given pool balances. Pools price at one unit
 * for one unless `prices` says otherwise, keyed by pool address.
 */
function chainWith(logs, balances, prices = {}) {
  return {
    async getBlockNumber() {
      return 40_000_000n;
    },
    async getLogs() {
      return logs;
    },
    async multicall({ contracts }) {
      return contracts.map((call) => {
        if (call.functionName === "balanceOf") {
          const pool = String(call.args[0]).toLowerCase();
          return { status: "success", result: balances[pool] ?? 0n };
        }
        if (call.functionName === "slot0") {
          const pool = String(call.address).toLowerCase();
          const sqrt = prices[pool] ?? sqrtPriceFor(1, 18, 18);
          return { status: "success", result: [sqrt, 0, 0, 0, 0, 0, true] };
        }
        if (call.functionName === "token0") {
          const pool = String(call.address).toLowerCase();
          const log = logs.find((entry) => entry.args.pool.toLowerCase() === pool);
          return { status: "success", result: log.args.token0 };
        }
        if (call.functionName === "decimals") {
          return { status: "success", result: 18 };
        }
        if (call.functionName === "getPool") {
          /* The coin/dollar pool is resolved from the factory rather than
             found in the scan, because on a live chain it predates any window
             worth scanning. */
          const [a, b] = call.args;
          const pair = [String(a).toLowerCase(), String(b).toLowerCase()].sort().join();
          const want = [WRAPPED.toLowerCase(), String(STABLE).toLowerCase()].sort().join();
          return {
            status: "success",
            result: pair === want ? poolFor(WRAPPED) : ZERO_ADDRESS,
          };
        }
        return { status: "success", result: 0n };
      });
    },
  };
}

test("the index drops every pool standing empty", async () => {
  const client = chainWith(
    [poolLog({ token: TOKEN_A }), poolLog({ token: TOKEN_B })],
    { [poolFor(TOKEN_A).toLowerCase()]: 5n * 10n ** 18n },
  );

  const index = await buildMarketIndex(client, VENUE);
  assert.deepEqual(
    index.markets.map((m) => m.address.toLowerCase()),
    [TOKEN_A.toLowerCase()],
    "a pool with nothing in it is not a market",
  );
  assert.equal(index.scanned, 2);
  assert.equal(index.empty, 1, "the reader is told how much noise was dropped");
});

test("the index ignores pools between two tokens it cannot fund a trade with", async () => {
  const client = chainWith(
    [poolLog({ token: TOKEN_A, quote: TOKEN_B })],
    { [poolFor(TOKEN_A).toLowerCase()]: 9n * 10n ** 18n },
  );

  const index = await buildMarketIndex(client, VENUE);
  assert.deepEqual(index.markets, [], "neither side is an asset the app holds");
  assert.equal(index.scanned, 0);
});

test("the index ranks by depth and keeps one row per token", async () => {
  /* The same token pooled at two fee tiers: the deeper pool is the one a trade
     would route through, and the shallow one must not become a second row. */
  const SHALLOW_POOL = `0xaaaa${"0".repeat(36)}`;
  const shallow = { ...poolLog({ token: TOKEN_A, fee: 500 }) };
  shallow.args = { ...shallow.args, pool: SHALLOW_POOL };
  const deep = poolLog({ token: TOKEN_A, fee: 10_000 });

  const client = chainWith(
    [shallow, deep, poolLog({ token: TOKEN_B, fee: 3_000 })],
    {
      [SHALLOW_POOL]: 1n * 10n ** 18n,
      [poolFor(TOKEN_A).toLowerCase()]: 50n * 10n ** 18n,
      [poolFor(TOKEN_B).toLowerCase()]: 20n * 10n ** 18n,
    },
  );

  const index = await buildMarketIndex(client, VENUE);
  assert.deepEqual(
    index.markets.map((m) => m.address.toLowerCase()),
    [TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()],
    "deepest first",
  );
  assert.equal(index.markets.length, 2, "one row per token, not one per pool");
  assert.equal(index.markets[0].fee, 10_000, "and it is the deeper pool's row");
});

test("depth in the chain's dollar is comparable with depth in its coin", async () => {
  if (!STABLE) return;
  /* A coin trades at one dollar in this fixture, so a pool holding 10 of the
     coin and one holding 10 dollars have to rank together rather than by the
     raw integer, which differs by twelve decimal places between the two. */
  const client = chainWith(
    [
      poolLog({ token: WRAPPED, quote: STABLE, fee: 500 }),
      poolLog({ token: TOKEN_A, quote: WRAPPED }),
      poolLog({ token: TOKEN_B, quote: STABLE }),
    ],
    {
      [poolFor(WRAPPED).toLowerCase()]: 1_000n * 10n ** 6n,
      [poolFor(TOKEN_A).toLowerCase()]: 10n * 10n ** 18n,
      [poolFor(TOKEN_B).toLowerCase()]: 400n * 10n ** 6n,
    },
    { [poolFor(WRAPPED).toLowerCase()]: sqrtPriceFor(1, 18, 6) },
  );

  const index = await buildMarketIndex(client, VENUE);
  const rows = index.markets.filter((m) => m.address.toLowerCase() !== WRAPPED.toLowerCase());
  assert.deepEqual(
    rows.map((m) => m.address.toLowerCase()),
    [TOKEN_B.toLowerCase(), TOKEN_A.toLowerCase()],
    "400 dollars outranks 10 coins at a dollar each",
  );
  assert.ok(rows[0].depthUsd > rows[1].depthUsd);
});

/*
 * The gate that decides what gets offered. Measured over eleven days on chain
 * 4663, eighty percent of the pools opened against wrapped native held nothing
 * or dust — each one a row a reader would have to work out was dead.
 */
test("a token is offered only where something is standing in the pool", () => {
  assert.equal(tradeable({ liquidityUsd: 5_000 }), true);
  assert.equal(tradeable({ depth: 2.5 }), true, "depth counts even without a dollar");
  assert.equal(tradeable({}), false, "an empty pool is not a market");
  assert.equal(tradeable({ liquidityUsd: 0, depth: 0 }), false);
});

test("an index that will not answer costs the list and nothing else", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("blocked by the reader's network");
  };
  try {
    const reading = await readMarketTokens([{ address: WRAPPED, symbol: "WETH" }]);
    assert.deepEqual(reading.tokens, []);
  } finally {
    globalThis.fetch = original;
  }
});

/*
 * Uniswap v4: the half of this chain the app could not see. A Pons V2 launch
 * graduates into a v4 pool, and until this existed that was the moment a
 * position stopped being priced.
 */
const V4_INIT_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

test("v4 names the chain's coin the way v4 does, not the way the app does", () => {
  const native = { chainId: CHAIN_ID, address: NATIVE, symbol: "ETH", name: "Ether", decimals: 18, native: true };
  assert.equal(v4Currency(native), ZERO_ADDRESS, "a v4 pool keys ether as the zero address");
  const erc20 = { chainId: CHAIN_ID, address: TOKEN_A, symbol: "MEME", name: "Meme", decimals: 18 };
  assert.equal(v4Currency(erc20), TOKEN_A, "everything else is itself");
});

test("a pool's state is unpacked out of one storage word", async () => {
  /* Slot0 packs sqrtPrice in the low 160 bits, then tick, protocol fee and LP
     fee above it. A negative tick is the case worth pinning: it is a signed
     24-bit field, and read unsigned it comes back as sixteen million. */
  const sqrt = 79228162514264337593543950336n; // 2**96
  const tick = -200;
  const lpFee = 3000;
  const packed =
    sqrt |
    (BigInt(tick & 0xffffff) << 160n) |
    (BigInt(lpFee) << 208n);

  const client = {
    async multicall({ contracts }) {
      assert.equal(contracts[0].address, V4_POOL_MANAGER);
      return [
        { status: "success", result: `0x${packed.toString(16).padStart(64, "0")}` },
        { status: "success", result: `0x${(4242n).toString(16).padStart(64, "0")}` },
      ];
    },
  };

  const state = await readV4State(client, `0x${"ab".repeat(32)}`);
  assert.equal(state.sqrtPriceX96, sqrt);
  assert.equal(state.tick, tick, "a negative tick must not read as 16.7 million");
  assert.equal(state.lpFee, lpFee);
  assert.equal(state.liquidity, 4242n);
});

test("a pool that was initialised but never funded is not a price", async () => {
  const client = {
    async multicall() {
      return [{ status: "success", result: `0x${"0".repeat(64)}` }, { status: "success", result: "0x0" }];
    },
  };
  assert.equal(await readV4State(client, `0x${"cd".repeat(32)}`), undefined);
});

test("both currencies are searched, because either side may be indexed first", async () => {
  const asked = [];
  const client = {
    async request({ params }) {
      asked.push(params[0].topics);
      return [];
    },
  };
  await findV4Pools(client, TOKEN_A);
  assert.equal(asked.length, 2, "currency0 and currency1 are separate indexed topics");
  assert.equal(asked[0][0], V4_INIT_TOPIC);
  assert.ok(asked[0][2]?.endsWith(TOKEN_A.slice(2).toLowerCase()), "asked as currency0");
  assert.ok(asked[1][3]?.endsWith(TOKEN_A.slice(2).toLowerCase()), "asked as currency1");
});

test("a v4 quote is refused by the swap builder rather than encoded as v3", () => {
  /* The read path and the signing path must never be confused: every encoder
     downstream would happily take this and build a v3 trade against a pool id
     that is not a pool address. */
  const token = { chainId: CHAIN_ID, address: TOKEN_A, symbol: "MEME", name: "Meme", decimals: 18 };
  assert.throws(
    () =>
      buildSwap({
        tokenIn: token,
        tokenOut: token,
        amountIn: 1n,
        amountOutMinimum: 0n,
        quote: { venue: "v4", fee: 3000, amountIn: 1n, amountOut: 1n, midPrice: 1, executionPrice: 1, priceImpact: 0, gasEstimate: 0n, pool: TOKEN_B },
        recipient: DEPLOYER,
        deadlineMinutes: 20,
      }),
    /v4/,
  );
});

let failed = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`  ok   ${check.name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${check.name}`);
    console.log(`       ${error.message}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
