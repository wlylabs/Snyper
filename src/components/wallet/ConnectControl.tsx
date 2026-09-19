"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import { retryImport } from "@/lib/lazy";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

/**
 * The control's own placeholder, at the size of the pill that replaces it, so
 * the header is laid out once and the address lands in a space already cut for
 * it. Every state that is waiting on something renders this one: hydration, the
 * session chunk arriving, and Privy restoring a session once it has.
 */
export function ControlSkeleton() {
  return <div className="skel h-[30px] w-[116px] rounded-full" />;
}

/**
 * Shared by the dynamic component below and the warm-up beside it, and retried
 * for both: a chunk that fails once leaves `dynamic` on its loading state with
 * nothing to fall back to, which reads as a header that never finishes.
 */
const loadControl = () => retryImport(() => import("./WalletControl"));

/*
 * The half of this control that reads the session is behind a dynamic import,
 * because it is written against the Privy SDK and this file is rendered by the
 * shell on every page. A static import would put the SDK in the bundle the
 * browser parses before it can paint anything, which is exactly what the lazy
 * provider in `WalletSession` exists to avoid.
 */
const WalletControl = dynamic(() => loadControl().then((module) => module.WalletControl), {
  ssr: false,
  loading: () => <ControlSkeleton />,
});

export function ConnectControl() {
  const mounted = useMounted();
  /*
   * A prompt means the session provider is mounted, which is the one thing that
   * makes the control below safe to render: its hooks read Privy's context and
   * throw outside it. Until then this is a placeholder — the same placeholder
   * Privy itself sits behind while it works out whether anyone is signed in.
   */
  const prompt = useConnectPrompt();

  /*
   * Fetched as soon as the header mounts rather than when the provider lands,
   * so the two chunks are in flight together. Waiting for the provider would
   * make them a queue, and the reader would pay for the second round trip in
   * placeholder.
   */
  useEffect(() => {
    if (!PRIVY_CONFIGURED) return;
    // The warm-up is an optimisation, so it has nothing to say when it fails —
    // the render below asks for the same chunk again on its own account.
    void loadControl().catch(() => {});
  }, []);

  if (!mounted) return <ControlSkeleton />;
  if (!PRIVY_CONFIGURED) return <Unconfigured />;
  if (!prompt) return <ControlSkeleton />;
  return <WalletControl />;
}

/** Nothing to connect to: the build carries no Privy app id. */
function Unconfigured() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm btn-short" onClick={() => setOpen(true)}>
        {t("wallet.connect")}
      </button>
      <Sheet open={open} title={t("wallet.connectTitle")} onClose={() => setOpen(false)}>
        <div className="p-3">
          <div className="panel flex items-start gap-3 p-3">
            <Icon name="alert" size={16} className="mt-0.5 warn" />
            <p className="wrap-any text-[11px] leading-relaxed text-dim">
              {t("wallet.privyDisabled", { env: "NEXT_PUBLIC_PRIVY_APP_ID" })}
            </p>
          </div>
        </div>
      </Sheet>
    </>
  );
}
