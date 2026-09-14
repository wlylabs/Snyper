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

export function activeNumberLocale(): string {
  return numberLocale;
}

export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Significant-digit aware amount formatting for token quantities. */
export function formatAmount(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return value.toLocaleString(numberLocale, { maximumFractionDigits: 0 });
  if (abs >= 1000) return value.toLocaleString(numberLocale, { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString(numberLocale, { maximumFractionDigits: 4 });
  if (abs >= 0.0001) return value.toLocaleString(numberLocale, { maximumFractionDigits: maxDecimals });
  return value.toExponential(2);
}

export function formatUnitsFixed(value: bigint, decimals: number, maxDecimals = 6): string {
  return formatAmount(Number(formatUnits(value, decimals)), maxDecimals);
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `$${value.toLocaleString(numberLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value === 0) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return value.toLocaleString(numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
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
