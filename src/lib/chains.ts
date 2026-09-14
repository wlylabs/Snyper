import { arbitrum, base, mainnet, optimism, polygon, robinhood } from "viem/chains";
import { getAddress, isAddress, type Chain } from "viem";

/**
 * Uniswap v3 deployment for a chain. Not every supported network has one —
 * `ChainMeta.dex` is undefined where no deployment is known, and the interface
 * degrades to balances and token discovery instead of guessing addresses.
 */
export type DexMeta = {
  /** Uniswap v3 QuoterV2 (read-only pricing). */
  quoter: `0x${string}`;
  /** Uniswap v3 core factory, used to resolve pools per fee tier. */
  factory: `0x${string}`;
  /** Uniswap SwapRouter02 (execution). */
  router: `0x${string}`;
  /** Canonical wrapped native token. */
  wrapped: `0x${string}`;
  /** Symbol the wrapped contract actually reports. */
  wrappedSymbol: string;
  /** Native USD stablecoin used as the pricing unit. */
  stable: `0x${string}`;
  stableSymbol: string;
  stableDecimals: number;
  /** Uniswap fee tiers probed when routing. */
  feeTiers: readonly number[];
};

export type ChainMeta = {
  chain: Chain;
  /** Short label used across the interface. */
  label: string;
  /** Short mark drawn in the chain badge. */
  mark: string;
  explorer: string;
  dex?: DexMeta;
};

/** QuoterV2 shares one address across Ethereum, Optimism, Polygon and Arbitrum. */
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as const;
const ROUTER_02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as const;
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as const;
const FEE_TIERS = [100, 500, 3000, 10000] as const;

function optionalAddress(value: string | undefined): `0x${string}` | undefined {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? getAddress(trimmed) : undefined;
}

/**
 * Chains without a published Uniswap v3 deployment can still be routed by an
 * operator who points these at their own venue. Every field has to resolve, or
 * the chain stays read-only rather than pricing against a half-configured DEX.
 */
function envDex(input: {
  quoter?: string;
  factory?: string;
  router?: string;
  wrapped?: string;
  wrappedSymbol?: string;
  stable?: string;
  stableSymbol?: string;
  stableDecimals?: string;
}): DexMeta | undefined {
  const quoter = optionalAddress(input.quoter);
  const factory = optionalAddress(input.factory);
  const router = optionalAddress(input.router);
  const wrapped = optionalAddress(input.wrapped);
  const stable = optionalAddress(input.stable);
  if (!quoter || !factory || !router || !wrapped || !stable) return undefined;

  const decimals = Number(input.stableDecimals?.trim() || "6");
  return {
    quoter,
    factory,
    router,
    wrapped,
    wrappedSymbol: input.wrappedSymbol?.trim() || "WETH",
    stable,
    stableSymbol: input.stableSymbol?.trim() || "USDC",
    stableDecimals: Number.isFinite(decimals) ? decimals : 6,
    feeTiers: FEE_TIERS,
  };
}

/**
 * Robinhood Chain ships no canonical Uniswap v3 deployment, so routing stays off
 * until an operator supplies one. Balances, token discovery and transfers work
 * either way.
 */
const ROBINHOOD_DEX = envDex({
  quoter: process.env.NEXT_PUBLIC_QUOTER_4663,
  factory: process.env.NEXT_PUBLIC_FACTORY_4663,
  router: process.env.NEXT_PUBLIC_ROUTER_4663,
  wrapped: process.env.NEXT_PUBLIC_WRAPPED_4663,
  wrappedSymbol: process.env.NEXT_PUBLIC_WRAPPED_SYMBOL_4663,
  stable: process.env.NEXT_PUBLIC_STABLE_4663,
  stableSymbol: process.env.NEXT_PUBLIC_STABLE_SYMBOL_4663,
  stableDecimals: process.env.NEXT_PUBLIC_STABLE_DECIMALS_4663,
});

