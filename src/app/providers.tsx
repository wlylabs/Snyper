"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import { ToastProvider } from "@/components/ui/Toast";
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

type SessionProvider = ComponentType<{ children: ReactNode }>;

/**
 * The wallet session, held off the first paint.
 *
 * Privy's SDK is the largest thing this app ships by a wide margin — the
 * connectors alone carry WalletConnect, the Coinbase SDK, Solana and a funding
 * provider, none of which a Robinhood Chain terminal asks for. Imported
 * statically it lands in the bundle the browser has to finish parsing before a
 * single tab responds, so a reader waits on a wallet they may not be about to
 * connect before they can so much as switch screens.
 *
 * So it is fetched after the shell is up, and bare wagmi stands in the meantime.
 * That is not a degraded state: the chain is read through the app's own
 * transports, so the block height ticks and every read works exactly as it will
 * afterwards. What is missing is only the session — and nobody has one a
 * hundred milliseconds into a cold load anyway.
 *
 * Swapping the provider rebuilds everything under it once, which is why
 * `useMounted` remembers the document rather than the mount: without that, the
 * header would fall back to placeholders on the way through.
 */
function WalletProviders({ children }: { children: ReactNode }) {
  const [Session, setSession] = useState<SessionProvider | null>(null);

  useEffect(() => {
    if (!PRIVY_CONFIGURED) return;
    let live = true;
    void import("@/components/wallet/WalletSession")
      .then((module) => {
        // `setState` calls a function argument, so the component goes in as one.
        if (live) setSession(() => module.WalletSession);
      })
      .catch(() => {
        /*
         * The chunk did not arrive, which is the same outage from the reader's
         * side as a Privy that cannot be reached: no session either way, and the
         * rest of the app carries on reading the chain through its own
         * transports. Nothing is reported from here because there is nothing
         * here to report it to — the header is what notices, by way of the
         * timeout in `ConnectControl`, and it trades its placeholder for a
         * control that says so rather than waiting out the session.
         */
      });
    return () => {
      live = false;
    };
  }, []);

  if (!Session) {
    /*
     * `reconnectOnMount` is off to match what Privy's own wagmi provider passes.
     * There are no connectors registered on this config until Privy registers
     * one, so there is nothing here to reconnect to.
     */
    return (
      <WagmiProvider config={config} reconnectOnMount={false}>
        {children}
      </WagmiProvider>
    );
  }

  return <Session>{children}</Session>;
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

  /*
   * Everything that does not need a wallet sits above the wallet, so that the
   * swap below it leaves them alone: the query cache keeps what it has read,
   * toasts stay on screen, and the theme and locale are never reapplied.
   */
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ThemeSync />
        <LocaleSync />
        <ServiceWorker />
        <WalletProviders>{children}</WalletProviders>
      </ToastProvider>
    </QueryClientProvider>
  );
}
