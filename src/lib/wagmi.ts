import { createConfig } from "@privy-io/wagmi";
import { fallback, http } from "wagmi";
import { robinhood } from "viem/chains";
import { SUPPORTED_CHAINS } from "./chains";

/** An env override points the chain at a private endpoint. */
export const RPC_OVERRIDE = process.env.NEXT_PUBLIC_RPC_4663?.trim() ?? "";

/** The same-origin relay to the same chain — see src/app/api/rpc/route.ts. */
const RELAY = "/api/rpc";

/** Per request, so a stalled endpoint fails over instead of hanging a screen. */
const TIMEOUT = 10_000;

/**
 * How calls are grouped into requests.
 *
 * `batch: true` means viem's default, which is a thousand calls per body. No
 * public endpoint accepts a body that size: it comes back 413 or times out, and
 * because a batch fails as one, a single oversized body fails every read in it.
 * The cap is set just above the widest caller in the app — the market scan, at
 * around forty multicalls — so that scan still costs one request while nothing
 * can assemble a body the endpoint will refuse.
 *
 * The short wait is what makes the batching worth having. Chain 4663 is read by
 * a screenful of hooks that all fire on the same tick, and eight milliseconds is
 * below anything a reader can perceive but above the gap between two of those
 * hooks, so what would have been a dozen requests against a rate limited
 * endpoint leaves as one.
 */
const BATCH = { batchSize: 48, wait: 8 } as const;

/**
 * Two ways to the same chain, tried in order.
 *
 * The direct call is the one that should win: it is a reader's own browser
 * talking to the chain's public endpoint, which is what that endpoint is for.
 * It is also the one with no recourse when it breaks, and it breaks in ways a
 * browser cannot report — a rate limited front door, a challenge page, an
 * extension that blocks RPC hosts, a captive network — all of which arrive as
 * `Failed to fetch` with no status to reason about. viem's own retries do not
 * help there: three attempts at 150ms land inside half a second, well within
 * whatever is refusing them.
 *
 * So the relay sits behind it. viem's fallback gives each transport no retries
 * of its own, which means the first failed direct call falls straight through to
 * this deployment's server — a different client, a different network, and an
 * answer from this origin that no cross-origin policy can reject. Reverts and
 * rejected signatures are not failover cases and viem does not treat them as
 * such, so a failing `eth_call` still fails once, with its own reason.
 *
 * Server side there is no origin to relay through — a relative URL is not
 * fetchable from the server, and the relay's upstream is the endpoint the server
 * would already be calling — so there the direct transport stands alone.
 */
function endpoint() {
  const direct = http(RPC_OVERRIDE || undefined, { batch: BATCH, timeout: TIMEOUT });
  if (typeof window === "undefined") return direct;
  return fallback([direct, http(RELAY, { batch: BATCH, timeout: TIMEOUT })]);
}

/**
 * Connectors are deliberately absent: Privy owns the connection surface, and
 * `@privy-io/wagmi` registers whatever the reader logged in with — an injected
 * wallet, a mobile wallet, or the embedded wallet Privy provisions — as the
 * active wagmi connector. Everything downstream keeps using plain wagmi hooks.
 *
 * The wagmi `Register` augmentation is intentionally omitted: hooks then accept
 * a plain `number` chain id, which keeps every chain id flowing from stored
 * snypes and signals assignable without casting. Chain support is validated at
 * runtime in `CHAIN_META`.
 */
export const config = createConfig({
  chains: SUPPORTED_CHAINS,
  transports: {
    [robinhood.id]: endpoint(),
  },
  ssr: true,
});
