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

  const query = useQuery<FxRate | undefined>({
    queryKey: ["fx", "USD", "IDR"],
    queryFn: fetchFxRate,
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: 1,
  });

  return { fx: query.data, isLoading: query.isLoading && enabled, refetch: query.refetch };
}
