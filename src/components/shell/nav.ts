import type { IconName } from "@/components/ui/Icon";
import type { TKey } from "@/lib/i18n";

export type NavItem = {
  href: string;
  label: TKey;
  icon: IconName;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.terminal", icon: "candles" },
  { href: "/snype", label: "nav.snype", icon: "crosshair" },
  { href: "/assets", label: "nav.assets", icon: "stack" },
  { href: "/activity", label: "nav.activity", icon: "pulse" },
  { href: "/settings", label: "nav.settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
