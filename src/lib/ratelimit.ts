/**
 * A budget per caller, for the routes that spend this deployment's money.
 *
 * Both relays in this app exist so a reader whose browser cannot reach a host
 * can reach it through this server instead. That is also what makes them worth
 * abusing: they are an open, unauthenticated way to spend this deployment's
 * egress and whatever private endpoint `RPC_4663` names, and the method
 * allowlist on the RPC relay stops a caller choosing what to ask for without
 * stopping them asking constantly. `eth_getLogs` is the expensive one, and it
 * is on that list because the app needs it.
 *
 * What this is, precisely: a fixed window counted in memory, per instance.
 * Nothing here is shared between instances, so on a platform that runs several
 * the real ceiling is this number times however many are warm, and a cold start
 * begins at zero. That is a genuine limit on what this can promise and the
 * reason it is written down rather than implied — the durable answer is a rate
 * limit at the CDN or WAF in front of the deployment, and this is the floor
 * underneath it that works with nothing configured.
 *
 * It is sized to be invisible to a reader. The widest screen in the app leaves
 * one batched request per refresh, so a person reading the market at a few
 * requests a second is still an order of magnitude under the ceiling, and
 * anything above it is not somebody reading.
 */

/** How long a window lasts before a caller's count starts again. */
const WINDOW_MS = 60_000;

/**
 * Above this many tracked callers, expired windows are swept before a new one
 * is opened. A map that only ever grows is a slow leak on a long-lived
 * instance, and sweeping on write costs nothing at the sizes this sees.
 */
const SWEEP_ABOVE = 5_000;

type Window = { count: number; reset: number };

const seen = new Map<string, Window>();

/**
 * Who is asking, as well as this can be known behind a proxy.
 *
 * `x-forwarded-for` is a list the nearest proxy appends to, so the first entry
 * is the client as the edge saw it. It is also a header a client can send, and
 * nothing here can tell a forged one from a real one — which is why this
 * returns a key for counting and never anything that decides access. A caller
 * who rotates it is buying themselves a larger share of a relay, not a way past
 * the allowlist that decides what the relay will do.
 */
function caller(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Each relay counts its own callers.
 *
 * One budget shared across the routes would make the tighter number on the
 * indexer relays meaningless — the chain relay's allowance is larger and spends
 * first, so a reader whose browser has been failing over to `/api/rpc` all
 * session would arrive at the balance screen already refused. That is not a
 * limit doing its job; it is two unrelated failures wired together.
 *
 * So the bucket is part of the key, and a caller's standing on one relay says
 * nothing about their standing on another.
 */
export type Bucket = "rpc" | "balances" | "price" | "fx";

export type Verdict = {
  /** True when this caller has already spent the window's budget. */
  exceeded: boolean;
  /** Whole seconds until the window resets, for `Retry-After`. */
  retryAfter: number;
};

/** Count one request against this caller's window on this relay. */
export function spend(request: Request, bucket: Bucket, limit: number): Verdict {
  const now = Date.now();
  const key = `${bucket}:${caller(request)}`;
  const open = seen.get(key);

  if (!open || open.reset <= now) {
    if (seen.size > SWEEP_ABOVE) {
      for (const [entry, window] of seen) if (window.reset <= now) seen.delete(entry);
    }
    seen.set(key, { count: 1, reset: now + WINDOW_MS });
    return { exceeded: false, retryAfter: 0 };
  }

  open.count++;
  return {
    exceeded: open.count > limit,
    retryAfter: Math.max(1, Math.ceil((open.reset - now) / 1000)),
  };
}

/** The answer a caller over its budget gets, in whatever shape the route speaks. */
export function tooMany(retryAfter: number, body: unknown): Response {
  return Response.json(body, {
    status: 429,
    headers: { "retry-after": String(retryAfter), "cache-control": "no-store" },
  });
}
