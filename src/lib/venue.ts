import type { PublicClient } from "viem";
import { getAddress, isAddress, zeroAddress } from "viem";
import { erc20Abi, ponsV1FactoryAbi, swapRouter02Abi } from "./abi";
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

/**
 * An address, or nothing. The zero address is not one: it is what an unset slot
 * in a launchpad record reads as, and routing against it would fail every trade
 * rather than fall through to a venue that works.
 */
function address(value: string | undefined): `0x${string}` | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !isAddress(trimmed)) return undefined;
  const parsed = getAddress(trimmed);
  return parsed === zeroAddress ? undefined : parsed;
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
 *
 * Nothing here is batched through multicall3, and every read is allowed to fail
 * on its own. Both are deliberate: an aggregator that is missing or a single
 * view that reverts used to sink the whole lookup, and a venue that fails to
 * resolve costs the app every price and every trade at once. The transport
 * batches these into one request anyway.
 */
export async function discoverVenue(
  client: PublicClient,
): Promise<VenueConfig | undefined> {
  const [dexCount, launchCount] = await configCounts(client);

  const [dexConfigs, launchConfigs] = await Promise.all([
    Promise.all(
      configIds(dexCount).map((id) =>
        tryRead(
          client.readContract({
            address: PONS_V1_FACTORY,
            abi: ponsV1FactoryAbi,
            functionName: "getDexConfig",
            args: [id],
          }),
        ),
      ),
    ),
    Promise.all(
      configIds(launchCount).map((id) =>
        tryRead(
          client.readContract({
            address: PONS_V1_FACTORY,
            abi: ponsV1FactoryAbi,
            functionName: "getLaunchConfig",
            args: [id],
          }),
        ),
      ),
    ),
  ]);

  // Newest first: configs are appended and never renumbered, so the last entry
  // is the venue the launchpad opens pools in today. An enabled config wins,
  // but a retired one is still taken over nothing — `enabled` says whether the
  // launchpad still launches into that DEX, not whether its pools still trade.
  // Only the router has to be there: a record that left its factory unset is
  // still routable, because the router names the factory it swaps against.
  const dexes = newestFirst(dexConfigs).filter((config) => address(config.swapRouter));
  const dex = dexes.find((config) => config.enabled) ?? dexes[0];
  if (!dex) return undefined;

  // The pair token every V1 launch trades against is the chain's wrapped
  // native. It is a hint rather than a requirement: the router knows its own.
  const launches = newestFirst(launchConfigs).filter((config) =>
    address(config.pairToken),
  );
  const launch = launches.find((config) => config.enabled) ?? launches[0];

  return completeVenue(client, {
    factory: dex.factory,
    router: dex.swapRouter,
    wrapped: launch?.pairToken,
    poolFee: dex.poolFee,
  });
}

/**
 * The venue one token actually trades in, read off its own launch record. A V1
 * launch names the DEX it was minted into and the tier its pool sits in, so a
 * pasted contract address resolves routing by itself — which is what keeps a
 * launchpad-wide lookup that came back empty from costing the reader the trade
 * they were looking at.
 */
export async function venueFromLaunch(
  client: PublicClient,
  token: `0x${string}`,
): Promise<VenueConfig | undefined> {
  const launch = await tryRead(
    client.readContract({
      address: PONS_V1_FACTORY,
      abi: ponsV1FactoryAbi,
      functionName: "getLaunchedToken",
      args: [token],
    }),
  );
  if (!launch?.exists) return undefined;

  const dex = await tryRead(
    client.readContract({
      address: PONS_V1_FACTORY,
      abi: ponsV1FactoryAbi,
      functionName: "getDexConfig",
      args: [launch.dexId],
    }),
  );
  if (!dex) return undefined;

  return completeVenue(client, {
    factory: dex.factory,
    router: dex.swapRouter,
    wrapped: launch.pairedToken,
    // This token's own tier, which is the one worth probing before the ladder.
    poolFee: Number(launch.poolFee) || Number(dex.poolFee),
  });
}

/**
 * Fills in what a launchpad record does not carry. SwapRouter02 publishes both
 * the wrapped native it settles through and the factory it routes against, so
 * one read off the router completes a venue on its own. The wrapped symbol is
 * read from the token rather than assumed, because a chain that calls its coin
 * something else should not be labelled WETH in the interface.
 */
async function completeVenue(
  client: PublicClient,
  partial: {
    factory?: string;
    router?: string;
    wrapped?: string;
    poolFee?: number | bigint;
  },
): Promise<VenueConfig | undefined> {
  const router = address(partial.router);
  if (!router) return undefined;

  const [routerWrapped, routerFactory] = await Promise.all([
    tryRead(
      client.readContract({ address: router, abi: swapRouter02Abi, functionName: "WETH9" }),
    ),
    tryRead(
      client.readContract({ address: router, abi: swapRouter02Abi, functionName: "factory" }),
    ),
  ]);

  const wrapped = address(partial.wrapped) ?? address(routerWrapped);
  const factory = address(partial.factory) ?? address(routerFactory);
  if (!wrapped || !factory) return undefined;

  const symbol = await tryRead(
    client.readContract({ address: wrapped, abi: erc20Abi, functionName: "symbol" }),
  );

  return {
    factory,
    router,
    wrapped,
    wrappedSymbol: symbol,
    poolFee: partial.poolFee === undefined ? undefined : Number(partial.poolFee),
  };
}

/**
 * Completes a hand-entered venue from the chain. An operator who found the
 * router in a block explorer should not have to hunt down the factory and the
 * wrapped native as well: the router publishes both, so one address is enough
 * to pin the app to a venue. Returns the entry untouched when the chain had
 * nothing to add, so a half-filled config still fails closed rather than being
 * patched with guesses.
 */
export async function completeVenueConfig(
  client: PublicClient,
  config: VenueConfig,
): Promise<VenueConfig> {
  if (address(config.factory) && address(config.wrapped)) return config;

  const completed = await completeVenue(client, {
    factory: config.factory,
    router: config.router,
    wrapped: config.wrapped,
    poolFee:
      config.poolFee === undefined || config.poolFee === ""
        ? undefined
        : Number(config.poolFee),
  });
  return completed ? { ...config, ...completed } : config;
}

/** A read that answers with nothing rather than throwing. */
function tryRead<T>(read: Promise<T>): Promise<T | undefined> {
  return read.then(
    (value) => value,
    () => undefined,
  );
}

/** The answers that came back, newest first. A failed read is simply absent. */
function newestFirst<T>(results: readonly (T | undefined)[]): T[] {
  return [...results].reverse().filter((entry): entry is T => entry !== undefined);
}

/**
 * How many configs each list holds. A count view that reverts — a launchpad
 * generation that never had it, an address that turned out to be something
 * else — reads as zero rather than throwing, and the blind window below covers
 * the case where the configs are there but the count is not.
 */
async function configCounts(client: PublicClient): Promise<[bigint, bigint]> {
  const [dex, launch] = await Promise.all([
    tryRead(
      client.readContract({
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "dexConfigCount",
      }),
    ),
    tryRead(
      client.readContract({
        address: PONS_V1_FACTORY,
        abi: ponsV1FactoryAbi,
        functionName: "launchConfigCount",
      }),
    ),
  ]);

  return [dex ?? 0n, launch ?? 0n];
}

/** Ids to read: what the count names, or a blind window when it named nothing. */
function configIds(count: bigint): bigint[] {
  const known = indices(count);
  return known.length > 0
    ? known
    : Array.from({ length: 8 }, (_, index) => BigInt(index));
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
