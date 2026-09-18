import type { IconName } from "@/components/ui/Icon";
import type { TKey } from "@/lib/i18n";

export type NavItem = {
  href: string;
  label: TKey;
  icon: IconName;
};

/**
 * Four surfaces: the home screen, what the connected wallet holds, where new
 * memecoins are found, and the settings. The first three are empty for now —
 * the shell, the wallet session and the chain badge are what this release
 * keeps, and what goes inside those pages is written next. Settings is not a
 * placeholder: it configures the two things that still exist.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.home", icon: "crosshair" },
  { href: "/balance", label: "nav.balance", icon: "stack" },
  { href: "/discover", label: "nav.discover", icon: "search" },
  { href: "/settings", label: "nav.settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
