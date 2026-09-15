"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { usePublicClient } from "wagmi";
import { CHAIN_ID, dexMeta } from "@/lib/chains";
import { discoverVenue, envVenue, venueFromLaunch } from "@/lib/venue";
import { useAppStore } from "@/store/useAppStore";

/**
 * The routing venue as the interface should read it. Subscribing to `venueKey`
 * is what makes a component re-render the moment the venue resolves; the venue
 * itself comes from the synchronous mirror every other layer reads.
 */
export function useVenue() {
  const venueKey = useAppStore((state) => state.venueKey);
  const venue = dexMeta(CHAIN_ID);
  return { venue, venueKey, hasRouting: Boolean(venue) };
}

/**
 * Resolves the venue once per session by asking the Pons launchpad which DEX it
 * opens its pools in. Robinhood Chain publishes no deployment list the app can
 * bundle, and the launchpad is the one contract on the chain that already holds
 * the answer — the Uniswap v3 factory, the router and the pair token, stored on
 * chain at launch. A build that pins its own venue skips the lookup entirely.
 */
export function useVenueDiscovery() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const hydrated = useAppStore((state) => state.hydrated);
  const manual = useAppStore((state) => state.venueManual);
  const discovered = useAppStore((state) => state.venueDiscovered);
  const setVenueDiscovered = useAppStore((state) => state.setVenueDiscovered);

  // Nothing to look up when a closer layer already answered.
  const pinned = Boolean(envVenue()) || Boolean(manual?.factory);

  const query = useQuery({
    queryKey: ["venue-discovery", CHAIN_ID],
    enabled: Boolean(client && hydrated && !pinned),
    // A launchpad does not change its DEX often; one look per session is plenty,
    // and a stale answer is corrected on the next load.
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    // A public endpoint that drops one request should not cost the session its
    // routing: without a venue nothing prices, so this is worth a few tries.
    retry: 3,
    retryDelay: (attempt) => Math.min(8_000, 500 * 2 ** attempt),
    queryFn: async () => {
      if (!client) return null;
      return (await discoverVenue(client)) ?? null;
    },
  });

  const found = query.data ?? undefined;

  useEffect(() => {
    if (!found?.factory) return;
    // Re-storing an identical config would loop through `venueKey`.
    if (
      discovered?.factory === found.factory &&
      discovered?.router === found.router &&
      discovered?.wrapped === found.wrapped
    ) {
      return;
    }
    setVenueDiscovered(found);
  }, [found, discovered, setVenueDiscovered]);

  return {
    isResolving: query.isFetching,
    failed: Boolean(query.error) || query.data === null,
    /** Runs the lookup again, for a reader who fixed the reason it failed. */
    retry: () => {
      void query.refetch();
    },
  };
}

/**
 * Resolves the venue from one pasted contract's own launch record, for when the
 * launchpad-wide lookup came back empty. A memecoin minted by Pons names the
 * DEX it was launched into, which is the most direct answer there is to "where
 * does this trade" — and a pasted address is exactly the moment the reader
 * needs routing to exist. Does nothing once a venue is resolved.
 */
export function useVenueFromToken(token: `0x${string}` | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const hydrated = useAppStore((state) => state.hydrated);
  const discovered = useAppStore((state) => state.venueDiscovered);
  const setVenueDiscovered = useAppStore((state) => state.setVenueDiscovered);
  const { hasRouting } = useVenue();

  const query = useQuery({
    queryKey: ["venue-from-token", CHAIN_ID, token?.toLowerCase()],
    enabled: Boolean(client && hydrated && token && !hasRouting),
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      if (!client || !token) return null;
      return (await venueFromLaunch(client, token)) ?? null;
    },
  });

  const found = query.data ?? undefined;

  useEffect(() => {
    if (!found?.router) return;
    // Re-storing an identical config would loop through `venueKey`.
    if (
      discovered?.factory === found.factory &&
      discovered?.router === found.router &&
      discovered?.wrapped === found.wrapped
    ) {
      return;
    }
    setVenueDiscovered(found);
  }, [found, discovered, setVenueDiscovered]);

  return { isResolving: query.isFetching };
}

/** Runs the lookup for the whole app. Rendered once, near the root. */
export function VenueSync() {
  useVenueDiscovery();
  return null;
}
