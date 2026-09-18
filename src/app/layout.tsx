import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import "./globals.css";

/*
 * Both faces are self-hosted rather than linked from fonts.googleapis.com.
 * A stylesheet link to a third party is render-blocking and costs a DNS
 * lookup and a TLS handshake to a host the browser has no connection to yet,
 * on the same critical path as the header the connect control sits in.
 * `next/font` inlines the @font-face rules, serves the files from this origin,
 * and ships a metric-matched fallback so the swap does not move the layout.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-archivo",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const description =
  "Non-custodial Robinhood Chain app. Connect a wallet — browser, mobile, or one Privy creates on the spot — and the session is yours on any device.";

/** Set NEXT_PUBLIC_SITE_URL in production so social cards resolve absolutely. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "Snyper — Robinhood Chain",
    template: "%s · Snyper",
  },
  description,
  applicationName: "Snyper",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Snyper",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "16x16 32x32 48x48" },
      { url: "/icons/icon.svg?v=2", type: "image/svg+xml", sizes: "any" },
      { url: "/icons/icon-32.png?v=2", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }],
    other: [{ rel: "mask-icon", url: "/icons/safari-pinned-tab.svg?v=2", color: "#d7fe4b" }],
  },
  openGraph: {
    title: "Snyper — Robinhood Chain",
    description,
    siteName: "Snyper",
    type: "website",
    images: [{ url: "/icons/icon-512.png?v=2", width: 512, height: 512, alt: "Snyper" }],
  },
  twitter: {
    card: "summary",
    title: "Snyper — Robinhood Chain",
    description,
    images: ["/icons/icon-512.png?v=2"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  // Matches the manifest background so the shell never flashes white on launch.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f5" },
    { media: "(prefers-color-scheme: dark)", color: "#07080a" },
  ],
};

const themeBoot = `(function(){try{var raw=localStorage.getItem("snyper.state.v2");var t="dark";if(raw){var s=JSON.parse(raw);t=(s&&s.state&&s.state.settings&&s.state.settings.theme)||"dark";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

/*
 * Chromium fires `beforeinstallprompt` on load, routinely before React has
 * hydrated and can attach a listener — and it fires once. Missing it leaves the
 * install sheet with nothing to prompt and nothing to show but a paragraph
 * pointing at the browser menu. This catches it from the first byte and parks
 * it for `useInstallPrompt` to collect.
 */
const installBoot = `(function(){window.__snyperInstallPrompt=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__snyperInstallPrompt=e;});window.addEventListener("appinstalled",function(){window.__snyperInstallPrompt=null;});})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${archivo.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * Privy opens a connection to its API the moment its provider mounts —
         * that call is what restores a returning reader's session, and until it
         * answers the header holds a skeleton where their address belongs. The
         * handshake for it is started here instead, in parallel with the
         * download and parse of the SDK that will make the call, so by the time
         * Privy asks the socket is already open. The hosts are the ones Privy
         * names in its own CSP guidance: the API, the captcha it fronts logins
         * with, and the registry the WalletConnect list is read from.
         */}
        {PRIVY_CONFIGURED && (
          <>
            <link rel="preconnect" href="https://auth.privy.io" crossOrigin="anonymous" />
            <link rel="preconnect" href="https://challenges.cloudflare.com" />
            <link rel="dns-prefetch" href="https://explorer-api.walletconnect.com" />
          </>
        )}
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <script dangerouslySetInnerHTML={{ __html: installBoot }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
