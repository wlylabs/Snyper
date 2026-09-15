import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

const description =
  "Non-custodial Robinhood Chain terminal: paste a memecoin contract, price it against its Uniswap pool or its Pons bonding curve, and run snypes — buy at your price, take profit, cut loss — from any device.";

/** Set NEXT_PUBLIC_SITE_URL in production so social cards resolve absolutely. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "Snyper — Robinhood Chain terminal",
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
    title: "Snyper — Robinhood Chain terminal",
    description,
    siteName: "Snyper",
    type: "website",
    images: [{ url: "/icons/icon-512.png?v=2", width: 512, height: 512, alt: "Snyper" }],
  },
  twitter: {
    card: "summary",
    title: "Snyper — Robinhood Chain terminal",
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

const themeBoot = `(function(){try{var raw=localStorage.getItem("snyper.state.v1");var t="dark";if(raw){var s=JSON.parse(raw);t=(s&&s.state&&s.state.settings&&s.state.settings.theme)||"dark";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
