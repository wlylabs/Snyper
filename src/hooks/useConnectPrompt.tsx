"use client";

import { createContext, useContext } from "react";

/**
 * One way in, from anywhere.
 *
 * Connecting is not something that only happens in the header. A reader who has
 * reached a control that needs an address is already at the connect moment, and
 * sending them back up to the corner to start it again is a seam where there
 * should be none. This carries Privy's login modal down to whatever control
 * needs it.
 *
 * The provider is not in this file. It needs `usePrivy`, and this file is read
 * by the header, which is on the critical path of every page — a Privy import
 * here would pull the whole SDK back into the first bundle the browser has to
 * parse. It lives in `components/wallet/WalletSession` instead, which is the
 * chunk the SDK arrives on.
 */
export const ConnectPromptContext = createContext<(() => void) | undefined>(undefined);

/**
 * Opens Privy's login modal, or `undefined` when there is nothing to open.
 *
 * Undefined covers two cases a caller treats the same way: a build with no app
 * id, and a wallet session that has not finished loading yet. Either way there
 * is no modal to offer, so panels keep whatever they already said.
 */
export function useConnectPrompt(): (() => void) | undefined {
  return useContext(ConnectPromptContext);
}
