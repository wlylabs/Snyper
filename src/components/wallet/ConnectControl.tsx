"use client";

import { useState } from "react";
import { useAccount, useBalance, useDisconnect, useEnsName } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";
import { ConnectModal } from "./ConnectModal";

export function ConnectControl() {
  const mounted = useMounted();
  const { address, isConnected, connector, chainId } = useAccount();
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const { data: ensName } = useEnsName({
    address,
    chainId: 1,
    query: { enabled: Boolean(address) },
  });

  if (!mounted) {
    return <div className="skel h-[34px] w-[116px]" />;
  }

  if (!isConnected || !address) {
    return (
      <>
        <button type="button" className="btn btn-accent btn-sm" onClick={() => setConnectOpen(true)}>
          <Icon name="wallet" size={14} />
          Connect
        </button>
        <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setAccountOpen(true)}
        aria-label="Account"
      >
        <span className="dot dot-live" />
        <span className="num normal-case tracking-normal">
          {ensName ?? truncateAddress(address, 4, 4)}
        </span>
      </button>
      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        address={address}
        chainId={chainId}
        connectorName={connector?.name}
        ensName={ensName ?? undefined}
      />
    </>
  );
}

function AccountSheet({
  open,
  onClose,
  address,
  chainId,
  connectorName,
  ensName,
}: {
  open: boolean;
  onClose: () => void;
  address: `0x${string}`;
  chainId?: number;
  connectorName?: string;
  ensName?: string;
}) {
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);
  const meta = chainMeta(chainId);
  const { data: balance } = useBalance({ address, query: { enabled: open } });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Sheet open={open} title="Account" onClose={onClose}>
      <div className="p-3">
        <div className="panel ticked p-4">
          <p className="lbl mb-2">{connectorName ?? "Wallet"}</p>
          <p className="num text-[15px] break-all">{ensName ?? address}</p>
          {ensName && <p className="num mt-1 text-[11px] text-faint break-all">{address}</p>}
          <div className="mt-4 flex items-baseline justify-between">
            <span className="lbl">{meta ? meta.label : "Unsupported network"}</span>
            <span className="num text-[15px]">
              {balance
                ? `${formatAmount(Number(balance.formatted), 5)} ${balance.symbol}`
                : "—"}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={chainId ? explorerAddress(chainId, address) : undefined}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
          >
            <Icon name="external" size={13} />
            Explorer
          </a>
        </div>

        <button
          type="button"
          className="btn btn-sm btn-short mt-2 w-full"
          onClick={() => {
            disconnect();
            onClose();
          }}
        >
          <Icon name="power" size={13} />
          Disconnect
        </button>
      </div>
    </Sheet>
  );
}
