import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

/**
 * The same coin, somewhere this app does not trade.
 *
 * Snyper reads chain 4663 and nothing else, which is the right scope for a
 * terminal — everything it quotes, routes and signs lives there. It is not the
 * scope a reader compares it against. Robinhood's own wallet, MetaMask and
 * Coinbase all fold one asset across every network they know about and print a
 * single figure: a row reading `0.000051 ETH` under two network badges is ether
 * on Robinhood Chain plus ether on Ethereum, added up. Snyper showing the 4663
 * half of that looks like a bug in Snyper, and a reader checking one screen
 * against the other has no way to tell it apart from one.
 *
 * So the other halves are read too — balance only, never routed against, never
 * spendable from here — so the page can say where the difference went and
 * reconcile to the number the wallet is showing.
 *
 * Nothing here is load bearing. A network that cannot be reached reports
 * nothing and the page is what it was before.
 */

export type ElsewhereBalance = {
  chainId: number;
  /** What the network is called on screen. */
  label: string;
  balance: bigint;
  decimals: number;
  symbol: string;
};

/** How long a network gets to answer before it is treated as absent. */
const TIMEOUT = 8000;

/**
 * Networks that hold the same coin as chain 4663.
 *
 * Ethereum is the only one that matters today: Robinhood Chain is an ether
 * network, so ether is the asset a wallet folds across both, and it is the
 * exact asset in the screenshots that disagree. Anything else added here has to
 * meet the same bar — same coin, same address, or the sum is nonsense.
 */
const NETWORKS: { chain: Chain; label: string }[] = [
  { chain: mainnet, label: "Ethereum" },
];

/**
 * An endpoint override per network, read literally rather than by lookup:
 * `NEXT_PUBLIC_*` is inlined at build time by substitution, so a computed
 * `process.env[name]` is undefined in the browser no matter what is configured.
 */
function endpoint(chainId: number): string | undefined {
  if (chainId === mainnet.id) return process.env.NEXT_PUBLIC_RPC_1?.trim() || undefined;
  return undefined;
}

/** False when a deployment has switched the cross-network read off. */
export function elsewhereEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ELSEWHERE?.trim().toLowerCase() !== "off";
}

const clients = new Map<number, PublicClient>();

function clientFor(chain: Chain): PublicClient {
  const existing = clients.get(chain.id);
  if (existing) return existing;
  const client = createPublicClient({
    chain,
    transport: http(endpoint(chain.id), { timeout: TIMEOUT }),
  }) as PublicClient;
  clients.set(chain.id, client);
  return client;
}

/**
 * What the address holds of the same coin on the networks above.
 *
 * Each network is asked on its own and allowed to fail on its own: one
 * unreachable endpoint should cost its own line, not the reconciliation. Empty
 * balances are dropped — a network the reader holds nothing on is not a fact
 * worth a row, it is noise on the screen that is meant to explain a difference.
 */
export async function readElsewhere(
  address: `0x${string}`,
): Promise<ElsewhereBalance[]> {
  if (!elsewhereEnabled()) return [];

  const readings = await Promise.all(
    NETWORKS.map(async ({ chain, label }) => {
      try {
        const balance = await clientFor(chain).getBalance({ address });
        if (balance <= 0n) return undefined;
        return {
          chainId: chain.id,
          label,
          balance,
          decimals: chain.nativeCurrency.decimals,
          symbol: chain.nativeCurrency.symbol,
        };
      } catch {
        return undefined;
      }
    }),
  );

  return readings.filter((reading): reading is ElsewhereBalance => Boolean(reading));
}
