import { createPublicClient, http } from "viem";
import { CHAIN } from "@/lib/chains";
import { buildMarketIndex } from "@/lib/marketIndex";
import { resolveVenue } from "@/lib/venue";

/**
 * The chain's market, built once and served to everyone.
 *
 * Every reader asking this question themselves would mean a factory scan and
 * some forty multicalls per page load, against an endpoint that answers a
 * handful of sequential reads with a rate limit. The answer is also the same
 * for all of them: it is a property of the chain, not of the wallet. So it is
 * built here and cached, and a reader gets one small JSON document.
 *
 * The venue is resolved from the build's environment rather than from the
 * launchpad, because there is no wallet here to read the chain with before the
 * client exists — the bundled deployment is the floor, as it is everywhere else.
 */
export const dynamic = "force-dynamic";

/** How long one index stands. A pool opened inside this window waits for it. */
const TTL_SECONDS = 120;

let cached: { at: number; body: string } | undefined;

export async function GET() {
  const venue = resolveVenue(undefined, undefined);
  if (!venue) {
    return Response.json({ error: "no routing venue" }, { status: 503 });
  }

  const fresh = cached && Date.now() - cached.at < TTL_SECONDS * 1000;
  if (!fresh) {
    const client = createPublicClient({
      chain: CHAIN,
      transport: http(process.env.RPC_4663?.trim() || process.env.NEXT_PUBLIC_RPC_4663?.trim(), {
        batch: true,
      }),
    });

    try {
      const index = await buildMarketIndex(client, venue);
      cached = { at: Date.now(), body: JSON.stringify(index) };
    } catch {
      // A scan that failed must not drop the last good index on the floor: a
      // stale market beats an empty picker, and the reader is told how old it is.
      if (!cached) {
        return Response.json({ error: "index unavailable" }, { status: 502 });
      }
    }
  }

  return new Response(cached!.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=30, s-maxage=${TTL_SECONDS}`,
    },
  });
}
