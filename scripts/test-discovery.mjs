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
const { CHAIN_SLUG } = await import("../src/lib/tokenFeed.ts");

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

/** A DexScreener pair, shaped the way the documented search response is. */
function pair({ base, quote, liquidity, volume = liquidity * 2, chain = CHAIN_SLUG }) {
  return {
    chainId: chain,
    baseToken: { address: base, symbol: "MEME", name: "Meme Token" },
    quoteToken: { address: quote, symbol: "WETH", name: "Wrapped Ether" },
    priceUsd: "0.5",
    liquidity: { usd: liquidity },
    volume: { h24: volume },
    priceChange: { h24: 12.5 },
    fdv: liquidity * 10,
  };
}

async function withFetch(pairs, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ pairs }),
  });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("the market read keeps the far side of each pair and drops the seed", async () => {
  const wrapped = dexMeta(CHAIN_ID).wrapped;
  const tokens = await withFetch(
    [pair({ base: TOKEN_A, quote: wrapped, liquidity: 5_000 })],
    () => readMarketTokens([wrapped]),
  );

  assert.deepEqual(
    tokens.map((token) => token.address.toLowerCase()),
    [TOKEN_A.toLowerCase()],
    "the wrapped native is already in the app's list and must not come back",
  );
  assert.equal(tokens[0].liquidityUsd, 5_000);
  assert.equal(tokens[0].change24h, 0.125, "a percent from the feed is a fraction here");
});

test("the market read ignores pairs from another chain", async () => {
  const wrapped = dexMeta(CHAIN_ID).wrapped;
  const tokens = await withFetch(
    [pair({ base: TOKEN_A, quote: wrapped, liquidity: 9_999, chain: "ethereum" })],
    () => readMarketTokens([wrapped]),
  );

  assert.deepEqual(tokens, [], "an address is not unique across chains");
});

test("the market read keeps the deepest pair for a token", async () => {
  const wrapped = dexMeta(CHAIN_ID).wrapped;
  const tokens = await withFetch(
    [
      pair({ base: TOKEN_A, quote: wrapped, liquidity: 100 }),
      pair({ base: TOKEN_A, quote: wrapped, liquidity: 8_000 }),
    ],
    () => readMarketTokens([wrapped]),
  );

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].liquidityUsd, 8_000, "the shallow pair must not win");
});

test("the market read ranks by what changed hands, not by what sits in the pool", async () => {
  const wrapped = dexMeta(CHAIN_ID).wrapped;
  const tokens = await withFetch(
    [
      // Deep but barely traded: a launch can mint itself any amount of depth.
      pair({ base: TOKEN_A, quote: wrapped, liquidity: 90_000, volume: 200 }),
      pair({ base: TOKEN_B, quote: wrapped, liquidity: 4_000, volume: 60_000 }),
    ],
    () => readMarketTokens([wrapped]),
  );

  assert.deepEqual(
    tokens.map((token) => token.address.toLowerCase()),
    [TOKEN_B.toLowerCase(), TOKEN_A.toLowerCase()],
  );
});

/*
 * The gate that decides what gets offered. Each of these contracts is real and
 * reachable by pasting its address; none of them is a row worth putting in
 * front of someone who is browsing.
 */
test("a token is offered only with a pool, a day's volume and a cap", () => {
  const whole = { liquidityUsd: 5_000, volume24hUsd: 900, marketCapUsd: 40_000 };
  assert.equal(tradeable(whole), true);

  assert.equal(
    tradeable({ ...whole, liquidityUsd: undefined }),
    false,
    "no pool means it cannot be bought",
  );
  assert.equal(
    tradeable({ ...whole, volume24hUsd: 0 }),
    false,
    "a pool nobody has traded in a day is a pool nobody wants",
  );
  assert.equal(
    tradeable({ ...whole, marketCapUsd: undefined, fdvUsd: undefined }),
    false,
    "no cap means nothing says what buying it would be buying into",
  );
  assert.equal(
    tradeable({ ...whole, marketCapUsd: undefined, fdvUsd: 120_000 }),
    true,
    "a diluted cap is still a cap",
  );
});

test("a feed that will not answer costs the list and nothing else", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("blocked by the reader's network");
  };
  try {
    assert.deepEqual(await readMarketTokens([dexMeta(CHAIN_ID).wrapped]), []);
  } finally {
    globalThis.fetch = original;
  }
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
