import type { PublicClient } from "viem";
import { getAddress } from "viem";
import { ponsCurveAbi, ponsV1FactoryAbi, ponsV2FactoryAbi } from "./abi";
import { NATIVE } from "./native";
import type { Token } from "./tokens";

/**
 * The two Pons launchpad factories on Robinhood Chain, from the verified
 * sources at github.com/ponsdotdev/ponsfamily. Both are read-only here: the app
 * never launches a token, it only asks the factories what a pasted address is.
 */
export const PONS_V1_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB" as const;
export const PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as const;

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const BPS = 10_000n;

/**
 * V2's graduation phases, in the order the enum declares them. Only the first
 * one still trades on the curve; everything after it has moved to Uniswap v4.
 */
export const GRADUATION_PHASE = ["curve", "swept", "pool", "rescued"] as const;
export type GraduationPhase = (typeof GRADUATION_PHASE)[number];

/**
 * A V1 launch: a fixed-supply ERC-20 whose liquidity was minted into a Uniswap
 * v3 pool at launch and locked there, so it routes like any other v3 token.
 */
export type PonsV1Launch = {
  gen: "v1";
  token: `0x${string}`;
  deployer: `0x${string}`;
  /** The asset the pool is paired against — wrapped native on every preset. */
  pairedToken: `0x${string}`;
  poolFee: number;
  /** Anti-snipe limits on the token expire at this block. */
  restrictionsEndBlock: bigint;
  supply: bigint;
  /** Locked principal against the launchpad's own graduation threshold. */
  graduated: boolean;
  lockedPrincipal: bigint;
  graduationThreshold: bigint;
};

/**
 * A V2 launch. Before graduation the whole supply sits on its own bonding
 * curve and trades there; afterwards it lives in a Uniswap v4 pool, which this
 * app has no router for.
 */
export type PonsV2Launch = {
  gen: "v2";
  token: `0x${string}`;
  curve: `0x${string}`;
  deployer: `0x${string}`;
  /** Zero means the curve trades in native ETH. */
  pairToken: `0x${string}`;
  poolFee: number;
  creatorTaxBps: number;
  graduationThreshold: bigint;
  phase: GraduationPhase;
};

export type PonsLaunch = PonsV1Launch | PonsV2Launch;

/**
 * Asks both launchpad generations whether they minted this address. This is the
 * detection that turns a pasted contract address into a known memecoin: the
 * launchpad's own record says what the token is, what it trades against and
 * where, with no indexer and no token list involved.
 */
export async function readPonsLaunch(
  client: PublicClient,
  token: `0x${string}`,
): Promise<PonsLaunch | undefined> {
  const [v1, v2, status] = await client.multicall({
    allowFailure: true,
    contracts: [
      {
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "getLaunchedToken" as const,
        args: [token] as const,
      },
      {
        address: PONS_V2_FACTORY,
        abi: ponsV2FactoryAbi,
        functionName: "getLaunchedToken" as const,
        args: [token] as const,
      },
      {
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "graduationStatus" as const,
        args: [token] as const,
      },
    ],
  });

  if (v2.status === "success" && v2.result.exists) {
    const record = v2.result;
    return {
      gen: "v2",
      token: getAddress(record.token),
      curve: getAddress(record.curve),
      deployer: getAddress(record.deployer),
      pairToken: getAddress(record.pairToken),
      poolFee: Number(record.poolFee),
      creatorTaxBps: Number(record.creatorTaxBps),
      graduationThreshold: record.graduationThreshold,
      phase: GRADUATION_PHASE[Number(record.phase)] ?? "curve",
    };
  }

  if (v1.status === "success" && v1.result.exists) {
    const record = v1.result;
    const [lockedPrincipal, threshold, graduated] =
      status.status === "success" ? status.result : [0n, 0n, false];
    return {
      gen: "v1",
      token: getAddress(record.token),
      deployer: getAddress(record.deployer),
      pairedToken: getAddress(record.pairedToken),
      poolFee: Number(record.poolFee),
      restrictionsEndBlock: record.restrictionsEndBlock,
      supply: record.supply,
      graduated,
      lockedPrincipal,
      graduationThreshold: threshold,
    };
  }

  return undefined;
}

/** True while a V2 launch still trades on its curve rather than a v4 pool. */
export function tradesOnCurve(launch: PonsLaunch | undefined): launch is PonsV2Launch {
  return launch?.gen === "v2" && launch.phase === "curve";
}

/** The live state of one bonding curve, everything a quote needs. */
export type CurveState = {
  curve: `0x${string}`;
  token: `0x${string}`;
  /** Zero for a native-quoted curve. */
  pairToken: `0x${string}`;
  quoteReserve: bigint;
  tokenReserve: bigint;
  /** Quote asset actually held, which is what a seller can be paid out of. */
  realQuoteReserve: bigint;
  /** Tokens left to buy before the curve graduates. */
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  graduationThreshold: bigint;
  graduated: boolean;
  readyToGraduate: boolean;
};

