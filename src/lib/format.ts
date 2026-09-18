import { formatUnits, parseUnits } from "viem";

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

export function formatUnitsFixed(value: bigint, decimals: number, maxDecimals = 6): string {
  return formatAmount(Number(formatUnits(value, decimals)), maxDecimals);
}

/**
 * A rate, in whatever unit the caller is quoting. Small numbers keep their
 * significant digits instead of being flattened to a fixed scale: a pair that
 * trades at 0.0000000421 is a real rate, and `0.00000004` is not a rounding of
 * it so much as a refusal to say what it is. See `formatSignificant`.
 */
export function formatPrice(value: number | undefined, significant = 4): string {
  if (value === undefined || !Number.isFinite(value) || value === 0) return "—";
  return formatSignificant(value, significant);
}

export function formatPercent(fraction: number | undefined, digits = 2): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatSigned(fraction: number | undefined, digits = 2): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return "—";
  const sign = fraction > 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

/** Parses user input without throwing on partial entries such as "0." or "". */
export function safeParseUnits(input: string, decimals: number): bigint | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (!/^\d*\.?\d*$/.test(trimmed)) return undefined;
  const normalised = trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
  const [whole, fraction = ""] = normalised.split(".");
  const clipped = fraction.slice(0, decimals);
  const value = clipped ? `${whole || "0"}.${clipped}` : whole || "0";
  try {
    return parseUnits(value, decimals);
  } catch {
    return undefined;
  }
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(numberLocale, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function feeLabel(fee: number): string {
  return `${(fee / 10_000).toFixed(fee % 100 === 0 ? 2 : 3)}%`;
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
