import type { IconName } from "@/components/ui/Icon";
import type { TKey } from "@/lib/i18n";

export type NavItem = {
  href: string;
  label: TKey;
  icon: IconName;
};

/**
 * Three surfaces, and the app is built to hold three: the home screen, what the
 * connected wallet holds, and where new memecoins are found. Each one is empty
 * for now — the shell, the wallet session and the chain badge are what this
 * release keeps, and what goes inside these pages is written next.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.home", icon: "crosshair" },
  { href: "/balance", label: "nav.balance", icon: "stack" },
  { href: "/discover", label: "nav.discover", icon: "search" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
