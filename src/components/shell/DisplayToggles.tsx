"use client";

import { Icon } from "@/components/ui/Icon";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { LOCALES } from "@/lib/i18n";
import { useAppStore } from "@/store/useAppStore";

/**
 * Theme and language, back in the header.
 *
 * Both used to live on a settings page, and that page went with the features it
 * configured. These two settings outlived it — they are about reading the app
 * rather than about what it does — so they sit where they are used instead of
 * waiting for a screen to be rebuilt around them.
 *
 * Both are single controls rather than pickers: there are two themes and two
 * languages, and a menu to choose between two things is a menu too many. Each
 * one shows where a press would take the reader, so the control reads as an
 * offer rather than a readout.
 *
 * Neither renders before mount. The theme is read from localStorage by the boot
 * script in `layout.tsx` and the language is only known once the store has
 * hydrated, so the server has nothing true to print — a placeholder that keeps
 * the size is more honest than a glyph that flips on hydration.
 */
export function ThemeToggle() {
  const mounted = useMounted();
  const { t } = useI18n();
  const theme = useAppStore((state) => state.settings.theme);
  const setSettings = useAppStore((state) => state.setSettings);

  if (!mounted) return <div className="skel h-[30px] w-[34px]" />;

  const next = theme === "dark" ? "light" : "dark";
  const label = t(next === "dark" ? "theme.toDark" : "theme.toLight");

  return (
    <button
      type="button"
      className="btn btn-sm px-2.5"
      onClick={() => setSettings({ theme: next })}
      aria-label={label}
      title={label}
    >
      {/* Keyed on the theme so the glyph lands on each switch. */}
      <Icon key={next} name={next === "dark" ? "moon" : "sun"} size={13} className="pop" />
    </button>
  );
}

export function LocaleToggle() {
  const mounted = useMounted();
  const { t, locale } = useI18n();
  const setSettings = useAppStore((state) => state.setSettings);

  if (!mounted) return <div className="skel h-[30px] w-[34px]" />;

  const next = LOCALES[(LOCALES.findIndex((entry) => entry.value === locale) + 1) % LOCALES.length];

  return (
    <button
      type="button"
      className="btn btn-sm px-2.5"
      // An explicit choice ends the browser-language detection in `providers`.
      onClick={() => setSettings({ locale: next.value, localeChosen: true })}
      aria-label={t("a11y.language")}
      title={next.label}
    >
      <span className="num text-[10px] tracking-[0.08em]">{locale.toUpperCase()}</span>
    </button>
  );
}