export const SUPPORTED_CHAINS = [
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  robinhood,
] as const;

export const CHAIN_META: Record<number, ChainMeta> = {
  [mainnet.id]: {
    chain: mainnet,
    label: "Ethereum",
    mark: "ETH",
    explorer: "https://etherscan.io",
    dex: {
      quoter: QUOTER_V2,
      factory: FACTORY,
      router: ROUTER_02,
      wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      wrappedSymbol: "WETH",
      stable: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      stableSymbol: "USDC",
      stableDecimals: 6,
      feeTiers: FEE_TIERS,
    },
  },
  [base.id]: {
    chain: base,
    label: "Base",
    mark: "BASE",
    explorer: "https://basescan.org",
    dex: {
      quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
      router: "0x2626664c2603336E57B271c5C0b26F421741e481",
      wrapped: "0x4200000000000000000000000000000000000006",
      wrappedSymbol: "WETH",
      stable: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      stableSymbol: "USDC",
      stableDecimals: 6,
      feeTiers: FEE_TIERS,
    },
  },
  [arbitrum.id]: {
    chain: arbitrum,
    label: "Arbitrum",
    mark: "ARB",
    explorer: "https://arbiscan.io",
    dex: {
      quoter: QUOTER_V2,
      factory: FACTORY,
      router: ROUTER_02,
      wrapped: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      wrappedSymbol: "WETH",
      stable: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      stableSymbol: "USDC",
      stableDecimals: 6,
      feeTiers: FEE_TIERS,
    },
  },
  [optimism.id]: {
    chain: optimism,
    label: "Optimism",
    mark: "OP",
    explorer: "https://optimistic.etherscan.io",
    dex: {
      quoter: QUOTER_V2,
      factory: FACTORY,
      router: ROUTER_02,
      wrapped: "0x4200000000000000000000000000000000000006",
      wrappedSymbol: "WETH",
      stable: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      stableSymbol: "USDC",
      stableDecimals: 6,
      feeTiers: FEE_TIERS,
    },
  },
  [polygon.id]: {
    chain: polygon,
    label: "Polygon",
    mark: "POL",
    explorer: "https://polygonscan.com",
    dex: {
      quoter: QUOTER_V2,
      factory: FACTORY,
      router: ROUTER_02,
      wrapped: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      wrappedSymbol: "WMATIC",
      stable: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      stableSymbol: "USDC",
      stableDecimals: 6,
      feeTiers: FEE_TIERS,
    },
  },
  [robinhood.id]: {
    chain: robinhood,
    label: "Robinhood",
    mark: "RH",
    explorer: robinhood.blockExplorers.default.url,
    dex: ROBINHOOD_DEX,
  },
};

export const DEFAULT_CHAIN_ID = base.id;

export function chainMeta(chainId: number | undefined): ChainMeta | undefined {
  return chainId === undefined ? undefined : CHAIN_META[chainId];
}

/** Uniswap deployment for a chain, or undefined where routing is unavailable. */
export function dexMeta(chainId: number | undefined): DexMeta | undefined {
  return chainId === undefined ? undefined : CHAIN_META[chainId]?.dex;
}

export function hasRouting(chainId: number | undefined): boolean {
  return Boolean(dexMeta(chainId));
}

export function isSupportedChain(chainId: number | undefined): boolean {
  return chainId !== undefined && chainId in CHAIN_META;
}

export function explorerTx(chainId: number, hash: string): string {
  const meta = CHAIN_META[chainId];
  return meta ? `${meta.explorer}/tx/${hash}` : "";
}

export function explorerAddress(chainId: number, address: string): string {
  const meta = CHAIN_META[chainId];
  return meta ? `${meta.explorer}/address/${address}` : "";
}

/** Sentinel used across the app for a chain's native currency. */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export function isNative(address: string): boolean {
  return address.toLowerCase() === NATIVE.toLowerCase();
}
