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

  return useQuery<Quote | undefined>({
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
    queryFn: async () => {
      if (!client || !tokenIn || !tokenOut || !amountIn) return undefined;
      return quoteExactIn(client, tokenIn, tokenOut, amountIn);
    },
  });
}
