"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useModalStatus, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useConnections, useDisconnect } from "wagmi";

/**
 * How long an activation is given to land before it is made again.
 *
 * Short enough that a reader watching the header does not have time to decide
 * it is broken, long enough for a connector that is mid-registration to finish.
 */
const RETRY_DELAY = 600;

/**
 * How many times. Past this the session has something wrong with it that another
 * call is not going to reach — a wallet Privy has a record of but no provider
 * for, an extension that was closed — and the header says so instead, where the
 * reader can do something about it.
 */
const RETRIES = 5;

/**
 * How long this will go on trying, all told.
 *
 * The header reads it so that the two do not drift: what it says about the wait
 * has to be true for exactly as long as the wait lasts, and a number repeated
 * in both places is a number that stops matching the first time one is tuned.
 */
export const ACTIVATION_BUDGET = RETRY_DELAY * RETRIES;

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
  const { isOpen } = useModalStatus();
  const { address } = useAccount();
  const connections = useConnections();
  const { disconnectAsync } = useDisconnect();
  const followed = useRef<string>(undefined);
  const [attempt, setAttempt] = useState(0);

  const connected = user?.wallet?.address?.toLowerCase();

  useEffect(() => {
    // A reader who logs out is a new session: the next wallet is followed again.
    if (!authenticated) {
      followed.current = undefined;
      setAttempt(0);
    }
  }, [authenticated]);

  // An address that lands is an activation that worked; the budget starts over.
  useEffect(() => {
    if (address) setAttempt(0);
  }, [address]);

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
   * An open modal is the one time an unauthenticated session is not an ended
   * one, and skipping it is what makes connecting reliable rather than a coin
   * toss. Signing in with a wallet connects it first and authenticates second:
   * for as long as the reader is looking at the signature request, the bridge
   * has already handed wagmi a live connection and Privy still reports nobody
   * signed in. Read as an ended session, that connection was torn out from
   * under the login that was making it — and wagmi records a connector it
   * disconnected, so the reconnect afterwards was refused too. The reader saw a
   * connect that did nothing, and a second attempt that did nothing either.
   *
   * A connector that refuses to let go is left alone rather than retried: the
   * wallet is gone from this app's side either way, and there is no state here
   * that a second attempt would reach.
   */
  useEffect(() => {
    if (!ready || authenticated || connections.length === 0) return;
    if (isOpen) return;
    for (const connection of connections) {
      void disconnectAsync({ connector: connection.connector }).catch(() => {});
    }
  }, [ready, authenticated, isOpen, connections, disconnectAsync]);

  /*
   * The wallet the app should be reading, out of what the session actually has.
   *
   * Privy names one and the bridge can only activate one it has connected, so
   * the two have to agree before anything is worth trying. When Privy names
   * none — which is where an email sign-in sits until the embedded wallet is
   * recorded on the user — the session's own first wallet is taken instead, and
   * only while the app has no address at all. That is the difference between a
   * reader who waits a moment for their wallet and a reader who waits forever.
   */
  const target = useMemo(() => {
    if (connected) return wallets.find((wallet) => wallet.address.toLowerCase() === connected);
    return address ? undefined : wallets[0];
  }, [connected, wallets, address]);

  useEffect(() => {
    if (!ready || !authenticated || !target) return;
    const wanted = target.address.toLowerCase();
    if (address?.toLowerCase() === wanted) {
      followed.current = wanted;
      return;
    }
    if (followed.current === wanted) return;
    followed.current = wanted;
    void setActiveWallet(target).catch(() => {
      // The bridge refused this wallet — forget it, so a later render tries
      // again rather than leaving the app parked on an address nobody chose.
      if (followed.current === wanted) followed.current = undefined;
    });
    // `attempt` is read by nothing in here on purpose: it is the retry below
    // asking for this to run again, which a ref it clears cannot do by itself.
  }, [ready, authenticated, target, address, attempt, setActiveWallet]);

  /*
   * The outcome is checked, because the call cannot be trusted to report one.
   *
   * `setActiveWallet` looks for a connector carrying the wallet's address and
   * returns — resolved, not rejected — when it finds none. That happens
   * routinely: the bridge registers connectors from the same wallet list this
   * reads, so for a frame or two after a wallet arrives Privy has it and wagmi
   * does not. The attempt above was recorded as made, nothing rejected, and
   * nothing tried again: the session sat authenticated with no address behind
   * it, which is the header's "Connecting…" that never finishes.
   *
   * So a session holding a wallet the app has no address for is retried on a
   * short delay, a few times over a couple of seconds, and then left to the
   * account sheet. Forgetting the attempt is what reopens the door above; the
   * counter is what stops this becoming a loop that calls forever.
   */
  useEffect(() => {
    if (!ready || !authenticated || address || !target) return;
    if (attempt >= RETRIES) return;
    const timer = window.setTimeout(() => {
      followed.current = undefined;
      setAttempt((made) => made + 1);
    }, RETRY_DELAY);
    return () => window.clearTimeout(timer);
  }, [ready, authenticated, address, target, attempt]);

  return null;
}
