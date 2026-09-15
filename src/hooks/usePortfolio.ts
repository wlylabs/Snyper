"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/abi";
import { dexMeta } from "@/lib/chains";
import { midPrice } from "@/lib/quote";
import type { Token } from "@/lib/tokens";

export type Holding = {
  token: Token;
  balance: bigint;
  amount: number;
  /** USD value via the chain's stable pool, undefined when no route exists. */
  value?: number;
  price?: number;
};

const MAX_PRICED = 24;

/**
 * Whole units of a balance. Scaling the raw integer by a power of ten would
 * round it through a float twice — once past 2^53, once on a decimals count
 * that has no exact float — and a wallet comparing this against its own display
 * would find the last digits disagree. `formatUnits` does the scaling in
 * integer arithmetic and only then meets a float.
 */
function amountOf(balance: bigint, decimals: number): number {
  return Number(formatUnits(balance, decimals));
}

/**
 * Reads balances straight from the chain with one multicall, then prices the
 * non-zero rows against the chain's USD pool. No indexer, no cached snapshot.
 */
export function usePortfolio(chainId: number | undefined, tokens: Token[]) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId });

  return useQuery<Holding[]>({
    queryKey: [
      "portfolio",
      chainId,
      address,
      tokens.map((token) => token.address).join(","),
    ],
    enabled: Boolean(client && address && chainId && tokens.length > 0),
    refetchInterval: 45_000,
    staleTime: 20_000,
    queryFn: async () => {
      if (!client || !address || !chainId) return [];
      const dex = dexMeta(chainId);

      const erc20Tokens = tokens.filter((token) => !token.native);
      const nativeTokens = tokens.filter((token) => token.native);

      const [nativeBalance, results] = await Promise.all([
        nativeTokens.length > 0 ? client.getBalance({ address }) : Promise.resolve(0n),
        erc20Tokens.length > 0
          ? client.multicall({
              allowFailure: true,
              contracts: erc20Tokens.map((token) => ({
                address: token.address,
                abi: erc20Abi,
                functionName: "balanceOf" as const,
                args: [address] as const,
              })),
            })
          : Promise.resolve([]),
      ]);

      const holdings: Holding[] = [];

      for (const token of nativeTokens) {
        if (nativeBalance > 0n) {
          holdings.push({
            token,
            balance: nativeBalance,
            amount: amountOf(nativeBalance, token.decimals),
          });
        }
      }

      erc20Tokens.forEach((token, index) => {
        const entry = results[index];
        if (!entry || entry.status !== "success") return;
        const balance = entry.result as bigint;
        if (balance <= 0n) return;
        holdings.push({
          token,
          balance,
          amount: amountOf(balance, token.decimals),
        });
      });

      // Pricing needs a USD unit to price against. Without a venue, or without a
      // stable on it, balances stand alone rather than being valued in a unit
      // nobody chose.
      if (!dex?.stable) return holdings;

      const stableAddress = dex.stable.toLowerCase();
      const priced = await Promise.all(
        holdings.slice(0, MAX_PRICED).map(async (holding) => {
          if (holding.token.address.toLowerCase() === stableAddress) {
            return { ...holding, price: 1, value: holding.amount };
          }
          const stable = tokens.find(
            (token) => token.address.toLowerCase() === stableAddress,
          );
          if (!stable) return holding;
          try {
            const mid = await midPrice(client, holding.token, stable);
            if (!mid) return holding;
            return { ...holding, price: mid.price, value: holding.amount * mid.price };
          } catch {
            return holding;
          }
        }),
      );

      const rest = holdings.slice(MAX_PRICED);
      return [...priced, ...rest].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    },
  });
}
