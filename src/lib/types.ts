import type { Locale } from "./i18n";

/**
 * Everything the app remembers about a reader between visits.
 *
 * Deliberately small. The features that used to store their own state —
 * strategies, signals, trades, price series, imported tokens, venue addresses —
 * were removed with the surfaces that wrote them, and nothing here is kept in
 * anticipation of what replaces them: a setting earns its place when a screen
 * actually reads it.
 */
export type Settings = {
  locale: Locale;
  /** Set once the reader picks a language, which ends browser detection. */
  localeChosen: boolean;
  theme: "dark" | "light";
};
