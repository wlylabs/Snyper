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
 * and the shot. Launches is where a target is found before it is chosen,
 * balance is what the wallet came away holding, and settings configures what
 * the app does with the screen it is read on.
 *
 * It was called Memes, which named a genre where the other three name jobs,
 * and it could not be said once: English called it Memes, Indonesian called it
 * Memecoin — two different things, not one thing twice — so no single route
 * could be right for both.
 *
 * It was briefly called Launchpad, and that was the same defect wearing a
 * better word. In this market a launchpad is where a token is *issued*: you
 * arrive at one expecting to deploy something. This screen reads pools other
 * people opened and cannot deploy anything, so the name promised a button that
 * was never going to be under it, to every reader who had seen the word used
 * the ordinary way.
 *
 * Launches is what the screen actually holds. It translates rather than
 * splits — Peluncuran is the same noun in Indonesian, where Memes and Memecoin
 * were two — so `/launches` names the same thing the label does in either
 * dictionary, and it claims exactly as much as the screen delivers.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "nav.home", icon: "crosshair" },
  { href: "/balance", label: "nav.balance", icon: "stack" },
  { href: "/launches", label: "nav.launches", icon: "pulse" },
  { href: "/settings", label: "nav.settings", icon: "sliders" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
