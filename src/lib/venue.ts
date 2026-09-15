import type { PublicClient } from "viem";
import { getAddress, isAddress } from "viem";
import { ponsV1FactoryAbi } from "./abi";
import { PONS_V1_FACTORY } from "./pons";

/**
 * Where a routing venue's addresses came from. The interface says which one is
 * in force, because an address read off the launchpad and an address typed by
 * hand deserve different amounts of trust.
 */
export type VenueSource = "env" | "manual" | "pons";

/**
 * The Uniswap v3 deployment the app routes through. Robinhood Chain publishes
 * no canonical deployment list the app can bundle, so every field here is
 * resolved at runtime rather than hardcoded: from the build's environment, from
 * the operator's own entry, or read off the Pons launchpad, which stores the
 * DEX it launches into on chain.
 */
export type Venue = {
  /**
   * Uniswap v3 QuoterV2. Optional: without it the app prices from the pool's
   * own state instead, which is an estimate rather than a simulated swap.
   */
  quoter?: `0x${string}`;
  /** Uniswap v3 core factory, used to resolve pools per fee tier. */
  factory: `0x${string}`;
  /** SwapRouter02, the contract a swap is actually sent to. */
  router: `0x${string}`;
  /** Canonical wrapped native token. */
  wrapped: `0x${string}`;
  wrappedSymbol: string;
  /** USD unit used for pricing. Robinhood Chain may not have one configured. */
  stable?: `0x${string}`;
  stableSymbol?: string;
  stableDecimals?: number;
  /** Fee tiers probed when routing, most likely first. */
  feeTiers: readonly number[];
  source: VenueSource;
};

/** What gets stored and what an operator types: addresses as loose strings. */
export type VenueConfig = {
  quoter?: string;
  factory?: string;
  router?: string;
  wrapped?: string;
  wrappedSymbol?: string;
  stable?: string;
  stableSymbol?: string;
  stableDecimals?: string | number;
  /** Fee tier the venue launches into, probed ahead of the standard ladder. */
  poolFee?: string | number;
};

const STANDARD_FEE_TIERS = [100, 500, 3000, 10000] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

function address(value: string | undefined): `0x${string}` | undefined {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? getAddress(trimmed) : undefined;
}

function feeTiers(poolFee: string | number | undefined): readonly number[] {
  const parsed = Number(poolFee);
  if (!Number.isFinite(parsed) || parsed <= 0) return STANDARD_FEE_TIERS;
  // The launchpad's own tier is the one its tokens are guaranteed to sit in, so
  // it gets probed first; the rest still follow for everything else on chain.
  return [parsed, ...STANDARD_FEE_TIERS.filter((tier) => tier !== parsed)];
}

/**
 * Turns a loose config into a venue, or nothing. A half-filled venue is refused
 * rather than patched with guesses: routing against a wrong router address is
 * how funds get lost, and reading balances with no venue at all is harmless.
 */
export function normalizeVenue(
  config: VenueConfig | undefined,
  source: VenueSource,
): Venue | undefined {
  if (!config) return undefined;
  const factory = address(config.factory);
  const router = address(config.router);
  const wrapped = address(config.wrapped);
  if (!factory || !router || !wrapped) return undefined;

  const stable = address(config.stable);
  const decimals = Number(config.stableDecimals ?? 6);

  return {
    quoter: address(config.quoter),
    factory,
    router,
    wrapped,
    wrappedSymbol: config.wrappedSymbol?.trim() || "WETH",
    stable,
    stableSymbol: stable ? config.stableSymbol?.trim() || "USDC" : undefined,
    stableDecimals: stable ? (Number.isFinite(decimals) ? decimals : 6) : undefined,
    feeTiers: feeTiers(config.poolFee),
    source,
  };
}

