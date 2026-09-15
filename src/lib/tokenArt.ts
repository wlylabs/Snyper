/**
 * Artwork for things that have no artwork.
 *
 * Robinhood Chain publishes no curated token list, so almost nothing the app
 * shows carries a logo: a memecoin pasted in as a contract address has a
 * symbol, a name and eighteen decimals, and that is all. Rather than leave a
 * hole where every asset's face should be, each one is given a deterministic
 * ground derived from its address — the same address always paints the same
 * badge, on every device, with no feed to fetch and nothing to cache.
 *
 * Wallets are drawn from the same generator, so an account avatar and a token
 * badge read as one family rather than two unrelated decorations.
 */

export type Art = {
  /** First stop of the badge ground. */
  from: string;
  /** Second stop, always darker, so the ground has a direction. */
  to: string;
  /** Type colour that clears both stops. */
  ink: string;
  /** Up to three characters, drawn when there is no image to draw instead. */
  initials: string;
};

/** FNV-1a. Small, stable across runtimes, and good enough to spread hues. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Lightness is fixed and chroma is capped, so two badges differ by hue alone.
 * That is what keeps a column of them reading as one set instead of confetti —
 * and it holds the ink above 4:1 against both stops without testing each hue.
 */
function ground(seed: string): Art {
  const h = hash(seed);
  const hue = h % 360;
  const drift = 22 + ((h >>> 9) % 44);
  return {
    from: `oklch(0.56 0.15 ${hue})`,
    to: `oklch(0.42 0.16 ${(hue + drift) % 360})`,
    ink: `oklch(0.98 0.02 ${hue})`,
    initials: "",
  };
}

/** Letters drawn when a token has no logo: its symbol, stripped to glyphs. */
function initials(symbol: string): string {
  const clean = symbol.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  return clean.slice(0, 3) || "?";
}

/**
 * The chain's own money wears the brand rather than a hashed hue: it is the one
 * asset on the network that is not somebody's contract. Both stops are tokens,
 * so the native badge follows the theme the way the rest of the shell does.
 */
const NATIVE_ART: Omit<Art, "initials"> = {
  from: "var(--color-accent)",
  to: "color-mix(in srgb, var(--color-accent) 72%, var(--color-accent-ink))",
  ink: "var(--color-accent-ink)",
};

export function tokenArt(token: {
  chainId: number;
  address: string;
  symbol: string;
  native?: boolean;
}): Art {
  const mark = initials(token.symbol);
  if (token.native) return { ...NATIVE_ART, initials: mark };
  return { ...ground(`${token.chainId}:${token.address.toLowerCase()}`), initials: mark };
}

/** An account's face. Seeded by address alone: the same wallet, every chain. */
export function addressArt(address: string): Art {
  return { ...ground(address.toLowerCase()), initials: "" };
}
