"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectPromptContext } from "@/hooks/useConnectPrompt";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, privyConfig } from "@/lib/privy";
import { config } from "@/lib/wagmi";
import { useAppStore } from "@/store/useAppStore";
import { ActiveWalletSync } from "./ActiveWalletSync";

/**
 * The whole wallet session, in one module, so that it can arrive in one chunk.
 *
 * Everything that reads `@privy-io/react-auth` is gathered here and nothing
 * outside this file imports it. That is the entire point of the file: the SDK
 * carries WalletConnect, the Coinbase SDK, Solana and a funding provider, none
 * of which this app asks for and all of which it pays for, and a static import
 * anywhere in the shell puts every byte of it in front of the first paint. Held
 * behind one dynamic import instead, the shell hydrates without it and the
 * session lands a moment later, on its own.
 *
 * `providers` is what loads this, and holds a bare wagmi provider in its place
 * until it does — the chain is readable the whole time; only the session is
 * late.
 */

/**
 * Whether the reader is pointing at this with a finger, which is what decides
 * how the wallet list ends — see `pairingEntry` in `lib/privy`.
 *
 * Read after mount rather than during render, because there is no pointer on
 * the server and a guess would hand Privy one wallet list and then swap it for
 * another a frame later. The desktop answer is the safe one to start from: the
 * QR it chooses pairs any phone wallet, where a list of deep links on a machine
 * that has no wallet apps installed pairs none of them.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    setCoarse(query.matches);
    // A tablet with a keyboard folded on and off changes this mid-session.
    const follow = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  return coarse;
}

/** Publishes Privy's login modal to anything below that needs an address. */
function ConnectPromptProvider({ children }: { children: ReactNode }) {
  const { login } = usePrivy();
  const prompt = useMemo(() => () => login(), [login]);

  return (
    <ConnectPromptContext.Provider value={prompt}>{children}</ConnectPromptContext.Provider>
  );
}

/**
 * Privy owns the wallet session, so its provider wraps wagmi rather than the
 * other way round.
 */
export function WalletSession({ children }: { children: ReactNode }) {
  const theme = useAppStore((state) => state.settings.theme);
  const locale = useAppStore((state) => state.settings.locale);
  const touch = useCoarsePointer();

  /*
   * Theme, language and pointer are read here rather than inside the modal, so
   * a reader who changes any of them finds Privy already changed with them.
   *
   * Held across renders because the config carries the brand lockup as a live
   * element: rebuilding it on every store write — a theme toggle, a locale, a
   * hydration — would hand Privy a new logo and a new appearance object each
   * time and have it re-render the modal's chrome for nothing.
   */
  const appearance = useMemo(() => privyConfig(theme, locale, touch), [theme, locale, touch]);

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      {...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {})}
      config={appearance}
    >
      <WagmiProvider config={config}>
        <ActiveWalletSync />
        <ConnectPromptProvider>{children}</ConnectPromptProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}
