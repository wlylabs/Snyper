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
 * and the shot. Activity is where a shot already taken is read back, balance
 * is what the wallet came away holding, and settings configures what the app
 * does with the screen it is read on.
 *
 * This used to be Launches — a list of pools other people opened, for finding
 * a target before it was chosen. Aiming at one no longer needs the list: any
 * address with a pool on this venue can be pasted straight into the terminal
 * — see `AddressAim` — so the one thing this tab still had that the terminal
 * did not was gone, and it is a trade log now instead. It is read the same
 * way the terminal reads a fill's own numbers: off the chain's own `Swap`
 * events, filtered to this wallet, never a ledger of this app's own — see
 * `useActivity`.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.home", icon: "crosshair" },
  { href: "/balance", label: "nav.balance", icon: "stack" },
  { href: "/activity", label: "nav.activity", icon: "pulse" },
  { href: "/settings", label: "nav.settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
