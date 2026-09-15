"use client";

import { useState } from "react";
import type { Token } from "@/lib/tokens";
import { addressArt, tokenArt, type Art } from "@/lib/tokenArt";

function groundStyle(art: Art, size: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    fontSize: Math.max(8, Math.round(size * 0.34)),
    backgroundImage: `linear-gradient(145deg, ${art.from}, ${art.to})`,
    color: art.ink,
  };
}

/**
 * An asset's face. A logo when one is known, and otherwise the deterministic
 * ground from `tokenArt` with the symbol knocked out of it — so a contract
 * pasted in thirty seconds ago still arrives with an identity rather than an
 * empty square. Remote artwork that fails to load falls back to the same
 * ground, which means a dead image URL never leaves a hole in a row.
 */
export function TokenBadge({
  token,
  size = 28,
  className,
}: {
  token: Token;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const art = tokenArt(token);
  const showImage = Boolean(token.logoURI) && !broken;

  return (
    <span
      className={`badge${className ? ` ${className}` : ""}`}
      data-native={token.native ? "true" : undefined}
      style={groundStyle(art, size)}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={token.logoURI}
          alt=""
          className="badge-img"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        /* Three characters need the room a 24px badge does not have. */
        <span aria-hidden="true">{art.initials.slice(0, size >= 24 ? 3 : 2)}</span>
      )}
    </span>
  );
}

/**
 * A pair, drawn as one mark: the base asset in front, what it is priced in
 * tucked behind it. Positions and strategies are always about a pair, so a
 * single badge for the base alone tells half the story.
 */
export function PairBadge({
  base,
  quote,
  size = 28,
}: {
  base: Token;
  quote?: Token;
  size?: number;
}) {
  if (!quote) return <TokenBadge token={base} size={size} />;
  const small = Math.round(size * 0.62);

  return (
    <span
      className="relative flex shrink-0 items-end"
      style={{ width: size + small * 0.45, height: size }}
    >
      <TokenBadge token={base} size={size} />
      <TokenBadge
        token={quote}
        size={small}
        className="badge-stacked absolute right-0 bottom-0"
      />
    </span>
  );
}

/**
 * An account's face, from the same generator as the token badges. Privy paints
 * its own gradient avatar beside a wallet in its modal; this is the app's half
 * of that agreement, so the address a reader sees in the header is the address
 * they just saw in the modal, wearing the same colours.
 */
export function WalletAvatar({
  address,
  size = 28,
  embedded = false,
  className,
}: {
  address: string;
  size?: number;
  embedded?: boolean;
  className?: string;
}) {
  const art = addressArt(address);

  return (
    <span
      className={`badge badge-avatar${className ? ` ${className}` : ""}`}
      data-embedded={embedded ? "true" : undefined}
      style={groundStyle(art, size)}
      aria-hidden="true"
    />
  );
}
