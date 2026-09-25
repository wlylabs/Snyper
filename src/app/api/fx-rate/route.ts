import { spend, tooMany } from "@/lib/ratelimit";

/**
 * Dollars into Rupiah, for a reader who thinks in the currency rather than
 * the chain's own unit.
 *
 * A free, keyless rate, refreshed daily upstream — a figure this app only
 * displays rather than trades against does not need to be fresher than that,
 * and the hour of caching below is this server's own choice, not a limit the
 * upstream imposes.
 */
export const dynamic = "force-dynamic";

const PER_MINUTE = 30;

export async function GET(request: Request) {
  const budget = spend(request, "fx", PER_MINUTE);
  if (budget.exceeded) {
    return tooMany(budget.retryAfter, { error: "too many requests" });
  }

  const response = await fetch("https://open.er-api.com/v6/latest/USD").catch(() => undefined);
  if (!response || !response.ok) {
    return Response.json({ error: "fx unreachable" }, { status: 502 });
  }

  const data = await response.json().catch(() => undefined);
  const idr = data?.rates?.IDR;
  if (typeof idr !== "number") {
    return Response.json({ error: "no rate" }, { status: 502 });
  }

  return Response.json(
    { idr },
    // Shared by every reader, and a rate that is an hour old is still the rate.
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
