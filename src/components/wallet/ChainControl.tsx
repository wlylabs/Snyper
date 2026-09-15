"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { CHAIN_ID, chainMeta } from "@/lib/chains";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";
import { useVenue } from "@/hooks/useVenue";

/**
 * The network badge. Snyper speaks one chain, so there is nothing to pick here:
 * the control shows Robinhood Chain when the wallet is on it, and turns into a
 * one-tap switch when it is not.
 */
export function ChainControl() {
  const mounted = useMounted();
  const { t } = useI18n();
  const activeChainId = useChainId();
  const { chainId: accountChainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { hasRouting } = useVenue();

  const currentId = accountChainId ?? activeChainId;
  const meta = chainMeta(CHAIN_ID);
  const wrongNetwork = isConnected && currentId !== CHAIN_ID;

  if (!mounted) return <div className="skel h-[30px] w-[92px]" />;

  if (wrongNetwork) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-short"
        onClick={() => switchChain({ chainId: CHAIN_ID })}
        disabled={isPending}
      >
        <span className="dot dot-short" />
        <span className="hidden sm:inline">
          {t("wallet.switchTo", { chain: meta?.label ?? t("common.network") })}
        </span>
        <span className="sm:hidden">{t("wallet.wrongNetwork")}</span>
      </button>
    );
  }

  return (
    <span
      className="btn btn-sm cursor-default"
      title={hasRouting ? meta?.label : t("wallet.balancesOnly")}
    >
      <span className={`dot ${hasRouting ? "dot-live" : ""}`} />
      <span>{meta?.mark ?? t("common.network")}</span>
    </span>
  );
}
