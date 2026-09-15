import { getAddress, isAddress } from "viem";
import { indexerBase, readIndexedPayload } from "@/lib/portfolioFeed";

/**
 * The same-origin way to the holdings indexer.
 *
 * The browser asks Blockscout itself first; this exists for the readers that
 * cannot — an instance that does not allow this origin, a network that blocks
 * it. Only an address goes in, and only this deployment decides which indexer
 * it goes to, so there is nothing here a caller can point somewhere else.
 *
 * `BLOCKSCOUT_4663` is read ahead of the public variable so a deployment can
 * relay through an indexer of its own without shipping its URL to every reader.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!isAddress(address)) {
    return Response.json({ error: "not an address" }, { status: 400 });
  }

  const base = process.env.BLOCKSCOUT_4663?.trim() || indexerBase();
  if (!base) return Response.json({ error: "indexer disabled" }, { status: 503 });

  const payload = await readIndexedPayload(getAddress(address), base).catch(
    () => undefined,
  );
  if (!payload) return Response.json({ error: "indexer unreachable" }, { status: 502 });

  return Response.json(payload, {
    // Long enough to absorb a reader refreshing the page, short enough that a
    // swap they just signed shows up on the next read.
    headers: { "cache-control": "public, max-age=10" },
  });
}
