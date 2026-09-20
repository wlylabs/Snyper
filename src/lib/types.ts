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
  /**
   * Whether the balance screen covers its dollar figures.
   *
   * A setting rather than screen state, because the reason a reader turns it on
   * is that somebody can see their screen — and that reason does not end when
   * they navigate away and come back.
   *
   * Added after the store's last version, and deliberately without a bump: a
   * reader whose saved settings predate it has no value here, and the screens
   * read it as off — which is the default anyway, so there is nothing for a
   * migration to carry.
   */
  masked: boolean;
};
