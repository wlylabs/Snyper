import { BASE, SCAN_PATHS, read } from "@/lib/blockscout";
import { spend, tooMany } from "@/lib/ratelimit";

/**
 * The same-origin way to what the coin is worth.
 *
 * The other half of the arrangement in `/api/balances/[address]`, and needed
 * for the same reason: a balance screen that can list a wallet's tokens but
 * cannot price the coin beside them is still a screen that has failed. Nothing
 * goes in at all — the question is chain-wide, so there is not even an address
 * for a caller to choose.
 */
export const dynamic = "force-dynamic";

/** Chain-wide and cached, so a reader needs this far less often than balances. */
const PER_MINUTE = 30;

function upstream(): string {
  return process.env.BLOCKSCOUT_4663?.trim() || BASE;
}

export async function GET(request: Request) {
  const budget = spend(request, "price", PER_MINUTE);
  if (budget.exceeded) {
    return tooMany(budget.retryAfter, { error: "too many requests" });
  }

  const base = upstream();
  if (!base) return Response.json({ error: "indexer disabled" }, { status: 503 });

  const stats = await read<{ coin_price: string | null }>(
    `${base}${SCAN_PATHS.stats}`,
  ).catch(() => undefined);

  if (!stats) return Response.json({ error: "indexer unreachable" }, { status: 502 });

  /*
   * Only the one figure is passed on. The stats endpoint carries a page's worth
   * of chain totals this app has no use for, and a relay that forwards whatever
   * it happened to receive is a relay whose shape changes when somebody else's
   * does.
   */
  return Response.json(
    { coin_price: stats.coin_price ?? null },
    // Shared by every reader, and a coin price that is a minute old is still a
    // coin price. This is the one read here worth letting a CDN answer.
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
