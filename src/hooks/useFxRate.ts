"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchFxRate, type FxRate } from "@/lib/currency";
import { useAppStore } from "@/store/useAppStore";

/**
 * Live USD/IDR rate. Only fetched when the interface is actually showing
 * rupiah, and never substituted with a placeholder when the feed is down.
 */
export function useFxRate(force = false) {
  const currency = useAppStore((state) => state.settings.currency);
  const enabled = force || currency === "IDR";

  const query = useQuery<FxRate | null>({
    queryKey: ["fx", "USD", "IDR"],
    // A feed that did not answer is a result, not a failure: react-query rejects
    // an `undefined` payload and would report its own error over the quiet one.
    queryFn: async () => (await fetchFxRate()) ?? null,
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: 1,
  });

  return {
    fx: query.data ?? undefined,
    isLoading: query.isLoading && enabled,
    refetch: query.refetch,
  };
}
