"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Connector } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { useWalletConnectors } from "@/hooks/useWalletConnectors";
import { walletErrorMessage } from "@/lib/walletErrors";
import { useI18n } from "@/hooks/useI18n";

/**
 * Deep links published by each wallet for WalletConnect v2 pairing. The URI is
 * appended verbatim; no wallet-specific SDK is bundled.
 */
const WALLET_LINKS: { name: string; prefix: string }[] = [
  { name: "MetaMask", prefix: "https://metamask.app.link/wc?uri=" },
  { name: "Trust", prefix: "https://link.trustwallet.com/wc?uri=" },
  { name: "Rainbow", prefix: "https://rnbwapp.com/wc?uri=" },
  { name: "Uniswap", prefix: "https://uniswap.org/app/wc?uri=" },
  { name: "Zerion", prefix: "https://app.zerion.io/wc?uri=" },
  { name: "Ledger Live", prefix: "ledgerlive://wc?uri=" },
];

/** Where to send someone who has no wallet at all on this device. */
const WALLET_DOWNLOADS: { name: string; href: string }[] = [
  { name: "MetaMask", href: "https://metamask.io/download/" },
  { name: "Rabby", href: "https://rabby.io/" },
  { name: "Coinbase Wallet", href: "https://www.coinbase.com/wallet/downloads" },
];

type Stage = "choose" | "pairing";

