/**
 * Exercises SnyperRouter against the live state of chain 4663.
 *
 * There is no local node here: the contract is deployed inside an
 * eth_simulateV1 batch, on top of the chain as it stands, and the trades that
 * follow hit the real Uniswap pool and the real launchpad. That makes this a
 * check against production reality rather than against a fixture, and it means
 * it can fail for reasons that are nothing to do with the contract — a pool
 * that moved, an endpoint that blinked. Read a failure here before believing it.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  http,
  parseEther,
  formatUnits,
  formatEther,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  decodeEventLog,
  toFunctionSelector,
  parseAbi,
} from "viem";
import { robinhood } from "viem/chains";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(readFileSync(join(root, "contracts/out/SnyperRouter.json"), "utf8"));

const client = createPublicClient({ chain: robinhood, transport: http() });

/*
 * A native balance cannot be read with a call, so one is deployed alongside the
 * router purely to answer for the treasury mid-simulation.
 */
const probeOut = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: {
        "Probe.sol": {
          content:
            "// SPDX-License-Identifier: MIT\npragma solidity 0.8.28;\ncontract Probe { function bal(address a) external view returns (uint256) { return a.balance; } }",
        },
      },
      settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
    }),
  ),
).contracts["Probe.sol"].Probe;
const probeAbi = probeOut.abi;
const probeBytecode = `0x${probeOut.evm.bytecode.object}`;

const USER = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NATIVE = "0x0000000000000000000000000000000000000000";
const POOL_FEE = 10_000;

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const router = getContractAddress({ from: USER, nonce: 0n });
const probe = getContractAddress({ from: USER, nonce: 1n });
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
const spend = parseEther("0.01");

const swap = (p) =>
  encodeFunctionData({ abi: artifact.abi, functionName: "swapV3", args: [p] });

/** Deploy both, buy USDG with ether, then sell the lot back. */
const setup = [
  { data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [TREASURY] }) },
  { data: encodeDeployData({ abi: probeAbi, bytecode: probeBytecode, args: [] }) },
];

const buy = {
  to: router,
  value: spend,
  data: swap({
    tokenIn: NATIVE, tokenOut: USDG, poolFee: POOL_FEE, amountIn: spend,
    minOut: 0n, feeBps: 25, feeOnInput: true, deadline,
  }),
};

function routedEvent(result) {
  for (const log of result.logs ?? []) {
    try {
      const decoded = decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Routed") return decoded.args;
    } catch {}
  }
  return undefined;
}

function report(label, results, index) {
  const result = results[index];
  if (result.status !== "success") {
    console.log(`${label}: FAILED — ${result.error?.shortMessage ?? result.error}`);
    return undefined;
  }
  return routedEvent(result);
}

/* ---- buy: fee taken on the input, which is the funding asset ---- */
const first = await client.simulateCalls({
  account: USER,
  stateOverrides: [{ address: USER, balance: parseEther("100") }],
  calls: [
    ...setup,
    // Read first: these are real addresses and may already hold something, so
    // every figure below is a delta rather than a balance.
    { to: probe, abi: probeAbi, functionName: "bal", args: [TREASURY] },
    { to: USDG, abi: erc20, functionName: "balanceOf", args: [USER] },
    buy,
    { to: USDG, abi: erc20, functionName: "balanceOf", args: [USER] },
    { to: USDG, abi: erc20, functionName: "balanceOf", args: [TREASURY] },
    { to: probe, abi: probeAbi, functionName: "bal", args: [TREASURY] },
    { to: probe, abi: probeAbi, functionName: "bal", args: [router] },
  ],
});

const bought = report("buy", first.results, 4);
const usdgUser = first.results[5].result - first.results[3].result;
const feeEth = first.results[7].result - first.results[2].result;

console.log("— buy 0.01 ETH -> USDG, 25 bps on the input (ether) —");
console.log("  user receives   :", formatUnits(usdgUser, 6), "USDG");
console.log("  treasury USDG   :", formatUnits(first.results[6].result, 6), "(0 expected: fee is in ether)");
console.log("  treasury ether  :", formatEther(feeEth), `(${Number((feeEth * 10_000n) / spend)} bps of the input)`);
console.log("  event fee       :", formatEther(bought?.fee ?? 0n), "ETH");
console.log("  router left with:", formatEther(first.results[8].result), "ETH (must be 0)");

