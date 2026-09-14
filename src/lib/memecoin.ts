import type { TKey } from "./i18n";
import type { Token } from "./tokens";

/**
 * Meme tokens are a social category, not an on-chain one, so nothing here is
 * authoritative. These are the signals that can be read without an indexer:
 * the token is absent from the curated list, its naming follows the genre, and
 * its supply is shaped like a meme launch. The interface presents the result as
 * a hint next to the contract address, never as a verdict.
 */
export type MemeSignal = {
  /** Present in the wallet but absent from the curated token list. */
  unlisted: boolean;
  /** Enough naming and supply signals to flag it as a likely meme token. */
  meme: boolean;
  score: number;
  reasons: TKey[];
};

/** Genre vocabulary. Matched as whole words or as a symbol fragment. */
const LEXICON = [
  "doge",
  "shib",
  "inu",
  "pepe",
  "wojak",
  "chad",
  "moon",
  "rocket",
  "elon",
  "floki",
  "bonk",
  "wif",
  "meme",
  "cat",
  "kitty",
  "frog",
  "baby",
  "safe",
  "cum",
  "chungus",
  "based",
  "giga",
  "turbo",
  "ape",
  "banana",
  "degen",
  "pump",
  "lambda",
  "trump",
  "harambe",
  "mog",
  "brett",
  "andy",
  "popcat",
  "sigma",
  "gm",
];

/** Anything outside plain ASCII in a ticker is a strong genre signal. */
const NON_ASCII = /[^\x20-\x7E]/;
const HYPE = /(\b|_)(1000x|100x|10x|x1000|v2|v3|2\.0)(\b|_)/i;

function lexiconHit(value: string): boolean {
  const lower = value.toLowerCase();
  return LEXICON.some((word) => lower.includes(word));
}

/**
 * Scores a token against the meme heuristics. `listedAddresses` is the set of
 * lowercased addresses the curated list carries for this chain.
 */
export function memeSignal(
  token: Token & { totalSupply?: bigint },
  listedAddresses: Set<string>,
): MemeSignal {
  const unlisted = !listedAddresses.has(token.address.toLowerCase());
  const reasons: TKey[] = [];
  let score = 0;

  if (unlisted) {
    score += 1;
    reasons.push("meme.reasonUnlisted");
  }

  if (lexiconHit(token.symbol) || lexiconHit(token.name)) {
    score += 2;
    reasons.push("meme.reasonName");
  }

  if (NON_ASCII.test(token.symbol) || NON_ASCII.test(token.name)) {
    score += 1;
    reasons.push("meme.reasonGlyphs");
  }

  if (HYPE.test(token.symbol) || HYPE.test(token.name)) {
    score += 1;
    reasons.push("meme.reasonHype");
  }

  // A trillion or more whole units is the classic meme launch supply.
  if (token.totalSupply !== undefined && token.decimals <= 24) {
    const whole = token.totalSupply / 10n ** BigInt(token.decimals);
    if (whole >= 1_000_000_000_000n) {
      score += 2;
      reasons.push("meme.reasonSupply");
    }
  }

  // Naming or supply alone is noise; the flag needs the token to be uncurated.
  return { unlisted, meme: unlisted && score >= 3, score, reasons };
}

export function listedAddressSet(tokens: Token[]): Set<string> {
  return new Set(tokens.map((token) => token.address.toLowerCase()));
}
