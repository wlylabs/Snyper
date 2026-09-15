import { formatSignificant } from "./format";
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
  // Zero is exactly zero at every scale; printing it as `$0.000000` reads as a
  // price too small to show rather than as nothing.
  const digits = abs === 0 ? 2 : abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(converted.value);
}

/**
 * Wraps an already-formatted number in the currency's own furniture — symbol,
 * spacing and placement — by borrowing the shell `Intl` puts around zero. The
 * number itself is built elsewhere, because the figures this is for are ones
 * `Intl` will not render: a price whose digits start eight places past the
 * decimal point has no `maximumFractionDigits` that both shows it and stays
 * readable.
 */
function inCurrency(body: string, tag: string, currency: DisplayCurrency): string {
  const parts = new Intl.NumberFormat(tag, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(0);

  return parts
    .map((part) => {
      if (part.type === "integer") return body;
      if (part.type === "decimal" || part.type === "fraction") return "";
      return part.value;
    })
    .join("");
}

/**
 * A unit price, which on this chain is usually a memecoin's.
 *
 * `formatMoney` stops at six decimals, which is the right place to stop for a
 * portfolio total and the wrong place for a token that trades eight decimals
 * down: everything below it collapses onto the same `$0.000000`, so a token
 * that doubled and one that halved print identically. This keeps four
 * significant digits however far down they are.
 */
export function formatPriceMoney(
  usd: number | undefined,
  options: { currency: DisplayCurrency; fx: FxRate | undefined; locale: Locale },
  significant = 4,
): string {
  const converted = convert(usd, options.currency, options.fx);
  if (!converted || converted.value === 0) return "—";
  const tag = INTL_LOCALE[options.locale];

  // Rupiah has no sub-unit worth printing until the figure is small enough to
  // need one, and at that point it is the same problem as a dollar price.
  if (converted.currency === "IDR" && Math.abs(converted.value) >= 1) {
    return formatMoney(usd, options);
  }

  return inCurrency(
    formatSignificant(converted.value, significant, tag),
    tag,
    converted.currency,
  );
}

/**
 * A large figure written short: $412K, $1.24M, $3.1B. Market caps span six
 * orders of magnitude across one wallet, and a column of full-length numbers
 * is a column that has to be read digit by digit to be compared.
 */
export function formatCompactMoney(
  usd: number | undefined,
  options: { currency: DisplayCurrency; fx: FxRate | undefined; locale: Locale },
): string {
  const converted = convert(usd, options.currency, options.fx);
  if (!converted) return "—";
  return new Intl.NumberFormat(INTL_LOCALE[options.locale], {
    style: "currency",
    currency: converted.currency,
    notation: "compact",
    // Currency style would otherwise hold two decimals open and print $412.00K.
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(converted.value);
}

/**
 * A holding's worth, with everything under the floor collapsed into one honest
 * statement that it is dust.
 *
 * Eight airdropped contracts each printing `$0.000000` is a column of zeros
 * claiming to be prices. `< $0.01` says the same thing in the way a reader
 * already understands, and says it once.
 */
export function formatMoneyFloor(
  usd: number | undefined,
  options: { currency: DisplayCurrency; fx: FxRate | undefined; locale: Locale },
  floor = 0.01,
): string {
  if (usd === undefined || !Number.isFinite(usd)) return "—";
  if (usd !== 0 && Math.abs(usd) < floor) {
    const converted = convert(floor, options.currency, options.fx);
    if (!converted) return "—";
    return `< ${new Intl.NumberFormat(INTL_LOCALE[options.locale], {
      style: "currency",
      currency: converted.currency,
      maximumFractionDigits: converted.currency === "IDR" ? 0 : 2,
    }).format(converted.value)}`;
  }
  return formatMoney(usd, options);
}

export function formatRate(rate: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumFractionDigits: 0,
  }).format(rate);
}
