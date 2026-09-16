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
const { indexPonsLaunches } = await import("../src/lib/launches.ts");
const { discoverWalletTokens } = await import("../src/lib/discovery.ts");
const { readMarketTokens } = await import("../src/lib/market.ts");
const { PONS_V1_FACTORY, PONS_V2_FACTORY } = await import("../src/lib/pons.ts");
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

/**
 * A stub chain. `getLogs` answers with the factory logs given, and `multicall`
 * answers `getLaunchedToken` from a fixture keyed by address, which is exactly
 * the authority the index defers to.
 */
function stubClient({ logs, v1 = {}, v2 = {} }) {
  return {
    async getBlockNumber() {
      return 1_000n;
    },
    async getLogs({ fromBlock, toBlock }) {
      return logs.filter(
        (log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
      );
    },
    async multicall({ contracts }) {
      return contracts.map((call) => {
        const address = String(call.args[0]).toLowerCase();
        if (call.functionName === "graduationStatus") {
          return { status: "success", result: [0n, 0n, false] };
        }
        const table = call.address === PONS_V2_FACTORY ? v2 : v1;
        const record = table[address];
        return {
          status: "success",
          result: record ?? { exists: false },
        };
      });
    },
  };
}

function v1Record(token) {
  return {
    token,
    deployer: DEPLOYER,
    pairedToken: dexMeta(CHAIN_ID).wrapped,
    restrictionsEndBlock: 0n,
    supply: 1_000_000n,
    poolFee: 10_000,
    exists: true,
  };
}

test("the launch index finds a token named in a log topic", async () => {
  const client = stubClient({
    logs: [
      {
        address: PONS_V1_FACTORY,
        blockNumber: 990n,
        topics: [topic("0xdead"), topic(TOKEN_A), topic(DEPLOYER)],
        data: "0x",
      },
    ],
    v1: { [TOKEN_A.toLowerCase()]: v1Record(TOKEN_A) },
  });

  const index = await indexPonsLaunches(client, CHAIN_ID);
  assert.equal(index.launches.length, 1);
  assert.equal(index.launches[0].address.toLowerCase(), TOKEN_A.toLowerCase());
  assert.equal(index.launches[0].launch.gen, "v1");
});

test("the launch index finds a token named in a log's data instead", async () => {
  const client = stubClient({
    logs: [
      {
        address: PONS_V1_FACTORY,
        blockNumber: 995n,
        topics: [topic("0xbeef")],
        // A deployer, the token, a fee tier and a supply, none of them indexed.
        data: `0x${word(DEPLOYER)}${word(TOKEN_A)}${word("0x2710")}${"f".repeat(64)}`,
      },
    ],
    v1: { [TOKEN_A.toLowerCase()]: v1Record(TOKEN_A) },
  });

  const index = await indexPonsLaunches(client, CHAIN_ID);
  assert.deepEqual(
    index.launches.map((entry) => entry.address.toLowerCase()),
    [TOKEN_A.toLowerCase()],
  );
});

test("only what the factory confirms survives the scan", async () => {
  const venue = dexMeta(CHAIN_ID);
  const client = stubClient({
    logs: [
      {
        address: PONS_V2_FACTORY,
        blockNumber: 999n,
        topics: [topic("0xfeed"), topic(TOKEN_A), topic(CURVE)],
        data: `0x${word(DEPLOYER)}${word(venue.wrapped)}${word(PONS_V1_FACTORY)}`,
      },
    ],
    v2: {
      [TOKEN_A.toLowerCase()]: {
        token: TOKEN_A,
        curve: CURVE,
        deployer: DEPLOYER,
        pairToken: "0x0000000000000000000000000000000000000000",
        graduationThreshold: 1n,
        poolFee: 10_000,
        creatorTaxBps: 100,
        phase: 0,
        exists: true,
      },
      // The curve is a real contract the factory knows, but it is not a token.
      [CURVE.toLowerCase()]: { exists: false },
    },
  });

  const index = await indexPonsLaunches(client, CHAIN_ID);
  assert.deepEqual(
    index.launches.map((entry) => entry.address.toLowerCase()),
    [TOKEN_A.toLowerCase()],
    "the deployer, the wrapped native, the factory and the curve all drop out",
  );
  assert.equal(index.launches[0].launch.gen, "v2");
  assert.equal(index.launches[0].launch.phase, "curve");
});

test("the launch index returns the newest mint first", async () => {
  const client = stubClient({
    logs: [
      {
        address: PONS_V1_FACTORY,
        blockNumber: 100n,
        topics: [topic("0xdead"), topic(TOKEN_A)],
        data: "0x",
      },
      {
        address: PONS_V1_FACTORY,
        blockNumber: 900n,
        topics: [topic("0xdead"), topic(TOKEN_B)],
        data: "0x",
      },
    ],
    v1: {
      [TOKEN_A.toLowerCase()]: v1Record(TOKEN_A),
      [TOKEN_B.toLowerCase()]: v1Record(TOKEN_B),
    },
  });

  const index = await indexPonsLaunches(client, CHAIN_ID);
  assert.deepEqual(
    index.launches.map((entry) => entry.address.toLowerCase()),
    [TOKEN_B.toLowerCase(), TOKEN_A.toLowerCase()],
  );
});

/*
 * The wallet scan shares `scanBack` with the index above, so these guard the
 * two filters that make it a token scan rather than a log dump.
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

/** A DexScreener pair, shaped the way the documented search response is. */
function pair({ base, quote, liquidity, chain = CHAIN_SLUG }) {
  return {
    chainId: chain,
    baseToken: { address: base, symbol: "MEME", name: "Meme Token" },
    quoteToken: { address: quote, symbol: "WETH", name: "Wrapped Ether" },
    priceUsd: "0.5",
    liquidity: { usd: liquidity },
    volume: { h24: liquidity * 2 },
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

test("the market read keeps the deepest pair and ranks by depth", async () => {
  const wrapped = dexMeta(CHAIN_ID).wrapped;
  const tokens = await withFetch(
    [
      pair({ base: TOKEN_A, quote: wrapped, liquidity: 100 }),
      pair({ base: TOKEN_A, quote: wrapped, liquidity: 8_000 }),
      pair({ base: TOKEN_B, quote: wrapped, liquidity: 3_000 }),
    ],
    () => readMarketTokens([wrapped]),
  );

  assert.deepEqual(
    tokens.map((token) => token.address.toLowerCase()),
    [TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()],
  );
  assert.equal(tokens[0].liquidityUsd, 8_000, "the shallow pair must not win");
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
