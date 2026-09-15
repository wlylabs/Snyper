import type { PrivyClientConfig } from "@privy-io/react-auth";
import { CHAIN, SUPPORTED_CHAINS } from "./chains";
import { translate, type Locale } from "./i18n";

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

const BRACKETS = "M112 190V112H190M322 112H400V190M400 322V400H322M190 400H112V322";

/**
 * The lockup Privy prints at the top of the connect modal. Privy accepts an
 * element as well as a URL, and an element is the better of the two here: it
 * renders in the app's own document, so it reads the live theme tokens and the
 * app's typeface rather than baking one theme into an image.
 *
 * `textLength` pins the wordmark's width. Archivo is loaded by the time anyone
 * opens this, but if it were not, the fallback would set the same six letters
 * over the same 92 pixels instead of overflowing the mark.
 */
function BrandLockup() {
  return (
    <svg width="152" height="40" viewBox="0 0 152 40" role="img" aria-label="Snyper">
      <g transform="translate(0 1) scale(0.0742)">
        <rect width="512" height="512" rx="114" fill="var(--color-accent)" />
        <g transform="translate(256 256) scale(0.62) translate(-256 -256)">
          <path
            d={BRACKETS}
            fill="none"
            stroke="var(--color-accent-ink)"
            strokeWidth={52}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="210" y="210" width="92" height="92" rx="24" fill="var(--color-accent-ink)" />
        </g>
      </g>
      <text
        x="52"
        y="26"
        textLength="92"
        lengthAdjust="spacing"
        fill="var(--color-ink)"
        style={{ fontFamily: "var(--font-sans)", fontSize: 17, fontWeight: 700 }}
      >
        SNYPER
      </text>
    </svg>
  );
}

/**
 * Login surface. The wallet row comes first because most readers arrive with
 * one; email and Google are there so someone who does not can still trade from
 * an embedded wallet Privy creates for them on the spot.
 *
 * Everything visual in here is half of an agreement: the other half lives in
 * the privy bridge in `globals.css`, which points Privy's own `--privy-*`
 * custom properties at the app's tokens. This side sets what Privy cannot read
 * off a stylesheet — the mark, the copy, and which wallets are worth offering
 * on a Robinhood Chain terminal.
 */
export function privyConfig(theme: "dark" | "light", locale: Locale): PrivyClientConfig {
  return {
    appearance: {
      theme,
      // Matches --color-accent per theme; the bridge keeps the rest in step.
      accentColor: theme === "dark" ? "#d7fe4b" : "#c9ee33",
      logo: <BrandLockup />,
      landingHeader: translate(locale, "privy.landingHeader"),
      loginMessage: translate(locale, "privy.loginMessage"),
      walletChainType: "ethereum-only",
      showWalletLoginFirst: true,
      // The chain's own wallet leads, ahead of the usual browser extensions.
      walletList: [
        "detected_wallets",
        "robinhood_wallet",
        "metamask",
        "coinbase_wallet",
        "rainbow",
        "wallet_connect",
      ],
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
