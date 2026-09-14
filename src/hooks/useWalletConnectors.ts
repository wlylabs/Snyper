"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnectors } from "wagmi";
import type { Connector } from "wagmi";

export type ConnectorGroups = {
  /** EIP-6963 announced wallets, plus the generic shim when it has a provider. */
  injected: Connector[];
  walletConnect?: Connector;
  coinbase?: Connector;
  /** True once availability has actually been probed in the browser. */
  probed: boolean;
};

/**
 * wagmi always lists the generic `injected` connector, whether or not the page
 * has an EIP-1193 provider. Offering it regardless is what produces the
 * "Provider not found" failure on click, so every injected candidate is probed
 * with `getProvider()` first and only reachable wallets are rendered.
 */
export function useWalletConnectors(): ConnectorGroups {
  const connectors = useConnectors();
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [probed, setProbed] = useState(false);

  const candidates = useMemo(
    () => connectors.filter((connector) => connector.type === "injected"),
    [connectors],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      candidates.map(async (connector) => {
        try {
          const provider = await connector.getProvider();
          return [connector.uid, Boolean(provider)] as const;
        } catch {
          return [connector.uid, false] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setReady(Object.fromEntries(entries));
      setProbed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  return useMemo(() => {
    const available = candidates.filter((connector) => ready[connector.uid]);
    // EIP-6963 wallets announce themselves by name; the shim is the last resort.
    const announced = available.filter((connector) => connector.id !== "injected");
    return {
      injected: announced.length > 0 ? announced : available,
      walletConnect: connectors.find((connector) => connector.id === "walletConnect"),
      coinbase: connectors.find((connector) => connector.id === "coinbaseWalletSDK"),
      probed,
    };
  }, [candidates, connectors, ready, probed]);
}