export async function readCurveState(
  client: PublicClient,
  curve: `0x${string}`,
): Promise<CurveState | undefined> {
  const reads = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: curve, abi: ponsCurveAbi, functionName: "token" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "pairToken" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "getReserves" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "realQuoteReserve" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "sellableTokens" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "feeBps" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "creatorTaxBps" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "graduationThreshold" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "graduated" as const },
      { address: curve, abi: ponsCurveAbi, functionName: "readyToGraduate" as const },
    ],
  });

  const [token, pairToken, reserves, realQuote, sellable, fee, tax, threshold, graduated, ready] =
    reads;
  // The pair token decides which asset a trade may be funded with, so a curve
  // that will not say is one the app declines to route rather than guess at.
  if (
    token.status !== "success" ||
    pairToken.status !== "success" ||
    reserves.status !== "success"
  ) {
    return undefined;
  }

  return {
    curve,
    token: getAddress(token.result),
    pairToken: getAddress(pairToken.result),
    quoteReserve: reserves.result[0],
    tokenReserve: reserves.result[1],
    realQuoteReserve: realQuote.status === "success" ? realQuote.result : 0n,
    sellableTokens: sellable.status === "success" ? sellable.result : 0n,
    feeBps: fee.status === "success" ? fee.result : 0n,
    creatorTaxBps: tax.status === "success" ? tax.result : 0n,
    graduationThreshold: threshold.status === "success" ? threshold.result : 0n,
    graduated: graduated.status === "success" ? graduated.result : false,
    readyToGraduate: ready.status === "success" ? ready.result : false,
  };
}

/** Constant product, matching `PonsV2BondingCurveMath.getAmountOut` exactly. */
function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

/** Constant product, matching `PonsV2BondingCurveMath.getAmountIn` exactly. */
function amountIn(out: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (out <= 0n || reserveIn <= 0n || reserveOut <= out) return 0n;
  return (out * reserveIn) / (reserveOut - out) + 1n;
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return divisor === 0n ? 0n : (value + divisor - 1n) / divisor;
}

export type CurveFill = {
  /** Quote actually charged. Below `offered` when the buy clears the curve. */
  spent: bigint;
  amountOut: bigint;
  /** Quote refunded because the curve ran out of sellable supply. */
  refund: bigint;
  /** Combined trade fee and creator tax, in hundredths of a bip. */
  fee: number;
};

/**
 * Prices a buy against the curve the way the contract will settle it, clamp
 * included: a buy that would take the curve past its reserved allocation is
 * filled up to that allocation and refunded the difference rather than
 * reverting, so quoting it any other way would misreport the last buy of a
 * launch.
 */
export function quoteCurveBuy(state: CurveState, offered: bigint): CurveFill | undefined {
  if (offered <= 0n || state.graduated || state.sellableTokens <= 0n) return undefined;

  const totalBps = state.feeBps + state.creatorTaxBps;
  if (totalBps >= BPS) return undefined;

  let spent = offered;
  let fee = (spent * state.feeBps) / BPS;
  let tax = (spent * state.creatorTaxBps) / BPS;
  let out = amountOut(spent - fee - tax, state.quoteReserve, state.tokenReserve);

  if (out > state.sellableTokens) {
    out = state.sellableTokens;
    const net = amountIn(state.sellableTokens, state.quoteReserve, state.tokenReserve);
    const grossed = ceilDiv(net * BPS, BPS - totalBps);
    spent = grossed < offered ? grossed : offered;
    fee = (spent * state.feeBps) / BPS;
    tax = (spent * state.creatorTaxBps) / BPS;
  }

  if (out <= 0n) return undefined;
  return {
    spent,
    amountOut: out,
    refund: offered - spent,
    fee: Number(totalBps) * 100,
  };
}

/**
 * Prices a sell back into the curve. The fee comes off the quote output here
 * too, so a seller never pays it in the memecoin.
 */
export function quoteCurveSell(state: CurveState, tokensIn: bigint): CurveFill | undefined {
  if (tokensIn <= 0n || state.graduated || state.readyToGraduate) return undefined;

  const totalBps = state.feeBps + state.creatorTaxBps;
  if (totalBps >= BPS) return undefined;

  const gross = amountOut(tokensIn, state.tokenReserve, state.quoteReserve);
  const fee = (gross * state.feeBps) / BPS;
  const tax = (gross * state.creatorTaxBps) / BPS;
  const out = gross - fee - tax;
  if (out <= 0n) return undefined;

  return { spent: tokensIn, amountOut: out, refund: 0n, fee: Number(totalBps) * 100 };
}

/**
 * Curve mid price as `tokenOut` per `tokenIn`, from the reserves alone. The
 * phantom quote reserve is part of the pricing by design, so this is the price
 * an infinitely small trade would get, exactly as on a pool.
 */
export function curveMidPrice(
  state: CurveState,
  tokenIn: Token,
  tokenOut: Token,
): number | undefined {
  const buying = isCurveToken(state, tokenOut);
  const reserveIn = buying ? state.quoteReserve : state.tokenReserve;
  const reserveOut = buying ? state.tokenReserve : state.quoteReserve;
  if (reserveIn <= 0n || reserveOut <= 0n) return undefined;

  const scaled =
    (reserveOut * 10n ** 18n * 10n ** BigInt(tokenIn.decimals)) /
    (reserveIn * 10n ** BigInt(tokenOut.decimals));
  const price = Number(scaled) / 1e18;
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

export function isCurveToken(state: CurveState, token: Token): boolean {
  return token.address.toLowerCase() === state.token.toLowerCase();
}
