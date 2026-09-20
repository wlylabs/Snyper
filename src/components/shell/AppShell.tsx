"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { ConnectControl } from "@/components/wallet/ConnectControl";
import { ChainControl } from "@/components/wallet/ChainControl";
import { InstallBanner } from "./InstallPrompt";
import { StatusStrip } from "./StatusStrip";
import { NAV_ITEMS, isActivePath } from "./nav";
import { useI18n } from "@/hooks/useI18n";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  // The accent line is one element per nav that slides to the active item,
  // rather than a border lit on each link, so switching tabs reads as travel.
  const activeIndex = NAV_ITEMS.findIndex((item) => isActivePath(pathname, item.href));
  const indicatorStyle = {
    "--nav-index": String(Math.max(activeIndex, 0)),
    "--nav-count": String(NAV_ITEMS.length),
  } as CSSProperties;

  return (
    <div className="relative z-10 min-h-dvh">
      <header className="shell-top">
        <div className="mx-auto flex h-full max-w-[1480px] items-center gap-3 px-3 md:px-4">
          <Link href="/" className="brand group" aria-label={t("a11y.home")}>
            <Logo size={28} className="transition-transform group-hover:scale-105" />
            <span className="brand-word hidden sm:block">Snyper</span>
          </Link>
          <span className="chip hidden lg:inline-flex">{t("common.nonCustodial")}</span>
          <div className="ml-auto flex items-center gap-2">
            <ChainControl />
            <ConnectControl />
          </div>
        </div>
      </header>

      <StatusStrip />
      <InstallBanner />

      <div className="mx-auto flex max-w-[1480px]">
        <nav
          className="sticky top-[calc(var(--shell-top)+var(--shell-strip))] hidden h-[calc(100dvh-var(--shell-top)-var(--shell-strip))] shrink-0 flex-col border-r border-line md:flex"
          style={{ width: "var(--shell-rail)" }}
          aria-label={t("a11y.primaryNav")}
        >
          <span
            className="nav-indicator rail-indicator"
            style={indicatorStyle}
            data-visible={activeIndex >= 0}
            aria-hidden
          />
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rail-link"
              data-active={isActivePath(pathname, item.href)}
            >
              <Icon name={item.icon} size={19} />
              <span className="rail-label">{t(item.label)}</span>
            </Link>
          ))}
          <div className="mt-auto px-2 pb-3">
            <p className="lbl text-center leading-relaxed">v0.1</p>
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-3 pt-3 pb-[calc(var(--shell-tabs)+env(safe-area-inset-bottom)+16px)] md:px-5 md:pt-4 md:pb-8">
          {children}
        </main>
      </div>

      <nav className="tab-bar md:hidden" aria-label={t("a11y.primaryNav")}>
        <span
          className="nav-indicator tab-indicator"
          style={indicatorStyle}
          data-visible={activeIndex >= 0}
          aria-hidden
        />
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="tab-link"
            data-active={isActivePath(pathname, item.href)}
          >
            <Icon name={item.icon} size={19} />
            <span className="text-[9px] font-semibold tracking-[0.08em] uppercase">
              {t(item.label)}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