/* ---- sell: 5% on the output, five times what SwapRouter02 permits ---- */
await new Promise((resolve) => setTimeout(resolve, 2_000));
// What the address held before any of this, so "sold out" means back to that.
const baselineUsdg = first.results[3].result;
const sellAll = usdgUser;
const second = await client.simulateCalls({
  account: USER,
  stateOverrides: [{ address: USER, balance: parseEther("100") }],
  calls: [
    ...setup,
    buy,
    { to: USDG, abi: erc20, functionName: "approve", args: [router, sellAll] },
    {
      to: router,
      data: swap({
        tokenIn: USDG, tokenOut: NATIVE, poolFee: POOL_FEE, amountIn: sellAll,
        minOut: 0n, feeBps: 500, feeOnInput: false, deadline,
      }),
    },
    { to: USDG, abi: erc20, functionName: "balanceOf", args: [USER] },
    { to: probe, abi: probeAbi, functionName: "bal", args: [router] },
    { to: USDG, abi: erc20, functionName: "balanceOf", args: [USER], blockOverrides: undefined },
  ],
});

const sold = report("sell", second.results, 4);
const gross = (sold?.amountOut ?? 0n) + (sold?.fee ?? 0n);

console.log("\n— sell all USDG -> ether, 500 bps on the output (ether) —");
console.log("  user receives   :", formatEther(sold?.amountOut ?? 0n), "ETH");
console.log("  treasury fee    :", formatEther(sold?.fee ?? 0n), "ETH");
console.log(
  "  effective rate  :",
  gross > 0n ? `${(Number(((sold?.fee ?? 0n) * 10000n) / gross) / 100).toFixed(2)}%` : "—",
  "(SwapRouter02 caps its own split at 1.00%)",
);
console.log(
  "  position closed :",
  second.results[5].result === baselineUsdg ? "yes" : `no — ${formatUnits(second.results[5].result - baselineUsdg, 6)} USDG still held`,
);
console.log("  router left with:", formatEther(second.results[6].result), "ETH (must be 0)");

/* ---- the caller's bound is checked after the fee, never before ---- */
const guard = await client.simulateCalls({
  account: USER,
  stateOverrides: [{ address: USER, balance: parseEther("100") }],
  calls: [
    ...setup,
    {
      to: router,
      value: spend,
      data: swap({
        tokenIn: NATIVE, tokenOut: USDG, poolFee: POOL_FEE, amountIn: spend,
        // A minimum set just above what the trade can deliver net of a 10% fee.
        minOut: 24_000_000n, feeBps: 1000, feeOnInput: false, deadline,
      }),
    },
  ],
});
const rejected = guard.results[2].status !== "success";
console.log("\n— minOut is enforced on what the caller actually receives —");
console.log(" ", rejected ? "rejected as it should be" : "ACCEPTED — the bound is not being applied");


/* ------------------------------------------------------------------ *
 * The launchpad path, which SwapRouter02 cannot reach at all.
 * ------------------------------------------------------------------ */

const PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

const factoryAbi = parseAbi([
  "struct L { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address) view returns (L)",
]);
const curveAbi = parseAbi(["function sellableTokens() view returns (uint256)"]);

/**
 * A launch that is still on its curve, found at run time. These are live
 * memecoins: any address written down here would have graduated or died long
 * before anyone read this, so one is looked up instead.
 */
