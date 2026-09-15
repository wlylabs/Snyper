"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * One way in, from anywhere.
 *
 * Connecting is not something that only happens in the header. A reader who has
 * priced a swap and reached for the execute button is already at the connect
 * moment, and sending them back up to the corner to start it again is a seam
 * where there should be none. This carries Privy's login modal down to whatever
 * control needs it.
 *
 * It is a context rather than a hook over `usePrivy` because `usePrivy` throws
 * outside a `PrivyProvider`, and a build with no app id has no provider to be
 * inside. Panels ask for the prompt; if the build cannot offer one they get
 * `undefined` and keep whatever they already said.
 */
const ConnectPromptContext = createContext<(() => void) | undefined>(undefined);

/** Mounted inside `PrivyProvider`; there is nothing to publish outside one. */
export function ConnectPromptProvider({ children }: { children: ReactNode }) {
  const { login } = usePrivy();
  const prompt = useMemo(() => () => login(), [login]);
  return (
    <ConnectPromptContext.Provider value={prompt}>{children}</ConnectPromptContext.Provider>
  );
}

/** Opens Privy's login modal, or `undefined` when this build has no Privy. */
export function useConnectPrompt(): (() => void) | undefined {
  return useContext(ConnectPromptContext);
}
