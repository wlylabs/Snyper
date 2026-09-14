"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { CHAIN_META, SUPPORTED_CHAINS, chainMeta } from "@/lib/chains";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

export function ChainControl() {
  const mounted = useMounted();
  const { t } = useI18n();
  const activeChainId = useChainId();
  const { chainId: accountChainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentId = accountChainId ?? activeChainId;
  const meta = chainMeta(currentId);
  const unsupported = isConnected && !meta;

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted) return <div className="skel h-[34px] w-[92px]" />;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`btn btn-sm ${unsupported ? "btn-short" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={isPending}
      >
        <span className={`dot ${unsupported ? "dot-short" : "dot-live"}`} />
        <span className="hidden sm:inline">
          {unsupported ? t("wallet.wrongNetwork") : (meta?.mark ?? t("common.network"))}
        </span>
        <Icon name="chevron" size={12} />
      </button>

      {open && (
        <div
          className="panel absolute right-0 top-[calc(100%+6px)] z-50 w-56 p-1"
          role="listbox"
        >
          {SUPPORTED_CHAINS.map((chain) => {
            const item = CHAIN_META[chain.id];
            const active = chain.id === currentId;
            return (
              <button
                key={chain.id}
                type="button"
                role="option"
                aria-selected={active}
                className="row-link flex w-full items-center gap-2.5 px-2.5 py-2"
                onClick={() => {
                  switchChain({ chainId: chain.id });
                  setOpen(false);
                }}
              >
                <span className={`dot ${active ? "dot-live" : ""}`} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[12px]">{item.label}</span>
                  {!item.dex && (
                    <span className="block text-[10px] text-faint">
                      {t("wallet.balancesOnly")}
                    </span>
                  )}
                </span>
                <span className="lbl">{item.mark}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
