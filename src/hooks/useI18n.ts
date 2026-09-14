"use client";

import { useCallback, useMemo } from "react";
import { INTL_LOCALE, translate, type Locale, type TKey, type TVars } from "@/lib/i18n";
import type { Reason } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

export function useI18n() {
  const locale = useAppStore((state) => state.settings.locale);

  const t = useCallback(
    (key: TKey, vars?: TVars) => translate(locale, key, vars),
    [locale],
  );

  /** Renders a stored reason, tolerating records saved before translation. */
  const r = useCallback(
    (reason: Reason | string) =>
      typeof reason === "string" ? reason : translate(locale, reason.key, reason.vars),
    [locale],
  );

  return useMemo(
    () => ({ t, r, locale: locale as Locale, intlLocale: INTL_LOCALE[locale] }),
    [t, r, locale],
  );
}
