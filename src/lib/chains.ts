import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import type { Chain } from "viem";

/**
 * Uniswap v3 deployments. QuoterV2 shares one address across Ethereum,
 * Optimism, Polygon and Arbitrum; Base has its own deployment.
 */
export type ChainMeta = {
  chain: Chain;
  /** Short label used across the interface. */
  label: string;
  /** Two letter mark drawn in the chain badge. */
  mark: string;
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
  explorer: string;
  /** Uniswap fee tiers probed when routing. */
  feeTiers: readonly number[];
};

const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as const;
const ROUTER_02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as const;
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as const;
const FEE_TIERS = [100, 500, 3000, 10000] as const;

export const SUPPORTED_CHAINS = [mainnet, base, arbitrum, optimism, polygon] as const;

export const CHAIN_META: Record<number, ChainMeta> = {
  [mainnet.id]: {
    chain: mainnet,
    label: "Ethereum",
    mark: "ETH",
    quoter: QUOTER_V2,
    factory: FACTORY,
    router: ROUTER_02,
    wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    wrappedSymbol: "WETH",
    stable: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    stableSymbol: "USDC",
    stableDecimals: 6,
    explorer: "https://etherscan.io",
    feeTiers: FEE_TIERS,
  },
  [base.id]: {
    chain: base,
    label: "Base",
    mark: "BASE",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    wrapped: "0x4200000000000000000000000000000000000006",
    wrappedSymbol: "WETH",
    stable: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    stableSymbol: "USDC",
    stableDecimals: 6,
    explorer: "https://basescan.org",
    feeTiers: FEE_TIERS,
  },
  [arbitrum.id]: {
    chain: arbitrum,
    label: "Arbitrum",
    mark: "ARB",
    quoter: QUOTER_V2,
    factory: FACTORY,
    router: ROUTER_02,
    wrapped: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    wrappedSymbol: "WETH",
    stable: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    stableSymbol: "USDC",
    stableDecimals: 6,
    explorer: "https://arbiscan.io",
    feeTiers: FEE_TIERS,
  },
  [optimism.id]: {
    chain: optimism,
    label: "Optimism",
    mark: "OP",
    quoter: QUOTER_V2,
    factory: FACTORY,
    router: ROUTER_02,
    wrapped: "0x4200000000000000000000000000000000000006",
    wrappedSymbol: "WETH",
    stable: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    stableSymbol: "USDC",
    stableDecimals: 6,
    explorer: "https://optimistic.etherscan.io",
    feeTiers: FEE_TIERS,
  },
  [polygon.id]: {
    chain: polygon,
    label: "Polygon",
    mark: "POL",
    quoter: QUOTER_V2,
    factory: FACTORY,
    router: ROUTER_02,
    wrapped: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    wrappedSymbol: "WMATIC",
    stable: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    stableSymbol: "USDC",
    stableDecimals: 6,
    explorer: "https://polygonscan.com",
    feeTiers: FEE_TIERS,
  },
};

export const DEFAULT_CHAIN_ID = base.id;

export function chainMeta(chainId: number | undefined): ChainMeta | undefined {
  return chainId === undefined ? undefined : CHAIN_META[chainId];
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
