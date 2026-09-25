"use client";

import { useMemo } from "react";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useFxRate } from "./useFxRate";

/**
 * What the wallet holds, shown in whichever currency the reader picked in
 * settings — one place, so the balance screen never has to know the rate or
 * the symbol itself.
 *
 * Only the balance screen calls this. A quote against a pool, a fill's own
 * worth, a profit and loss — those are trading figures, denominated in the
 * chain's own unit before they are anything else, and the stake ladder beside
 * them is priced in dollars; converting one figure on a trading screen
 * without the other would leave a reader comparing two currencies at once.
 * What a wallet holds has no such other side to disagree with.
 */
export function useMoney() {
  // A setting from before this field existed reads as `undefined`, not "USD" —
  // see `masked` in `lib/types.ts` for the same shape of problem.
  const currency = useAppStore((state) => state.settings.currency ?? "USD");
  const rate = useFxRate(currency !== "USD");

  return useMemo(
    () => ({ currency, rate, full: (value: number | undefined) => formatMoney(value, currency, rate) }),
    [currency, rate],
  );
}
