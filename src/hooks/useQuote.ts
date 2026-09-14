"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { quoteExactIn, type Quote } from "@/lib/quote";
import type { Token } from "@/lib/tokens";

export function useQuote({
  tokenIn,
  tokenOut,
  amountIn,
  enabled = true,
  refetchInterval,
}: {
  tokenIn?: Token;
  tokenOut?: Token;
  amountIn?: bigint;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const client = usePublicClient({ chainId: tokenIn?.chainId });

  return useQuery<Quote | null>({
    queryKey: [
      "quote",
      tokenIn?.chainId,
      tokenIn?.address,
      tokenOut?.address,
      amountIn?.toString(),
    ],
    enabled: Boolean(enabled && client && tokenIn && tokenOut && amountIn && amountIn > 0n),
    refetchInterval,
    staleTime: 8_000,
    // Null stands for "no route": react-query treats an undefined payload as a
    // programming error and reports it as a query failure.
    queryFn: async () => {
      if (!client || !tokenIn || !tokenOut || !amountIn) return null;
      return (await quoteExactIn(client, tokenIn, tokenOut, amountIn)) ?? null;
    },
  });
}
