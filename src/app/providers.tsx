"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { ToastProvider } from "@/components/ui/Toast";
import { EngineRunner } from "@/components/bots/EngineRunner";
import { useAppStore } from "@/store/useAppStore";

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
          <ServiceWorker />
          <EngineRunner />
          {children}
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
