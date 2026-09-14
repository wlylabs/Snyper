import type { TKey, TVars } from "./i18n";

type Translate = (key: TKey, vars?: TVars) => string;

function errorChain(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current = error;
  while (current && seen.length < 6) {
    seen.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return seen;
}

function matches(error: unknown, test: (entry: Record<string, unknown>) => boolean): boolean {
  return errorChain(error).some(
    (entry) => typeof entry === "object" && entry !== null && test(entry as Record<string, unknown>),
  );
}

/**
 * wagmi surfaces connector failures as typed errors whose raw message names the
 * package version ("Version: @wagmi/core@2.x"). Those strings are useless in the
 * interface, so every case we can recognise gets a translated line instead.
 */
export function walletErrorMessage(error: unknown, t: Translate): string {
  if (!error) return "";

  const isProviderMissing = matches(
    error,
    (entry) =>
      entry.name === "ProviderNotFoundError" ||
      (typeof entry.message === "string" && entry.message.startsWith("Provider not found")),
  );
  if (isProviderMissing) return t("wallet.errNoProvider");

  const isRejected = matches(
    error,
    (entry) => entry.name === "UserRejectedRequestError" || entry.code === 4001,
  );
  if (isRejected) return t("wallet.errRejected");

  // -32002: a connection request is already open in the wallet.
  const isPending = matches(
    error,
    (entry) => entry.name === "ResourceUnavailableRpcError" || entry.code === -32002,
  );
  if (isPending) return t("wallet.errPending");

  const isChainMissing = matches(
    error,
    (entry) =>
      entry.name === "ChainNotConfiguredError" ||
      entry.name === "SwitchChainNotSupportedError" ||
      entry.code === 4902,
  );
  if (isChainMissing) return t("wallet.errChain");

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // Strip wagmi's trailing "Version: …" block from anything we pass through.
  const trimmed = message.split(/\n\nVersion:/)[0].trim();
  return trimmed || t("error.unknown");
}
