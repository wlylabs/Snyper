"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useConnections, useDisconnect } from "wagmi";

/**
 * Keeps the address the app reads on the wallet the reader actually connected,
 * and on nothing at all once they disconnect.
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
  const connections = useConnections();
  const { disconnectAsync } = useDisconnect();
  const followed = useRef<string>(undefined);

  const connected = user?.wallet?.address?.toLowerCase();

  useEffect(() => {
    // A reader who logs out is a new session: the next wallet is followed again.
    if (!authenticated) followed.current = undefined;
  }, [authenticated]);

  /*
   * Ending the Privy session does not, on its own, end the wagmi one.
   *
   * The bridge registers a connector per linked wallet and hands wagmi a
   * connection for the active one. When the session goes it takes the
   * connectors with it — but not the connection: wagmi's own store is left
   * holding the old address with its status still `connected`, and the bridge
   * only clears that on the code path this app does not take. Everything
   * downstream reads that store, so a reader who held Disconnect watched the
   * status strip keep saying connected and their balances sit there under an
   * address they had just given up.
   *
   * So the connection is dropped here, where the session is watched, rather
   * than in the button that happens to end it. Every way out is the same way
   * out: the hold-to-confirm disconnect, a session Privy expires on its own,
   * a logout from another tab. Each connection is named explicitly because the
   * connector it belongs to has already been dropped from the config by the
   * time this runs, and the bare call would have nothing left to look up.
   *
   * A connector that refuses to let go is left alone rather than retried: the
   * wallet is gone from this app's side either way, and there is no state here
   * that a second attempt would reach.
   */
  useEffect(() => {
    if (!ready || authenticated || connections.length === 0) return;
    for (const connection of connections) {
      void disconnectAsync({ connector: connection.connector }).catch(() => {});
    }
  }, [ready, authenticated, connections, disconnectAsync]);

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
