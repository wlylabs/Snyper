"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { chainMeta } from "@/lib/chains";

/**
 * The coin balance, on its own clock.
 *
 * The holdings query behind it is expensive — an indexer call, a couple of
 * multicalls, a feed lookup and a pool read per unpriced token — so it runs on
 * a 45 second timer, and that timer is why a figure on this screen can sit half
 * a minute behind the wallet next to it. The coin balance is the exception
 * worth pulling out: it is one `eth_getBalance`, and it is the number a reader
 * actually watches, because it is what gas comes out of and what a swap just
 * moved.
 *
 * Chain 4663 produces a block every hundred milliseconds, so there is no head
 * to wait on and nothing a block subscription would buy — watching the head
 * over HTTP costs the same request as reading the balance and arrives no
 * sooner. The balance is simply asked for on an interval near the block time,
 * floored at something a public endpoint can carry and a reader cannot tell
 * from instant.
 */

/** No faster than this, whatever the chain's block time claims. */
const FLOOR = 3000;

/** And no slower, so a chain with long blocks still feels current. */
const CEILING = 12_000;

function interval(chainId: number | undefined): number {
  const blockTime = chainMeta(chainId)?.chain.blockTime;
  if (!blockTime) return FLOOR;
  return Math.min(CEILING, Math.max(FLOOR, blockTime));
}

export function nativeBalanceKey(chainId: number | undefined, address?: string) {
  return ["native-balance", chainId, address] as const;
}

export function useLiveNative(chainId: number | undefined): bigint | undefined {
  const { address } = useAccount();
  const client = usePublicClient({ chainId });

  const { data } = useQuery({
    queryKey: nativeBalanceKey(chainId, address),
    enabled: Boolean(client && address && chainId),
    queryFn: () => client!.getBalance({ address: address! }),
    refetchInterval: interval(chainId),
    // Nothing is cached here on purpose: a balance the reader is watching tick
    // is the one figure that should never be served from a previous answer.
    staleTime: 0,
    // Against the app-wide default, because a reader coming back to the tab is
    // asking this exact question, and the interval above pauses while away.
    refetchOnWindowFocus: true,
  });

  return data;
}
