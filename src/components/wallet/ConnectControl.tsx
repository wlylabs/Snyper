"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useMounted } from "@/hooks/useMounted";
import { useStalled } from "@/hooks/useStalled";
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
 * How long a placeholder is allowed to mean "loading" before it means "stuck".
 *
 * The session lands in a few hundred milliseconds on a warm connection and a
 * couple of seconds on a cold phone, so this is well clear of a slow load. What
 * it is not clear of is a load that will never finish, which is the case this
 * exists for.
 */
export const SESSION_TIMEOUT_MS = 8000;

/** Shared by the dynamic component below and the warm-up beside it. */
const loadControl = () => import("./WalletControl");

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
   * And this is how long that placeholder gets. The provider is loaded by
   * `providers`, which swallows a failed import on purpose: from the reader's
   * side a chunk that does not arrive and a Privy that cannot be reached are the
   * same outage, and the app keeps reading the chain through either. What it
   * must not do is keep claiming the session is on its way.
   */
  const stalled = useStalled(SESSION_TIMEOUT_MS);

  /*
   * Fetched as soon as the header mounts rather than when the provider lands,
   * so the two chunks are in flight together. Waiting for the provider would
   * make them a queue, and the reader would pay for the second round trip in
   * placeholder.
   */
  useEffect(() => {
    if (PRIVY_CONFIGURED) void loadControl();
  }, []);

  if (!mounted) return <ControlSkeleton />;
  if (!PRIVY_CONFIGURED) return <Unconfigured />;
  if (!prompt) return stalled ? <SessionUnreachable /> : <ControlSkeleton />;
  return <WalletControl />;
}

/**
 * A connect button that cannot connect, and says so when pressed.
 *
 * The header keeps a real control in every state where connecting is off the
 * table, rather than a placeholder or a gap. A reader who came to the corner to
 * connect gets the press they expected and an answer to it; a dead pill would
 * have them pressing a skeleton and concluding the app is broken — which, from
 * where they are standing, it is.
 */
function ControlNotice({ children }: { children: ReactNode }) {
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
            <p className="wrap-any text-[11px] leading-relaxed text-dim">{children}</p>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** Nothing to connect to: the build carries no Privy app id. */
function Unconfigured() {
  const { t } = useI18n();

  return (
    <ControlNotice>{t("wallet.privyDisabled", { env: "NEXT_PUBLIC_PRIVY_APP_ID" })}</ControlNotice>
  );
}

/**
 * There is an app id, but the session never started.
 *
 * Reloading is the whole of the retry on offer, and it is an honest one: both
 * things that get this far are decided before this app runs — a chunk the
 * browser could not fetch, and a handshake Privy never answered. Neither is
 * retried by a button in a sheet, and pretending otherwise would spend the
 * reader's press on nothing.
 */
export function SessionUnreachable() {
  const { t } = useI18n();

  return (
    <ControlNotice>
      {t("wallet.sessionUnreachable")}{" "}
      <button
        type="button"
        className="underline decoration-dotted underline-offset-2 hover:text-ink"
        onClick={() => window.location.reload()}
      >
        {t("wallet.sessionReload")}
      </button>
    </ControlNotice>
  );
}
