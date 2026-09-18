/**
 * Active BCP 47 tag for every number and date rendered by the app. Kept module
 * level so formatting helpers stay plain functions; the provider updates it
 * whenever the reader changes language.
 */
let numberLocale = "en-US";

export function setNumberLocale(tag: string): void {
  numberLocale = tag;
}

export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/**
 * Significant-digit aware amount formatting for token quantities.
 *
 * Never scientific notation. A balance is a quantity the reader has to check
 * against their wallet, and `3.10e-5` is not a quantity — it is a quantity they
 * have to decode first, next to a dollar figure that needs no decoding, which
 * is how a reader ends up comparing two numbers that were never the same unit.
 * Plain decimals hold down to a millionth; below that the zero run is counted,
 * the same way prices are written elsewhere in the app.
 */
export function formatAmount(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return value.toLocaleString(numberLocale, { maximumFractionDigits: 0 });
  if (abs >= 1000) return value.toLocaleString(numberLocale, { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString(numberLocale, { maximumFractionDigits: 4 });
  if (abs >= 0.0001) return value.toLocaleString(numberLocale, { maximumFractionDigits: maxDecimals });
  return formatSignificant(value, 3, numberLocale, 6);
}

/**
 * Unicode subscript digits, used to write a run of leading zeros as a count.
 *
 * A memecoin price is mostly zeros, and fixed decimals render every one of them
 * as the same `0.000000` — a figure that is not wrong so much as absent. Charts
 * and aggregators solved this years ago by counting the zeros instead, so a
 * reader coming from one of those already knows how to read `0.0₇421`.
 */
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

function subscript(count: number): string {
  return String(count)
    .split("")
    .map((digit) => SUBSCRIPT[Number(digit)] ?? digit)
    .join("");
}

/** The locale's decimal mark, so the compact form is not always a full stop. */
export function decimalSeparator(tag = numberLocale): string {
  return (
    new Intl.NumberFormat(tag).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? "."
  );
}

/**
 * How many zeros sit between the decimal point and the first digit that says
 * anything, and what that digit and its neighbours are. Derived from the
 * exponential form so that rounding which carries — 0.00009999 to three figures
 * is 0.0001, not 0.000100 — moves the exponent rather than corrupting the count.
 */
function leadingZeros(abs: number, significant: number): { zeros: number; digits: string } {
  const [mantissa, exponent] = abs.toExponential(significant - 1).split("e");
  const digits = mantissa.replace(/[.,]/, "").replace(/0+$/, "") || "0";
  return { zeros: -Number(exponent) - 1, digits };
}

/** Below this many leading zeros a plain decimal still reads fine. */
const SUBSCRIPT_FLOOR = 4;

/**
 * A magnitude written so that it survives being small: significant digits
 * rather than a fixed scale, and a zero run compressed once it gets long.
 * Returns only the number — a currency symbol is the caller's to add.
 */
export function formatSignificant(
  value: number,
  significant = 4,
  tag = numberLocale,
  subscriptFloor = SUBSCRIPT_FLOOR,
): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs === 0) return "0";

  if (abs >= 1) {
    return value.toLocaleString(tag, {
      minimumFractionDigits: 2,
      maximumFractionDigits: abs >= 1000 ? 2 : Math.max(2, significant),
    });
  }

  const { zeros, digits } = leadingZeros(abs, significant);
  if (zeros < subscriptFloor) {
    return value.toLocaleString(tag, {
      minimumFractionDigits: 2,
      maximumFractionDigits: zeros + significant,
    });
  }
  return `${sign}0${decimalSeparator(tag)}0${subscript(zeros)}${digits}`;
}
