"use client";

import { useCallback, useMemo } from "react";
import { INTL_LOCALE, translate, type Locale, type TKey, type TVars } from "@/lib/i18n";
import { useAppStore } from "@/store/useAppStore";

export function useI18n() {
  const locale = useAppStore((state) => state.settings.locale);

  const t = useCallback(
    (key: TKey, vars?: TVars) => translate(locale, key, vars),
    [locale],
  );

  return useMemo(
    () => ({ t, locale: locale as Locale, intlLocale: INTL_LOCALE[locale] }),
    [t, locale],
  );
}