async function findLiveCurve() {
  const head = await client.getBlockNumber();
  const logs = await client.getLogs({
    address: PONS_V2_FACTORY,
    fromBlock: head - 9_000n,
    toBlock: head,
  });

  // The public endpoint rate-limits a burst of single reads, so the candidates
  // are asked in batches rather than one at a time.
  const candidates = [
    ...new Set(logs.reverse().flatMap((log) => log.topics.slice(1).map((t) => `0x${t.slice(26)}`))),
  ].slice(0, 120);

  for (let i = 0; i < candidates.length; i += 40) {
    const batch = candidates.slice(i, i + 40);
    const records = await client.multicall({
      allowFailure: true,
      contracts: batch.map((address) => ({
        address: PONS_V2_FACTORY, abi: factoryAbi,
        functionName: "getLaunchedToken", args: [address],
      })),
    });
    // A native-quoted curve exercises the value path and the refund sweep.
    const live = records
      .filter((r) => r.status === "success" && r.result.exists && r.result.phase === 0)
      .map((r) => r.result)
      .filter((r) => r.pairToken === NATIVE);
    if (live.length === 0) continue;

    const sellable = await client.multicall({
      allowFailure: true,
      contracts: live.map((r) => ({
        address: r.curve, abi: curveAbi, functionName: "sellableTokens",
      })),
    });
    for (const [n, result] of sellable.entries()) {
      if (result.status === "success" && result.result > 0n) return live[n];
    }
  }
  return undefined;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await pause(2_000);
const launch = await findLiveCurve();
await pause(2_000);

if (!launch) {
  console.log("\n— launchpad curve —");
  console.log("  no live native-quoted curve in the last 9k blocks; skipped");
} else {
  const trade = (p) =>
    encodeFunctionData({ abi: artifact.abi, functionName: "tradeCurve", args: [p] });
  const stake = parseEther("0.001");
  const token = launch.token;
  const tokenAbi = erc20;

  const curveBuy = {
    to: router,
    value: stake,
    data: trade({
      token, buying: true, amountIn: stake, minOut: 0n,
      feeBps: 25, feeOnInput: true, deadline,
    }),
  };

  const res = await client.simulateCalls({
    account: USER,
    stateOverrides: [{ address: USER, balance: parseEther("100") }],
    calls: [
      ...setup,
      { to: probe, abi: probeAbi, functionName: "bal", args: [TREASURY] },
      curveBuy,
      { to: token, abi: tokenAbi, functionName: "balanceOf", args: [USER] },
      { to: probe, abi: probeAbi, functionName: "bal", args: [TREASURY] },
      { to: probe, abi: probeAbi, functionName: "bal", args: [router] },
    ],
  });

  const bought = report("curve buy", res.results, 3);
  const held = res.results[4].result;
  const curveFee = res.results[5].result - res.results[2].result;

  console.log("\n— launchpad curve: 0.001 ETH -> token, 25 bps on the input —");
  console.log("  token          :", token);
  console.log("  user receives  :", formatUnits(held, 18), "tokens");
  console.log("  treasury ether :", formatEther(curveFee), `(${Number((curveFee * 10_000n) / stake)} bps)`);
  console.log("  event fee      :", formatEther(bought?.fee ?? 0n), "ETH");
  console.log("  router left    :", formatEther(res.results[6].result), "ETH (must be 0)");

  /* And back out, charged a tenth of the proceeds — the performance-fee shape. */
  await pause(2_000);
  const exit = await client.simulateCalls({
    account: USER,
    stateOverrides: [{ address: USER, balance: parseEther("100") }],
    calls: [
      ...setup,
      curveBuy,
      { to: token, abi: tokenAbi, functionName: "approve", args: [router, held] },
      {
        to: router,
        data: trade({
          token, buying: false, amountIn: held, minOut: 0n,
          feeBps: 1000, feeOnInput: false, deadline,
        }),
      },
      { to: token, abi: tokenAbi, functionName: "balanceOf", args: [USER] },
      { to: probe, abi: probeAbi, functionName: "bal", args: [router] },
    ],
  });

  const sold2 = report("curve sell", exit.results, 4);
  const gross2 = (sold2?.amountOut ?? 0n) + (sold2?.fee ?? 0n);
  console.log("\n— launchpad curve: token -> ether, 1000 bps on the output —");
  console.log("  user receives  :", formatEther(sold2?.amountOut ?? 0n), "ETH");
  console.log("  treasury fee   :", formatEther(sold2?.fee ?? 0n), "ETH");
  console.log(
    "  effective rate :",
    gross2 > 0n ? `${(Number(((sold2?.fee ?? 0n) * 10_000n) / gross2) / 100).toFixed(2)}%` : "—",
    "(SwapRouter02 can charge nothing at all here)",
  );
  console.log("  tokens left    :", formatUnits(exit.results[5].result, 18), "(0 expected)");
  console.log("  router left    :", formatEther(exit.results[6].result), "ETH (must be 0)");
}

/* ------------------------------------------------------------------ *
 * The app and the contract have to agree on the calldata, or none of the
 * above says anything about what Snyper will actually send.
 * ------------------------------------------------------------------ */

const { snyperRouterAbi } = await import("../src/lib/abi.ts");

const selectors = (abi) =>
  Object.fromEntries(
    abi
      .filter((entry) => entry.type === "function")
      .map((entry) => [entry.name, toFunctionSelector(entry)]),
  );

const fromContract = selectors(artifact.abi);
const fromApp = selectors(snyperRouterAbi);

console.log("\n— the app's ABI against the compiled contract —");
let agreed = true;
for (const [name, selector] of Object.entries(fromApp)) {
  const match = fromContract[name] === selector;
  if (!match) agreed = false;
  console.log(`  ${match ? "ok  " : "MISMATCH"} ${name} ${selector} vs ${fromContract[name] ?? "absent"}`);
}
console.log(agreed ? "  the app encodes what the contract decodes" : "  THE APP WOULD SEND CALLDATA THE CONTRACT REJECTS");

console.log("\nrouter in simulation:", router);
