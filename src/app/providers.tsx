"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider as BareWagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, PRIVY_CONFIGURED, privyConfig } from "@/lib/privy";
import { ToastProvider } from "@/components/ui/Toast";
import { SnypeRunner } from "@/components/snype/SnypeRunner";
import { VenueSync } from "@/hooks/useVenue";
import { TokenLogoSync } from "@/hooks/useTokenLogos";
import { ConnectPromptProvider } from "@/hooks/useConnectPrompt";
import { useAppStore } from "@/store/useAppStore";
import { setNumberLocale } from "@/lib/format";
import { INTL_LOCALE, detectLocale } from "@/lib/i18n";

function ThemeSync() {
  const theme = useAppStore((state) => state.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keep in step with --color-void in globals.css for each theme.
    const color = theme === "dark" ? "#07080a" : "#eef1f5";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((tag) => tag.setAttribute("content", color));
  }, [theme]);
  return null;
}

function LocaleSync() {
  const locale = useAppStore((state) => state.settings.locale);
  const localeChosen = useAppStore((state) => state.settings.localeChosen);
  const currency = useAppStore((state) => state.settings.currency);
  const hydrated = useAppStore((state) => state.hydrated);
  const setSettings = useAppStore((state) => state.setSettings);

  // First visit follows the browser's language; an explicit choice ends detection.
  useEffect(() => {
    if (!hydrated || localeChosen) return;
    const detected = detectLocale(
      navigator.languages?.length ? navigator.languages : [navigator.language],
    );
    if (detected === locale) return;
    setSettings({
      locale: detected,
      currency: detected === "id" && currency === "USD" ? "IDR" : currency,
    });
  }, [hydrated, localeChosen, locale, currency, setSettings]);

  useEffect(() => {
    setNumberLocale(INTL_LOCALE[locale]);
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}

function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* registration is best-effort; the app works without it */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}

/**
 * Privy owns the wallet session, so its provider wraps wagmi rather than the
 * other way round. Without an app id there is nothing to wrap: the app still
 * renders and still reads the chain, and the connect control says why nothing
 * can be connected.
 */
function WalletProviders({ children }: { children: ReactNode }) {
  const theme = useAppStore((state) => state.settings.theme);
  const locale = useAppStore((state) => state.settings.locale);

  if (!PRIVY_CONFIGURED) {
    return <BareWagmiProvider config={config}>{children}</BareWagmiProvider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      {...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {})}
      // Theme and language are read here rather than inside the modal, so a
      // reader who switches either one finds Privy already switched with them.
      config={privyConfig(theme, locale)}
    >
      <WagmiProvider config={config}>
        <ConnectPromptProvider>{children}</ConnectPromptProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProviders>
        <ToastProvider>
          <ThemeSync />
          <LocaleSync />
          <ServiceWorker />
          <VenueSync />
          <TokenLogoSync />
          <SnypeRunner />
          {children}
        </ToastProvider>
      </WalletProviders>
    </QueryClientProvider>
  );
}
