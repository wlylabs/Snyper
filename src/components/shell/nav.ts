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
 * and the shot. Launchpad is where a target is found before it is chosen,
 * balance is what the wallet came away holding, and settings configures what
 * the app does with the screen it is read on.
 *
 * It used to be called Memes, which named a genre where the other three name
 * jobs — and it could not be said once either: English called it Memes,
 * Indonesian called it Memecoin, and a single route cannot be both, so the
 * path disagreed with the label in one of the two languages whatever was
 * chosen. Launchpad is the same word in both, and it names what the screen is
 * for rather than what the tokens on it are: the pools that opened today,
 * which is the only part of this market still early enough to shoot at.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.home", icon: "crosshair" },
  { href: "/balance", label: "nav.balance", icon: "stack" },
  { href: "/launchpad", label: "nav.launchpad", icon: "pulse" },
  { href: "/settings", label: "nav.settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
