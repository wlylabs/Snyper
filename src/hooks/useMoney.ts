"use client";

import { useMemo } from "react";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useFxRate } from "./useFxRate";

/**
 * Every dollar figure on the app, shown in whichever currency the reader
 * picked in settings — one place, so a screen never has to know the rate or
 * the symbol itself. See `formatMoney` for what each shape actually prints.
 */
export function useMoney() {
  // A setting from before this field existed reads as `undefined`, not "USD" —
  // see `masked` in `lib/types.ts` for the same shape of problem.
  const currency = useAppStore((state) => state.settings.currency ?? "USD");
  const rate = useFxRate(currency !== "USD");

  return useMemo(() => {
    const compact = (value: number | undefined) => formatMoney(value, currency, rate, true);
    return {
      currency,
      rate,
      compact,
      full: (value: number | undefined) => formatMoney(value, currency, rate, false),
      /** A signed figure, for a profit and loss that has to show which way it went. */
      signed: (value: number) => {
        const body = compact(Math.abs(value));
        return body === "—" ? body : `${value >= 0 ? "+" : "-"}${body}`;
      },
    };
  }, [currency, rate]);
}
