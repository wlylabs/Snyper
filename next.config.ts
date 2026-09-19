import type { NextConfig } from "next";

/**
 * Headers every response carries, whatever route served it.
 *
 * This app asks readers to sign transactions, which makes the page itself part
 * of what they are trusting. None of these change what a screen does; they
 * close the ways a screen can be made to do it somewhere else.
 *
 * What is deliberately absent is a `script-src`. The two inline boots in the
 * root layout and the hydration payload Next writes beside them would need a
 * per-request nonce, and a nonce needs middleware, and middleware would make
 * every one of these statically prerendered pages dynamic — trading a real
 * cache for a directive that `'unsafe-inline'` would render decorative anyway.
 * The same goes for `connect-src`: the hosts a wallet session reaches are
 * Privy's, WalletConnect's relays, the chain and the explorer, and that set is
 * not knowable from this repository with enough confidence to put a reader's
 * connection behind it. Both are worth having and neither is worth guessing,
 * so what ships here is the part that is provable.
 */
const SECURITY = [
  /*
   * The one this app most needs. A wallet prompt is judged by what the reader
   * sees behind it, and a page that can be framed is a page whose "confirm" can
   * be borrowed by something else drawn on top. `X-Frame-Options` says it again
   * for anything that predates the CSP directive.
   */
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },

  /** A response typed as JSON is never executed as a script. */
  { key: "X-Content-Type-Options", value: "nosniff" },

  /** An address in a path never rides along to a third party as a referrer. */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /**
   * Hardware nothing here uses. `usb` and `hid` are left alone on purpose —
   * they are how a hardware wallet talks to a page, and a reader plugging one
   * in should not be refused by a header written for a camera.
   *
   * `interest-cohort` is not here. It answered FLoC, FLoC was withdrawn, and a
   * directive that no longer denies anything is a line that only looks like
   * security.
   */
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },

  /**
   * `allow-popups` rather than plain `same-origin`, and that is the whole point
   * of naming it: a wallet login opens a window and then talks to it, and
   * severing that reference is how an app isolates itself out of its own
   * connect flow.
   */
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },

  /**
   * Two years, subdomains included. Worth knowing before this ships: every
   * subdomain of the deployment origin has to be able to serve HTTPS from the
   * moment a reader sees this header, because after that their browser will not
   * try anything else.
   */
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** The framework and its version are not a reader's business. */
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY,
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
