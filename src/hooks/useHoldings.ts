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
  /** Why this row should not be read at face value, when it should not. */
  suspicion?: Suspicion;
};

/**
 * `ticker` — something else in this wallet calls itself the same thing.
 * `lure` — the name is an advertisement, and usually an address to visit.
 */
export type Suspicion = "ticker" | "lure";

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

/**
 * A name that is trying to be a link.
 *
 * Tokens are airdropped into wallets for one reason: the name is a billboard,
 * and the wallet is where it gets read. Measured on this chain they run from
 * "trade on ponsdrop.com" to a contract calling itself ⚠VERIFY whose name is a
 * paragraph about the reader's assets being frozen pending verification at a
 * site it helpfully supplies. A balance screen that prints that as the token's
 * name is carrying the message for them.
 *
 * Only a domain or an instruction counts. An earlier, looser version of this
 * matched the word "rewards" and flagged a memecoin called Trump Rewards My
 * Portfolio, which is many things but not a phishing site.
 */
const LURE =
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|xyz|org|net|top|app|co|finance|live|site|info)\b|claim your|verify at|\bairdrop\b/i;

/**
 * What is wrong with a row, if anything is.
 *
 * Two things are worth saying, and both are computed from the wallet's own
 * list rather than taken on anyone's word.
 *
 * A ticker is not a name. Anyone can deploy a contract calling itself whatever
 * they like, and across two addresses sampled on this chain, thirty tickers
 * were claimed by more than one contract — thirty-five different contracts
 * answer to USDG. A reader looking at a row that says USDG cannot tell which
 * one they are holding, and that is the whole point of deploying it.
 *
 * Price is what breaks the tie. Something had to list a token and trade it for
 * a rate to exist, which no impersonator gets. So a group with exactly one
 * priced member has one asset and a crowd wearing its ticker; a group with none
 * has nothing to separate them, and every row in it is marked.
 *
 * A lure is checked only on tokens nothing has priced. A token with a market is
 * not an airdrop, and the check is loose enough that it should not get to
 * accuse one.
 */
function mark(rows: Holding[]): Holding[] {
  const byTicker = new Map<string, Holding[]>();
  for (const row of rows) {
    const key = row.symbol.trim().toLowerCase();
    const group = byTicker.get(key);
    if (group) group.push(row);
    else byTicker.set(key, [row]);
  }

  return rows.map((row) => {
    if (row.rate === undefined && LURE.test(`${row.symbol} ${row.name}`)) {
      return { ...row, suspicion: "lure" as const };
    }

    const group = byTicker.get(row.symbol.trim().toLowerCase()) ?? [];
    if (group.length < 2) return row;

    const priced = group.filter((member) => member.rate !== undefined);
    if (priced.length === 1 && row.rate !== undefined) return row;
    return { ...row, suspicion: "ticker" as const };
  });
}

export function useHoldings() {
  const { address } = useAccount();

  /** What the index believes, which is the list of contracts worth asking. */
  const listed = useQuery({
    queryKey: ["holdings", "listed", address],
    queryFn: () => fetchTokenBalances(address as string),
    enabled: Boolean(address) && SCAN_CONFIGURED,
    staleTime: 30_000,
    /*
     * There is no refresh button on this screen, so coming back to the tab is
     * the gesture that stands in for one — which is also when a reader is most
     * likely to have just moved something and want to see it.
     */
    refetchOnWindowFocus: true,
  });

  const coinPrice = useQuery({
    queryKey: ["holdings", "coinPrice"],
    queryFn: fetchCoinPrice,
    enabled: SCAN_CONFIGURED,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
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
    query: { enabled: contracts.length > 0, staleTime: 15_000, refetchOnWindowFocus: true },
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
    return mark(rows.filter((row) => row.amount > 0).sort(byWorth));
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
