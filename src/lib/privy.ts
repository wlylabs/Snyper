import type { PrivyClientConfig } from "@privy-io/react-auth";
import { CHAIN, SUPPORTED_CHAINS } from "./chains";

/**
 * Privy replaces the wallet plumbing the app used to carry itself: the connect
 * modal, the pairing QR, the per-wallet deep links. One app id from
 * dashboard.privy.io covers browser wallets, mobile wallets and the embedded
 * wallet offered to readers who arrive without one.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

/** Optional app client id, used when the app is registered per client. */
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() ?? "";

/** Whether wallet connection is available at all in this build. */
export const PRIVY_CONFIGURED = PRIVY_APP_ID.length > 0;

/**
 * Login surface. The wallet row comes first because most readers arrive with
 * one; email and Google are there so someone who does not can still trade from
 * an embedded wallet Privy creates for them on the spot.
 */
export function privyConfig(theme: "dark" | "light"): PrivyClientConfig {
  return {
    appearance: {
      theme,
      accentColor: "#d7fe4b",
      walletChainType: "ethereum-only",
      showWalletLoginFirst: true,
    },
    loginMethods: ["wallet", "email", "google"],
    embeddedWallets: {
      ethereum: { createOnLogin: "users-without-wallets" },
      showWalletUIs: true,
    },
    defaultChain: CHAIN,
    supportedChains: [...SUPPORTED_CHAINS],
  };
}
