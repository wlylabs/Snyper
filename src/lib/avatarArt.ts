/**
 * Artwork for accounts.
 *
 * An address has no name and no picture, so it is given a deterministic ground
 * derived from itself — the same address always paints the same avatar, on
 * every device, with no feed to fetch and nothing to cache. Privy paints its
 * own gradient beside a wallet in its modal; this is the app's half of that
 * agreement.
 *
 * Tokens are not drawn this way. On a chain with no curated list almost nothing
 * carries a logo, so a generated one would be decoration repeating the symbol
 * printed next to it — and colour in this app belongs to the accent. An asset
 * is named by its ticker instead.
 */

export type Art = {
  /** First stop of the avatar ground. */
  from: string;
  /** Second stop, always darker, so the ground has a direction. */
  to: string;
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
 * Lightness is fixed and chroma is capped, so two avatars differ by hue alone.
 * That is what keeps a list of wallets reading as one set instead of confetti.
 */
function ground(seed: string): Art {
  const h = hash(seed);
  const hue = h % 360;
  const drift = 22 + ((h >>> 9) % 44);
  return {
    from: `oklch(0.56 0.15 ${hue})`,
    to: `oklch(0.42 0.16 ${(hue + drift) % 360})`,
  };
}

/** An account's face. Seeded by address alone: the same wallet, every chain. */
export function addressArt(address: string): Art {
  return ground(address.toLowerCase());
}
