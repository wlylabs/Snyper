"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { discoverWalletTokens, type DiscoveredToken } from "@/lib/discovery";
import { useAppStore } from "@/store/useAppStore";

type State = {
  isScanning: boolean;
  found?: DiscoveredToken[];
  scannedBlocks?: number;
  partial?: boolean;
  error?: string;
};

/**
 * Scans the connected wallet's transfer history for ERC-20s the curated list
 * does not carry — which is how memecoins end up in the picker at all. Results
 * are kept in the local store so a scan only has to run once per chain.
 */
export function useTokenDiscovery(chainId: number | undefined) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId });
  const addDiscoveredTokens = useAppStore((state) => state.addDiscoveredTokens);
  const [state, setState] = useState<State>({ isScanning: false });

  // A chain or account switch invalidates the previous run's summary.
  useEffect(() => {
    setState({ isScanning: false });
  }, [chainId, address]);

  const scan = useCallback(async () => {
    if (!client || !address || !chainId) return;
    setState({ isScanning: true });
    try {
      const result = await discoverWalletTokens(client, chainId, address);
      addDiscoveredTokens(
        result.tokens.map((token) => ({
          chainId: token.chainId,
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
        })),
      );
      setState({
        isScanning: false,
        found: result.tokens,
        scannedBlocks: result.scannedBlocks,
        partial: result.partial,
      });
    } catch (error) {
      setState({
        isScanning: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [addDiscoveredTokens, address, chainId, client]);

  return { ...state, scan, canScan: Boolean(client && address && chainId) };
}
