import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

const description =
  "Non-custodial execution terminal: connect a wallet, price routes on-chain and run interval, grid, trigger and trailing strategies from any device.";

export const metadata: Metadata = {
  title: {
    default: "Snyper — On-chain execution terminal",
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
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Snyper — On-chain execution terminal",
    description,
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#07080a",
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
