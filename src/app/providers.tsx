"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { ToastProvider } from "@/components/ui/Toast";
import { EngineRunner } from "@/components/bots/EngineRunner";
import { useAppStore } from "@/store/useAppStore";
import { setNumberLocale } from "@/lib/format";
import { INTL_LOCALE, detectLocale } from "@/lib/i18n";

function ThemeSync() {
  const theme = useAppStore((state) => state.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const color = theme === "dark" ? "#07080a" : "#e9eae4";
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
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ThemeSync />
          <LocaleSync />
          <ServiceWorker />
          <EngineRunner />
          {children}
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
