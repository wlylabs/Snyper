import { INTL_LOCALE, type Locale } from "./i18n";

export type DisplayCurrency = "USD" | "IDR";

export const CURRENCIES: { value: DisplayCurrency; label: string }[] = [
  { value: "USD", label: "USD" },
  { value: "IDR", label: "IDR" },
];

export type FxRate = {
  /** Indonesian rupiah per one US dollar. */
  rate: number;
  /** When the provider last revised the rate. */
  updatedAt: number;
  source: string;
};

type ErApiResponse = { result?: string; time_last_update_unix?: number; rates?: Record<string, unknown> };
type FrankfurterResponse = { date?: string; rates?: Record<string, unknown> };

const PRIMARY = "https://open.er-api.com/v6/latest/USD";
const FALLBACK = "https://api.frankfurter.app/latest?from=USD&to=IDR";

function plausible(value: unknown): value is number {
  // A rate outside this band means the feed changed shape or base currency.
  return typeof value === "number" && Number.isFinite(value) && value > 1_000 && value < 1_000_000;
}

/**
 * USD to IDR from a public FX feed, with a second provider as backup. Returns
 * undefined rather than a guess when neither answers — callers then stay in USD.
 */
export async function fetchFxRate(): Promise<FxRate | undefined> {
  try {
    const res = await fetch(PRIMARY, { cache: "no-store" });
    if (res.ok) {
      const body: ErApiResponse = await res.json();
      const value = body.rates?.IDR;
      if (plausible(value)) {
        return {
          rate: value,
          updatedAt: body.time_last_update_unix ? body.time_last_update_unix * 1000 : Date.now(),
          source: "open.er-api.com",
        };
      }
    }
  } catch {
    /* fall through to the backup provider */
  }

  try {
    const res = await fetch(FALLBACK, { cache: "no-store" });
    if (res.ok) {
      const body: FrankfurterResponse = await res.json();
      const value = body.rates?.IDR;
      if (plausible(value)) {
        return {
          rate: value,
          updatedAt: body.date ? Date.parse(body.date) : Date.now(),
          source: "frankfurter.app",
        };
      }
    }
  } catch {
    /* no provider answered */
  }

  return undefined;
}

/** Converts a USD figure into the display currency, when a rate is available. */
export function convert(
  usd: number | undefined,
  currency: DisplayCurrency,
  fx: FxRate | undefined,
): { value: number; currency: DisplayCurrency } | undefined {
  if (usd === undefined || !Number.isFinite(usd)) return undefined;
  if (currency === "IDR" && fx) return { value: usd * fx.rate, currency: "IDR" };
  return { value: usd, currency: "USD" };
}

export function formatMoney(
  usd: number | undefined,
  options: { currency: DisplayCurrency; fx: FxRate | undefined; locale: Locale },
): string {
  const converted = convert(usd, options.currency, options.fx);
  if (!converted) return "—";
  const tag = INTL_LOCALE[options.locale];

  if (converted.currency === "IDR") {
    // Rupiah has no practical sub-unit; whole numbers read cleaner.
    return new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: converted.value < 1000 ? 2 : 0,
    }).format(converted.value);
  }

  const abs = Math.abs(converted.value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(converted.value);
}

export function formatRate(rate: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumFractionDigits: 0,
  }).format(rate);
}
