/** Sentinel used across the app for a chain's native currency. */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export function isNative(address: string): boolean {
  return address.toLowerCase() === NATIVE.toLowerCase();
}
