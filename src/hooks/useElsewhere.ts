"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  elsewhereEnabled,
  readElsewhere,
  type ElsewhereBalance,
} from "@/lib/elsewhere";

/**
 * The same coin on the networks this app does not trade, so the assets page can
 * reconcile against the figure the reader's wallet is showing.
 *
 * Slower than the chain-4663 read on purpose: these balances only move when the
 * reader moves them somewhere else entirely, and one of them is Ethereum, whose
 * blocks are twelve seconds apart anyway.
 */
export function useElsewhere() {
  const { address } = useAccount();

  return useQuery<ElsewhereBalance[]>({
    queryKey: ["elsewhere", address],
    enabled: Boolean(address) && elsewhereEnabled(),
    queryFn: () => readElsewhere(address!),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
