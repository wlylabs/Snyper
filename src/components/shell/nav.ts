import type { IconName } from "@/components/ui/Icon";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Terminal", icon: "crosshair" },
  { href: "/bots", label: "Strategies", icon: "grid" },
  { href: "/assets", label: "Assets", icon: "stack" },
  { href: "/activity", label: "Activity", icon: "pulse" },
  { href: "/settings", label: "Settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
