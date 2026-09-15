import type { PublicClient } from "viem";

/**
 * Asking a token what it looks like.
 *
 * Robinhood Chain has no curated token list and the Pons launchpad's records
 * carry no artwork, so the only party that can name a token's real logo is the
 * token. There is no single standard for that: ERC-1046 adds `tokenURI()`
 * pointing at a JSON document, while plenty of launchpad tokens simply expose
 * the image URL as a public string. None of them are required, so every one is
 * asked at once and whatever answers first wins.
 *
 * A contract is an untrusted party, which shapes the rest of this file: only
 * https and image data URIs are accepted, sizes are capped before anything is
 * held onto, and a document that has to be fetched is fetched with a deadline.
 * Anything that fails any of that is treated as "this token has no logo", which
 * is the same outcome as not asking — the generated ground takes over.
 */

/**
 * The getters worth asking for, split by what their answer means. A `logo()` is
 * the picture, whatever it looks like — most of the artwork on this chain is
 * served from paths with no file extension at all, so the getter's name is the
 * only reliable signal of which kind of answer came back. `tokenURI()` and
 * `uri()` answer with a document instead, which costs a round trip to read.
 */
const IMAGE_FNS = ["logoURI", "logo", "image", "icon"] as const;
const DOCUMENT_FNS = ["tokenURI", "uri"] as const;
const METADATA_FNS = [...IMAGE_FNS, ...DOCUMENT_FNS] as const;

const tokenMetadataAbi = [
  { type: "function", name: "logoURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "image", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "icon", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "uri", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** Where `ipfs://` is dereferenced. Overridable so a deployment can pin its own. */
const IPFS_GATEWAY = `${(
  process.env.NEXT_PUBLIC_IPFS_GATEWAY?.trim() || "https://ipfs.io/ipfs"
).replace(/\/+$/, "")}/`;

/** A URL a contract hands back has no business being longer than this. */
const MAX_URL = 2048;
/** An inline SVG can legitimately be large; a megabyte of it cannot. */
const MAX_DATA = 96 * 1024;
/** Metadata documents are small objects, so anything past this is not one. */
const MAX_DOC = 32 * 1024;
const DOC_TIMEOUT = 6000;

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i;
/** CIDv0 and CIDv1, with an optional path after them. */
const BARE_CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/.*)?$/;

/**
 * Turns whatever a contract said into something an `<img>` may be pointed at,
 * or nothing. Plain `http:` is refused along with every other scheme: the app
 * is served over TLS, so an insecure image would be blocked by the browser
 * anyway, and refusing it here keeps the reason visible.
 */
export function resolveUri(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (value.startsWith("data:")) {
    if (value.length > MAX_DATA) return undefined;
    return DATA_IMAGE.test(value) || value.startsWith("data:application/json") ? value : undefined;
  }

  if (value.length > MAX_URL) return undefined;

  /*
   * Tokens in the wild paste an absolute URL in behind a scheme they were told
   * to use — `ipfs://https://pbs.twimg.com/…` is a real answer from a real
   * contract. Dereferencing that against a gateway produces a dead link, so the
   * URL inside is taken at its word instead.
   */
  const nested = value.match(/^(?:ipfs|ar):\/\/(https?:\/\/.+)$/i);
  if (nested) return resolveUri(nested[1]);

  if (value.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}${value.slice(7).replace(/^ipfs\//, "")}`;
  }
  if (value.startsWith("ar://")) return `https://arweave.net/${value.slice(5)}`;
  if (value.startsWith("https://")) return value;
  if (BARE_CID.test(value)) return `${IPFS_GATEWAY}${value}`;
  return undefined;
}

/** Whether a resolved URI is the picture itself rather than a document about it. */
function isImage(url: string): boolean {
  return url.startsWith("data:image/") || IMAGE_EXT.test(url);
}

/** The keys a metadata document might file its artwork under, in order. */
function imageField(doc: unknown): string | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const record = doc as Record<string, unknown>;
  for (const key of ["image", "image_url", "imageUrl", "logo", "logoURI", "icon"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** Reads a metadata document and returns the artwork it points at, if any. */
async function imageFromDocument(url: string): Promise<string | undefined> {
  try {
    if (url.startsWith("data:application/json")) {
      const comma = url.indexOf(",");
      if (comma < 0) return undefined;
      const payload = url.slice(comma + 1);
      const body = url.slice(0, comma).includes(";base64")
        ? atob(payload)
        : decodeURIComponent(payload);
      return resolveUri(imageField(JSON.parse(body)));
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOC_TIMEOUT),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_DOC) return undefined;
    const text = await response.text();
    if (text.length > MAX_DOC) return undefined;

    return resolveUri(imageField(JSON.parse(text)));
  } catch {
    // A gateway that is down, a CORS refusal, a document that is not JSON:
    // every one of them means the same thing here, which is no logo.
    return undefined;
  }
}

/**
 * Asks a batch of tokens for their artwork in one round trip.
 *
 * Every address is keyed in the result whether or not it answered, because a
 * token that has nothing to say is worth remembering too — otherwise the same
 * dead lookup runs again on every visit. An empty string is that memory.
 */
export async function readTokenLogos(
  client: PublicClient,
  addresses: readonly `0x${string}`[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (addresses.length === 0) return found;

  const results = await client.multicall({
    allowFailure: true,
    contracts: addresses.flatMap((address) =>
      METADATA_FNS.map((functionName) => ({
        address,
        abi: tokenMetadataAbi,
        functionName,
      })),
    ),
  });

  /* Documents are resolved after the multicall so the fetches run together. */
  const documents: { key: string; url: string }[] = [];

  addresses.forEach((address, index) => {
    const key = address.toLowerCase();
    found.set(key, "");
    const answers = results.slice(index * METADATA_FNS.length, (index + 1) * METADATA_FNS.length);

    for (const [slot, answer] of answers.entries()) {
      if (answer.status !== "success" || typeof answer.result !== "string") continue;
      const url = resolveUri(answer.result);
      if (!url) continue;

      /*
       * An image getter is believed about what it returned; a document getter
       * is only believed when the answer is visibly a picture. A getter of
       * either kind that hands back a JSON payload is read as a document.
       */
      const isDocument =
        url.startsWith("data:application/json") ||
        (slot >= IMAGE_FNS.length && !isImage(url));

      if (!isDocument) {
        found.set(key, url);
        return;
      }
      // Keep the first document as a fallback, but keep looking for a picture.
      if (!documents.some((entry) => entry.key === key)) documents.push({ key, url });
    }
  });

  const pending = documents.filter((entry) => !found.get(entry.key));
  const images = await Promise.all(pending.map((entry) => imageFromDocument(entry.url)));
  pending.forEach((entry, index) => {
    const image = images[index];
    if (image) found.set(entry.key, image);
  });

  return found;
}

/** One token's artwork, for the import path where only one has just arrived. */
export async function readTokenLogo(
  client: PublicClient,
  address: `0x${string}`,
): Promise<string | undefined> {
  const logos = await readTokenLogos(client, [address]);
  return logos.get(address.toLowerCase()) || undefined;
}
