"use client";

import { addressArt } from "@/lib/avatarArt";

/**
 * An account's face. Privy paints its own gradient avatar beside a wallet in
 * its modal; this is the app's half of that agreement, so the address a reader
 * sees in the header is the address they just saw in the modal, wearing the
 * same colours.
 *
 * It is the only generated mark left in the app: an account is a thing without
 * a name, while an asset always has a ticker to be named by.
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
      className={`avatar${className ? ` ${className}` : ""}`}
      data-embedded={embedded ? "true" : undefined}
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(145deg, ${art.from}, ${art.to})`,
      }}
      aria-hidden="true"
    />
  );
}
