"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount } from "wagmi";

/**
 * Keeps the address the app reads on the wallet the reader actually connected.
 *
 * Privy links every wallet a reader has ever signed in with, and the wagmi
 * bridge starts on whichever of them comes first in the list — which is not
 * necessarily the one just connected. A reader who signed in by email once and
 * later connects their Robinhood wallet would otherwise land on the embedded
 * wallet: a real address, holding nothing, reported as theirs. Every balance on
 * screen would then be correct and about the wrong account, which is worse than
 * an error, because nothing about it looks wrong.
 *
 * `user.wallet` is Privy's own record of the most recently connected wallet, so
 * that is what wagmi is pointed at. Each address is followed once: a reader who
 * then picks another wallet in the account sheet keeps it, and only connecting
 * something new moves the app again.
 */
export function ActiveWalletSync() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const followed = useRef<string>(undefined);

  const connected = user?.wallet?.address?.toLowerCase();

  useEffect(() => {
    // A reader who logs out is a new session: the next wallet is followed again.
    if (!authenticated) followed.current = undefined;
  }, [authenticated]);

  useEffect(() => {
    if (!ready || !authenticated || !connected) return;
    if (followed.current === connected) return;
    if (address?.toLowerCase() === connected) {
      followed.current = connected;
      return;
    }
    // Privy links wallets before the bridge has them; wait for it to catch up
    // rather than recording a wallet that cannot be made active yet.
    const wallet = wallets.find(
      (candidate) => candidate.address.toLowerCase() === connected,
    );
    if (!wallet) return;
    followed.current = connected;
    void setActiveWallet(wallet).catch(() => {
      // The bridge refused this wallet — forget it, so a later render tries
      // again rather than leaving the app parked on an address nobody chose.
      if (followed.current === connected) followed.current = undefined;
    });
  }, [ready, authenticated, connected, address, wallets, setActiveWallet]);

  return null;
}