export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const {
    injected: injectedConnectors,
    walletConnect: walletConnectConnector,
    coinbase: coinbaseConnector,
    probed,
  } = useWalletConnectors();
  const { connect, isPending, error, reset } = useConnect();
  const { isConnected } = useAccount();
  const [stage, setStage] = useState<Stage>("choose");
  const [uri, setUri] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setStage("choose");
      setUri("");
      setQr("");
      setCopied(false);
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (isConnected && open) onClose();
  }, [isConnected, open, onClose]);

  useEffect(() => {
    if (!walletConnectConnector) return;
    const handler = (payload: { type: string; data?: unknown }) => {
      if (payload.type === "display_uri" && typeof payload.data === "string") {
        setUri(payload.data);
      }
    };
    walletConnectConnector.emitter.on("message", handler);
    return () => {
      walletConnectConnector.emitter.off("message", handler);
    };
  }, [walletConnectConnector]);

  useEffect(() => {
    if (!uri) {
      setQr("");
      return;
    }
    let cancelled = false;
    import("qrcode")
      .then((mod) =>
        mod.default.toString(uri, {
          type: "svg",
          margin: 0,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        }),
      )
      .then((svg) => {
        if (!cancelled) setQr(svg);
      })
      .catch(() => {
        if (!cancelled) setQr("");
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const startWalletConnect = useCallback(() => {
    if (!walletConnectConnector) return;
    setStage("pairing");
    connect({ connector: walletConnectConnector });
  }, [connect, walletConnectConnector]);

  const copyUri = useCallback(async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [uri]);

  return (
    <Sheet open={open} title={t("wallet.connectTitle")} onClose={onClose}>
      {stage === "choose" ? (
        <div className="p-3">
          <p className="mb-3 text-xs leading-relaxed text-dim">{t("wallet.intro")}</p>

          <p className="lbl mb-2">{t("wallet.installed")}</p>
          <div className="mb-4 flex flex-col gap-1.5">
            {!probed && <div className="skel h-[58px] w-full" />}
            {probed && injectedConnectors.length === 0 && (
              <div className="panel p-3">
                <p className="text-[11px] leading-relaxed text-dim">
                  {t("wallet.noBrowserWallet")}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {WALLET_DOWNLOADS.map((wallet) => (
                    <a
                      key={wallet.name}
                      href={wallet.href}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm"
                    >
                      {wallet.name}
                      <Icon name="external" size={11} className="text-faint" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {injectedConnectors.map((connector) => (
              <WalletRow
                key={connector.uid}
                connector={connector}
                onSelect={() => connect({ connector })}
              />
            ))}
          </div>

          <p className="lbl mb-2">{t("wallet.mobileHardware")}</p>
          <div className="flex flex-col gap-1.5">
            {walletConnectConnector ? (
              <button type="button" className="row-link panel flex items-center gap-3 p-3" onClick={startWalletConnect}>
                <span className="flex h-9 w-9 items-center justify-center border border-line text-accent-text">
                  <Icon name="qr" size={18} />
                </span>
                <span className="flex-1 text-left">
                  <span className="block text-[13px] font-semibold">WalletConnect</span>
                  <span className="block text-[11px] text-faint">
                    {t("wallet.walletConnectSub")}
                  </span>
                </span>
                <Icon name="chevron" size={14} className="-rotate-90 text-faint" />
              </button>
            ) : (
              <div className="panel flex items-start gap-3 p-3">
                <Icon name="alert" size={16} className="mt-0.5 warn" />
                <p className="wrap-any text-[11px] leading-relaxed text-dim">
                  {t("wallet.walletConnectDisabled", {
                    env: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
                  })}
                </p>
              </div>
            )}

            {coinbaseConnector && (
              <WalletRow
                connector={coinbaseConnector}
                onSelect={() => connect({ connector: coinbaseConnector })}
              />
            )}
          </div>

          {isPending && <p className="lbl mt-4">{t("wallet.waiting")}</p>}
          {error && (
            <p className="wrap-any mt-4 flex items-start gap-2 text-[11px] leading-relaxed short">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              {walletErrorMessage(error, t)}
            </p>
          )}
        </div>
      ) : (
        <div className="p-3">
          <button
            type="button"
            className="lbl mb-3 inline-flex items-center gap-1.5 text-dim"
            onClick={() => setStage("choose")}
          >
            <Icon name="chevron" size={12} className="rotate-90" />
            {t("common.back")}
          </button>

          <div className="panel ticked mb-3 flex items-center justify-center p-4">
            {qr ? (
              <div
                className="h-[210px] w-[210px] [&>svg]:h-full [&>svg]:w-full"
                style={{ background: "#fff", padding: 10 }}
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            ) : (
              <div className="flex h-[210px] w-[210px] items-center justify-center">
                <span className="lbl">{t("wallet.generatingCode")}</span>
              </div>
            )}
          </div>

          <div className="mb-3 flex gap-2">
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={copyUri}
              disabled={!uri}
            >
              <Icon name={copied ? "check" : "copy"} size={13} />
              {copied ? t("common.copied") : t("wallet.copyUri")}
            </button>
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={startWalletConnect}
              disabled={isPending && !uri}
            >
              <Icon name="refresh" size={13} />
              {t("wallet.newCode")}
            </button>
          </div>

          <p className="lbl mb-2">{t("wallet.openInApp")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {WALLET_LINKS.map((wallet) => (
              <a
                key={wallet.name}
                href={uri ? `${wallet.prefix}${encodeURIComponent(uri)}` : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!uri}
                className={`panel flex items-center justify-between gap-2 p-2.5 text-[12px] ${
                  uri ? "row-link" : "pointer-events-none opacity-40"
                }`}
              >
                {wallet.name}
                <Icon name="external" size={12} className="text-faint" />
              </a>
            ))}
          </div>

          {error && (
            <p className="wrap-any mt-3 flex items-start gap-2 text-[11px] leading-relaxed short">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              {walletErrorMessage(error, t)}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function WalletRow({ connector, onSelect }: { connector: Connector; onSelect: () => void }) {
  return (
    <button type="button" className="row-link panel flex items-center gap-3 p-3" onClick={onSelect}>
      <span className="flex h-9 w-9 items-center justify-center overflow-hidden border border-line">
        {connector.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={connector.icon} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name="wallet" size={17} className="text-dim" />
        )}
      </span>
      <span className="flex-1 text-left text-[13px] font-semibold">{connector.name}</span>
      <Icon name="chevron" size={14} className="-rotate-90 text-faint" />
    </button>
  );
}
