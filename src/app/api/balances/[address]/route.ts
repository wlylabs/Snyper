import { getAddress, isAddress } from "viem";
import { BASE, SCAN_PATHS, read, type ScanBalance } from "@/lib/blockscout";
import { spend, tooMany } from "@/lib/ratelimit";

/**
 * The same-origin way to the holdings indexer.
 *
 * The browser asks Blockscout itself first; this exists for the readers that
 * cannot — a Cloudflare challenge they fail, a network that blocks the host, an
 * extension that blocks it for them. Only an address goes in, and only this
 * deployment decides which indexer it goes to, so there is nothing here a
 * caller can point somewhere else.
 *
 * `BLOCKSCOUT_4663` is read ahead of the chain's own explorer so a deployment
 * can relay through an indexer of its own without shipping its URL to every
 * reader.
 */
export const dynamic = "force-dynamic";

/**
 * Requests a single caller may relay in a minute.
 *
 * Lower than the chain relay's, because this is one request per reader per
 * refresh rather than a batch of reads — nobody legitimately asks what a wallet
 * holds sixty times a minute, and the upstream is somebody else's index.
 */
const PER_MINUTE = 60;

/** Where the relayed reads go. Never a caller's choice — only this build's. */
function upstream(): string {
  return process.env.BLOCKSCOUT_4663?.trim() || BASE;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const budget = spend(request, "balances", PER_MINUTE);
  if (budget.exceeded) {
    return tooMany(budget.retryAfter, { error: "too many requests" });
  }

  const { address } = await params;
  if (!isAddress(address)) {
    return Response.json({ error: "not an address" }, { status: 400 });
  }

  const base = upstream();
  if (!base) return Response.json({ error: "indexer disabled" }, { status: 503 });

  /*
   * Checksummed on the way out. The index accepts either spelling, and pinning
   * one means a reader's own address and the same address lowercased do not
   * become two entries in whatever cache sits in front of this.
   */
  const balances = await read<ScanBalance[]>(
    `${base}${SCAN_PATHS.balances(getAddress(address))}`,
  ).catch(() => undefined);

  if (!balances) return Response.json({ error: "indexer unreachable" }, { status: 502 });

  return Response.json(balances, {
    // Long enough to absorb a reader refreshing the page, short enough that a
    // swap they just signed shows up on the next read.
    headers: { "cache-control": "public, max-age=10" },
  });
}
