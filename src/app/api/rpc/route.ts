import { CHAIN } from "@/lib/chains";

/**
 * The same-origin way to the chain.
 *
 * Every read in this app is a `fetch` from the reader's browser to the chain's
 * public endpoint, and that endpoint is the one piece of the app no deployment
 * controls. It sits behind a CDN front door that rate limits, challenges and
 * occasionally resets; a browser cannot see any of that, because a response
 * that arrives without CORS headers — a 429 page, a challenge, a dropped
 * connection — is not an HTTP error it can read, it is a rejected `fetch`
 * reading `Failed to fetch`. So the request that failed cannot even be
 * classified: viem retries it three times in under half a second, gives up,
 * and the reader's screen stops updating with nothing to say about why.
 *
 * This route is the second way to ask. It carries the reader's JSON-RPC body to
 * the same chain from this deployment's server, which is a different client on
 * a different network with a different rate limit budget, and it answers from
 * this origin, where there is no cross-origin policy to fall foul of. The
 * browser tries the chain directly first and comes here only when that failed —
 * the same arrangement the holdings indexer already has in
 * `/api/balances/[address]`, and for the same reason.
 *
 * `RPC_4663` is read ahead of the public variable so a deployment can relay
 * through an endpoint of its own without shipping its URL to every reader.
 */
export const dynamic = "force-dynamic";

/** Where the relayed calls go. Never a caller's choice — only this build's. */
function upstream(): string {
  return (
    process.env.RPC_4663?.trim() ||
    process.env.NEXT_PUBLIC_RPC_4663?.trim() ||
    CHAIN.rpcUrls.default.http[0]
  );
}

/** Long enough for a heavy `eth_getLogs`, short enough to fail before viem does. */
const TIMEOUT = 10_000;

/** A batch of reads is small; anything this size is not one of ours. */
const MAX_BODY = 512 * 1024;

/**
 * Calls per batch. The market scan is the widest caller at around forty
 * multicalls, and the browser transport is capped just above it, so a legitimate
 * batch always fits and a body built to make this server work does not.
 */
const MAX_CALLS = 64;

/**
 * What may be relayed.
 *
 * An allowlist rather than a denylist: this route's upstream is fixed, so the
 * only thing a caller can choose is the method, and an unknown method is far
 * more likely to be someone probing than a call this app makes. Everything the
 * app reads is here, plus `eth_sendRawTransaction` — a relay that cannot
 * broadcast would turn the one failure this exists for into a trade that cannot
 * be sent, and a signed transaction handed to a public endpoint grants nothing
 * that endpoint does not already grant to anyone who can reach it.
 */
const METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
  "web3_clientVersion",
]);

type Call = { method?: unknown; id?: unknown };

/**
 * A JSON-RPC error in the shape a client can read, at a status a client will
 * not retry. 400 rather than 403 or 429 on purpose: viem retries those, and a
 * body this route refuses will be refused again just as fast.
 */
function refuse(message: string, code = -32600) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return refuse("request too large");
  }

  const body = await request.text().catch(() => undefined);
  if (body === undefined) return refuse("unreadable request");
  if (body.length > MAX_BODY) return refuse("request too large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return refuse("not JSON", -32700);
  }

  // A batch and a lone call are both valid JSON-RPC, and viem sends whichever
  // the caller's batching settled on, so both are relayed as they arrived.
  const calls: Call[] = Array.isArray(parsed) ? parsed : [parsed as Call];
  if (calls.length === 0) return refuse("empty request");
  if (calls.length > MAX_CALLS) return refuse("too many calls in one batch");

  for (const call of calls) {
    if (!call || typeof call !== "object") return refuse("malformed call");
    if (typeof call.method !== "string" || !METHODS.has(call.method)) {
      return refuse("method not relayed", -32601);
    }
  }

  let answer: Response;
  try {
    answer = await fetch(upstream(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
  } catch {
    // The relay is the fallback path; there is nothing behind it to try. 502 is
    // a status viem retries, which is the right answer for an endpoint that
    // timed out or reset rather than refused.
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "chain unreachable" } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  /*
   * The upstream status is passed through rather than flattened, because it is
   * what tells the caller whether to try again: viem retries a 429 or a 503 and
   * does not retry a 400. Passing it on from this origin is the whole point —
   * the browser could not read it from the chain directly.
   */
  const text = await answer.text().catch(() => "");
  return new Response(text, {
    status: answer.status,
    headers: {
      "content-type": answer.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
