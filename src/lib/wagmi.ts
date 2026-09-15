import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { robinhood } from "viem/chains";
import { SUPPORTED_CHAINS } from "./chains";

/** An env override points the chain at a private endpoint. */
export const RPC_OVERRIDE = process.env.NEXT_PUBLIC_RPC_4663?.trim() ?? "";

function endpoint() {
  return RPC_OVERRIDE
    ? http(RPC_OVERRIDE, { batch: true })
    : http(undefined, { batch: true });
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
