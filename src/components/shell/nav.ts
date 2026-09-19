import type { IconName } from "@/components/ui/Icon";
import type { TKey } from "@/lib/i18n";

export type NavItem = {
  href: string;
  label: TKey;
  icon: IconName;
};

/**
 * Four surfaces, in the order a trade moves through them.
 *
 * Snyper is the one the app opens on and the one it is for: a target, a size,
 * and the shot. Memecoin is the wider list to read before choosing a target,
 * balance is what the wallet came away holding, and settings configures what
 * the app does with the screen it is read on.
 *
 * The path is the route, not the label. `/memecoin` is named for what the
 * screen lists rather than for either dictionary's word for it — English calls
 * it Memes and Indonesian calls it Memecoin, and a URL cannot be both.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.home", icon: "crosshair" },
  { href: "/balance", label: "nav.balance", icon: "stack" },
  { href: "/memecoin", label: "nav.memecoin", icon: "pulse" },
  { href: "/settings", label: "nav.settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
