"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useConnectors } from "wagmi";
import type { Connector } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { WALLETCONNECT_PROJECT_ID } from "@/lib/wagmi";

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

type Stage = "choose" | "pairing";

export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { connect, isPending, error, reset } = useConnect();
  const { isConnected } = useAccount();
  const [stage, setStage] = useState<Stage>("choose");
  const [uri, setUri] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const walletConnectConnector = useMemo(
    () => connectors.find((connector) => connector.id === "walletConnect"),
    [connectors],
  );

  /** EIP-6963 announced wallets, deduplicated against the generic shim. */
  const injectedConnectors = useMemo(() => {
    const discovered = connectors.filter(
      (connector) => connector.type === "injected" && connector.id !== "injected",
    );
    if (discovered.length > 0) return discovered;
    return connectors.filter((connector) => connector.id === "injected");
  }, [connectors]);

  const coinbaseConnector = useMemo(
    () => connectors.find((connector) => connector.id === "coinbaseWalletSDK"),
    [connectors],
  );

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
    <Sheet open={open} title="Connect wallet" onClose={onClose}>
      {stage === "choose" ? (
        <div className="p-3">
          <p className="mb-3 text-xs leading-relaxed text-dim">
            Keys never leave your wallet. Snyper signs nothing on your behalf — every
            strategy leg is a transaction you approve in your own app.
          </p>

          <p className="lbl mb-2">Installed</p>
          <div className="mb-4 flex flex-col gap-1.5">
            {injectedConnectors.length === 0 && (
              <p className="text-xs text-faint">No browser wallet detected.</p>
            )}
            {injectedConnectors.map((connector) => (
              <WalletRow
                key={connector.uid}
                connector={connector}
                onSelect={() => connect({ connector })}
              />
            ))}
          </div>

          <p className="lbl mb-2">Mobile &amp; hardware</p>
          <div className="flex flex-col gap-1.5">
            {walletConnectConnector ? (
              <button type="button" className="row-link panel flex items-center gap-3 p-3" onClick={startWalletConnect}>
                <span className="flex h-9 w-9 items-center justify-center border border-line text-accent-text">
                  <Icon name="qr" size={18} />
                </span>
                <span className="flex-1 text-left">
                  <span className="block text-[13px] font-semibold">WalletConnect</span>
                  <span className="block text-[11px] text-faint">
                    Scan or deep link into any mobile wallet
                  </span>
                </span>
                <Icon name="chevron" size={14} className="-rotate-90 text-faint" />
              </button>
            ) : (
              <div className="panel flex items-start gap-3 p-3">
                <Icon name="alert" size={16} className="mt-0.5 warn" />
                <p className="text-[11px] leading-relaxed text-dim">
                  Mobile pairing is disabled. Set{" "}
                  <span className="num">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</span> to enable
                  WalletConnect.
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

          {isPending && <p className="lbl mt-4">Waiting for wallet…</p>}
          {error && (
            <p className="wrap-any mt-4 text-[11px] leading-relaxed short">{error.message}</p>
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
            Back
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
                <span className="lbl">Generating pairing code…</span>
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
              {copied ? "Copied" : "Copy URI"}
            </button>
            <button
              type="button"
              className="btn btn-sm flex-1"
              onClick={startWalletConnect}
              disabled={isPending && !uri}
            >
              <Icon name="refresh" size={13} />
              New code
            </button>
          </div>

          <p className="lbl mb-2">Open in app</p>
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
            <p className="wrap-any mt-3 text-[11px] leading-relaxed short">{error.message}</p>
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
