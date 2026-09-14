"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { ConnectControl } from "@/components/wallet/ConnectControl";
import { ChainControl } from "@/components/wallet/ChainControl";
import { InstallChip } from "./InstallChip";
import { StatusStrip } from "./StatusStrip";
import { NAV_ITEMS, isActivePath } from "./nav";
import { useI18n } from "@/hooks/useI18n";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <div className="relative z-10 min-h-dvh">
      <header className="shell-top">
        <div className="mx-auto flex h-full max-w-[1480px] items-center gap-3 px-3 md:px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t("a11y.home")}>
            <Mark />
            <span className="hidden text-[15px] font-bold tracking-[0.22em] sm:block">
              SNYPER
            </span>
          </Link>
          <span className="chip hidden lg:inline-flex">{t("common.nonCustodial")}</span>
          <div className="ml-auto flex items-center gap-2">
            <InstallChip />
            <ChainControl />
            <ConnectControl />
          </div>
        </div>
      </header>

      <StatusStrip />

      <div className="mx-auto flex max-w-[1480px]">
        <nav
          className="sticky top-[calc(var(--shell-top)+28px)] hidden h-[calc(100dvh-var(--shell-top)-28px)] shrink-0 flex-col border-r border-line md:flex"
          style={{ width: "var(--shell-rail)" }}
          aria-label={t("a11y.primaryNav")}
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rail-link"
              data-active={isActivePath(pathname, item.href)}
            >
              <Icon name={item.icon} size={19} />
              <span className="text-[9px] font-semibold tracking-[0.1em] uppercase">
                {t(item.label)}
              </span>
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

function Mark() {
  return (
    <span className="relative flex h-7 w-7 items-center justify-center border border-edge">
      <span className="absolute inset-x-0 top-1/2 h-px bg-accent opacity-70" />
      <span className="absolute inset-y-0 left-1/2 w-px bg-accent opacity-70" />
      <span className="relative h-2 w-2 border border-accent bg-void" />
    </span>
  );
}
