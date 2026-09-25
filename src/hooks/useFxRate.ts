"use client";

import { useQuery } from "@tanstack/react-query";

async function read(): Promise<number | undefined> {
  const response = await fetch("/api/fx-rate");
  if (!response.ok) return undefined;
  const data = await response.json().catch(() => undefined);
  return typeof data?.idr === "number" ? data.idr : undefined;
}

/**
 * How many Rupiah one dollar is worth, an hour stale at most — see
 * `/api/fx-rate`. Asked for only when `enabled`, so a reader who has never
 * touched the currency setting never spends the request.
 */
export function useFxRate(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ["fx-rate"],
    queryFn: read,
    enabled,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return query.data;
}
