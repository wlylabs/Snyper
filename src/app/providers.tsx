"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider as BareWagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, PRIVY_CONFIGURED, privyConfig } from "@/lib/privy";
import { ToastProvider } from "@/components/ui/Toast";
import { ConnectPromptProvider } from "@/hooks/useConnectPrompt";
import { ActiveWalletSync } from "@/components/wallet/ActiveWalletSync";
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
  const hydrated = useAppStore((state) => state.hydrated);
  const setSettings = useAppStore((state) => state.setSettings);

  // First visit follows the browser's language; an explicit choice ends detection.
  useEffect(() => {
    if (!hydrated || localeChosen) return;
    const detected = detectLocale(
      navigator.languages?.length ? navigator.languages : [navigator.language],
    );
    if (detected === locale) return;
    setSettings({ locale: detected });
  }, [hydrated, localeChosen, locale, setSettings]);

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
 * Whether the reader is pointing at this with a finger, which is what decides
 * how the wallet list ends — see `pairingEntry` in `lib/privy`.
 *
 * Read after mount rather than during render, because there is no pointer on
 * the server and a guess would hand Privy one wallet list and then swap it for
 * another a frame later. The desktop answer is the safe one to start from: the
 * QR it chooses pairs any phone wallet, where a list of deep links on a machine
 * that has no wallet apps installed pairs none of them.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    setCoarse(query.matches);
    // A tablet with a keyboard folded on and off changes this mid-session.
    const follow = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  return coarse;
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
  const touch = useCoarsePointer();

  /*
   * Theme, language and pointer are read here rather than inside the modal, so
   * a reader who changes any of them finds Privy already changed with them.
   *
   * Held across renders because the config carries the brand lockup as a live
   * element: rebuilding it on every store write — a theme toggle, a locale, a
   * hydration — would hand Privy a new logo and a new appearance object each
   * time and have it re-render the modal's chrome for nothing.
   */
  const appearance = useMemo(() => privyConfig(theme, locale, touch), [theme, locale, touch]);

  if (!PRIVY_CONFIGURED) {
    return <BareWagmiProvider config={config}>{children}</BareWagmiProvider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      {...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {})}
      config={appearance}
    >
      <WagmiProvider config={config}>
        <ActiveWalletSync />
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
          {children}
        </ToastProvider>
      </WalletProviders>
    </QueryClientProvider>
  );
}