/** Build-time venue. An operator who sets these pins the app to their venue. */
export function envVenue(): Venue | undefined {
  return normalizeVenue(
    {
      quoter: process.env.NEXT_PUBLIC_QUOTER_4663,
      factory: process.env.NEXT_PUBLIC_FACTORY_4663,
      router: process.env.NEXT_PUBLIC_ROUTER_4663,
      wrapped: process.env.NEXT_PUBLIC_WRAPPED_4663,
      wrappedSymbol: process.env.NEXT_PUBLIC_WRAPPED_SYMBOL_4663,
      stable: process.env.NEXT_PUBLIC_STABLE_4663,
      stableSymbol: process.env.NEXT_PUBLIC_STABLE_SYMBOL_4663,
      stableDecimals: process.env.NEXT_PUBLIC_STABLE_DECIMALS_4663,
      poolFee: process.env.NEXT_PUBLIC_POOL_FEE_4663,
    },
    "env",
  );
}

/**
 * Precedence: what the build pins beats what the operator typed, which beats
 * what was read off the launchpad. Each layer is a deliberate act by someone
 * closer to the deployment than the one under it.
 */
export function resolveVenue(
  manual: VenueConfig | undefined,
  discovered: VenueConfig | undefined,
): Venue | undefined {
  return (
    envVenue() ??
    normalizeVenue(manual, "manual") ??
    normalizeVenue(discovered, "pons")
  );
}

/**
 * The venue every non-React caller reads. Kept as a module mirror of the stored
 * configuration rather than threaded through every signature: `dexMeta` is read
 * deep inside quoting, routing and position maths, all of which stay
 * synchronous. `VenueSync` writes it whenever the stored value changes.
 */
let active: Venue | undefined = envVenue();

export function activeVenue(): Venue | undefined {
  return active;
}

export function setActiveVenue(venue: Venue | undefined): void {
  active = venue;
}

/**
 * Reads the DEX the Pons launchpad itself routes into. The V1 factory stores
 * its venue on chain — the Uniswap v3 factory, the router it swaps through and
 * the fee tier it opens pools at — and its launch configs carry the pair token,
 * which is Robinhood Chain's wrapped native. That makes the launchpad a first
 * party source for the one thing the app cannot bundle, with no indexer and no
 * address anyone had to trust a third party for.
 */
export async function discoverVenue(
  client: PublicClient,
): Promise<VenueConfig | undefined> {
  const [dexCount, launchCount] = await client.multicall({
    allowFailure: false,
    contracts: [
      {
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "dexConfigCount" as const,
      },
      {
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "launchConfigCount" as const,
      },
    ],
  });

  const dexIds = indices(dexCount);
  const launchIds = indices(launchCount);
  if (dexIds.length === 0 || launchIds.length === 0) return undefined;

  const [dexConfigs, launchConfigs] = await Promise.all([
    client.multicall({
      allowFailure: true,
      contracts: dexIds.map((id) => ({
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "getDexConfig" as const,
        args: [id] as const,
      })),
    }),
    client.multicall({
      allowFailure: true,
      contracts: launchIds.map((id) => ({
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "getLaunchConfig" as const,
        args: [id] as const,
      })),
    }),
  ]);

  // The newest enabled entry wins: configs are appended, so the last one is the
  // venue the launchpad is currently opening pools in.
  const dex = [...dexConfigs]
    .reverse()
    .map((entry) => (entry.status === "success" ? entry.result : undefined))
    .find((config) => config?.enabled);
  const launch = [...launchConfigs]
    .reverse()
    .map((entry) => (entry.status === "success" ? entry.result : undefined))
    .find((config) => config?.enabled && config.pairToken !== ZERO);

  if (!dex || !launch) return undefined;

  return {
    factory: dex.factory,
    router: dex.swapRouter,
    wrapped: launch.pairToken,
    poolFee: dex.poolFee,
  };
}

/**
 * The newest config ids, since those are the ones in force. Configs are
 * appended and never renumbered, so reading from the end is what finds the
 * venue the launchpad opens pools in today; the window keeps a long history
 * from turning one lookup into dozens of calls.
 */
function indices(count: bigint): bigint[] {
  const total = Number(count);
  if (!Number.isFinite(total) || total <= 0) return [];
  const window = Math.min(total, 16);
  const first = total - window;
  return Array.from({ length: window }, (_, index) => BigInt(first + index));
}
