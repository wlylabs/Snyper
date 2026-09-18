"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { CHAIN_ID } from "@/lib/chains";
import {
  SCAN_CONFIGURED,
  fetchCoinPrice,
  fetchTokenBalances,
  type ScanBalance,
} from "@/lib/blockscout";

export type Holding = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  /** Units held. */
  amount: number;
  /** USD per unit, when anything prices this token. */
  rate?: number;
  /** `amount * rate`, and undefined when nothing prices it. */
  value?: number;
  /**
   * Whether the figure above came back from the chain. False means the chain
   * refused the call and the index's own number is standing in its place.
   */
  confirmed: boolean;
};

/**
 * How many rows are worth a `balanceOf` each.
 *
 * All of them, and it costs one request: `batchSize: 0` tells viem not to chunk,
 * so every call goes into a single multicall3 `aggregate3` and leaves as one
 * `eth_call`. An address holding two hundred tokens is not unusual on this chain
 * — most of them airdropped — and reading those one at a time would be two
 * hundred calls against an endpoint the rest of the app is also using.
 */
const ONE_CALL = 0;

/**
 * Blockscout's verdict, honoured only when it is a verdict.
 *
 * Every token on chain 4663 currently reports `ok` — measured across the token
 * index and every holder sampled from recent blocks — so today this drops
 * nothing. It is here for the day that changes, because the alternative is a
 * balance screen that lists whatever was airdropped into the wallet with the
 * same authority as what the reader bought.
 *
 * Note the direction it fails in. If the index starts returning some other
 * word for tokens it simply has no opinion about, this hides them rather than
 * showing scams — under-reporting a wallet is recoverable, and the check is one
 * line to revisit.
 */
function reputable(token: ScanBalance["token"]): boolean {
  return token.reputation === null || token.reputation === "ok";
}

/** Money, held, and not flagged. Anything else is not a row on this screen. */
function spendable(entry: ScanBalance): boolean {
  if (entry.token.type !== "ERC-20") return false;
  if (!reputable(entry.token)) return false;
  return entry.value !== "0" && entry.token.decimals !== null;
}

/**
 * Priced first, by what they are worth; then the rest, alphabetically.
 *
 * A token nobody prices cannot be ranked against one that is priced — and it
 * cannot be ranked against another unpriced token either, because a million
 * units of one is not more than ten of the other. So they stop being a ranking
 * and become a list, which is the honest thing for the screen to say about them.
 */
function byWorth(a: Holding, b: Holding): number {
  if (a.value !== undefined && b.value !== undefined) return b.value - a.value;
  if (a.value !== undefined) return -1;
  if (b.value !== undefined) return 1;
  return a.symbol.localeCompare(b.symbol);
}

export function useHoldings() {
  const { address } = useAccount();

  /** What the index believes, which is the list of contracts worth asking. */
  const listed = useQuery({
    queryKey: ["holdings", "listed", address],
    queryFn: () => fetchTokenBalances(address as string),
    enabled: Boolean(address) && SCAN_CONFIGURED,
    staleTime: 30_000,
  });

  const coinPrice = useQuery({
    queryKey: ["holdings", "coinPrice"],
    queryFn: fetchCoinPrice,
    enabled: SCAN_CONFIGURED,
    staleTime: 60_000,
  });

  const native = useBalance({ address, chainId: CHAIN_ID });

  const candidates = useMemo(() => (listed.data ?? []).filter(spendable), [listed.data]);

  const contracts = useMemo(
    () =>
      candidates.map((entry) => ({
        address: entry.token.address_hash as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [address as `0x${string}`] as const,
        chainId: CHAIN_ID,
      })),
    [candidates, address],
  );

  /** The same question, put to the chain rather than to something watching it. */
  const confirmed = useReadContracts({
    contracts,
    allowFailure: true,
    batchSize: ONE_CALL,
    query: { enabled: contracts.length > 0, staleTime: 15_000 },
  });

  const holdings = useMemo(() => {
    const rows = candidates.map((entry, index) => {
      const outcome = confirmed.data?.[index];
      const onChain =
        outcome?.status === "success" && typeof outcome.result === "bigint"
          ? outcome.result
          : undefined;

      const decimals = Number(entry.token.decimals);
      const amount = Number(formatUnits(onChain ?? BigInt(entry.value), decimals));
      const rate = entry.token.exchange_rate ? Number(entry.token.exchange_rate) : undefined;

      return {
        address: entry.token.address_hash as `0x${string}`,
        symbol: entry.token.symbol ?? "—",
        name: entry.token.name ?? "",
        decimals,
        icon: entry.token.icon_url ?? undefined,
        amount,
        rate,
        value: rate === undefined ? undefined : amount * rate,
        confirmed: onChain !== undefined,
      } satisfies Holding;
    });

    /*
     * A row the chain has since emptied is dropped rather than shown at zero:
     * the index is a moment behind the chain, and this is where that shows.
     */
    return rows.filter((row) => row.amount > 0).sort(byWorth);
  }, [candidates, confirmed.data]);

  const nativeValue =
    native.data && coinPrice.data !== undefined
      ? Number(native.data.formatted) * coinPrice.data
      : undefined;

  /*
   * Only what is priced can be totalled. An unpriced token is left out of the
   * figure rather than counted as nothing, which is why the screen says the
   * total is indicative rather than presenting it as the wallet's worth.
   */
  const total = holdings.reduce((sum, row) => sum + (row.value ?? 0), nativeValue ?? 0);

  return {
    address,
    holdings,
    native: native.data,
    nativeValue,
    total: nativeValue === undefined && holdings.every((row) => row.value === undefined)
      ? undefined
      : total,
    /** The index is what the screen cannot draw without; the chain refines it. */
    loading: listed.isPending && Boolean(address) && SCAN_CONFIGURED,
    verifying: confirmed.isFetching,
    error: listed.error,
    refetch: () => {
      void listed.refetch();
      void coinPrice.refetch();
      void native.refetch();
      void confirmed.refetch();
    },
  };
}
